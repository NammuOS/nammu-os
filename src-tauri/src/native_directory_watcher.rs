use crate::native_filesystem::{
    path_string, require_trusted_caller, validate_path, NativeFilesystemError,
    NativeFilesystemErrorCode, NativeFilesystemResponse,
};
use notify::{
    event::{ModifyKind, RenameMode},
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State, Webview};

const TRUSTED_WEBVIEW_LABEL: &str = "main";
const WATCH_EVENT_NAME: &str = "nammu://native-filesystem-change";
const MAX_ACTIVE_WATCHERS: usize = 8;
const WATCH_SIGNAL_CAPACITY: usize = 64;
const MAX_EVENT_PATHS: usize = 32;
const QUIET_WINDOW: Duration = Duration::from_millis(80);
const MAX_COALESCE_WINDOW: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFilesystemEventKind {
    Created,
    Removed,
    Renamed,
    Modified,
    Metadata,
    RescanRequired,
    WatchError,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFilesystemWatchEvent {
    pub watch_id: String,
    pub root_path: String,
    pub kind: NativeFilesystemEventKind,
    pub paths: Vec<String>,
    pub raw_event_count: u64,
    pub rescan_required: bool,
    pub error: Option<NativeFilesystemError>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDirectoryWatchRegistration {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDirectoryWatchStop {
    pub stopped: bool,
    pub active_watchers: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDirectoryWatchDiagnostics {
    pub active_watchers: usize,
    pub raw_events: u64,
    pub emitted_invalidations: u64,
    pub dropped_signals: u64,
}

#[derive(Default)]
struct WatchCounters {
    raw_events: AtomicU64,
    emitted_invalidations: AtomicU64,
    dropped_signals: AtomicU64,
}

#[derive(Debug)]
struct WatchSignal {
    kind: NativeFilesystemEventKind,
    paths: Vec<String>,
    error: Option<NativeFilesystemError>,
}

struct ActiveDirectoryWatch {
    watcher: Option<RecommendedWatcher>,
    worker: Option<JoinHandle<()>>,
    stopping: Arc<AtomicBool>,
    wake_worker: SyncSender<WatchSignal>,
}

impl ActiveDirectoryWatch {
    fn stop(mut self) {
        self.stopping.store(true, Ordering::Release);
        let _ = self.wake_worker.try_send(WatchSignal {
            kind: NativeFilesystemEventKind::RescanRequired,
            paths: Vec::new(),
            error: None,
        });
        self.watcher.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

struct WatchStore {
    watches: Mutex<HashMap<String, ActiveDirectoryWatch>>,
    counters: Arc<WatchCounters>,
}

impl Default for WatchStore {
    fn default() -> Self {
        Self {
            watches: Mutex::new(HashMap::new()),
            counters: Arc::new(WatchCounters::default()),
        }
    }
}

impl Drop for WatchStore {
    fn drop(&mut self) {
        let watches = self
            .watches
            .get_mut()
            .map(|watches| watches.drain().map(|(_, watch)| watch).collect::<Vec<_>>())
            .unwrap_or_default();
        for watch in watches {
            watch.stop();
        }
    }
}

#[derive(Clone, Default)]
pub struct NativeDirectoryWatchState {
    inner: Arc<WatchStore>,
}

fn watch_error(code: NativeFilesystemErrorCode, message: &'static str) -> NativeFilesystemError {
    NativeFilesystemError::new(code, message)
}

fn random_id() -> Result<String, NativeFilesystemError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| {
        watch_error(
            NativeFilesystemErrorCode::WatchFailed,
            "Windows could not initialize live filesystem updates.",
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn validate_watch_id(id: &str) -> Result<(), NativeFilesystemError> {
    if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(NativeFilesystemError::invalid_path());
    }
    Ok(())
}

fn validate_watch_path(raw: &str) -> Result<PathBuf, NativeFilesystemError> {
    let path = validate_path(raw)?;
    let metadata = fs::metadata(&path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The folder could not be inspected for changes.")
    })?;
    if !metadata.is_dir() {
        return Err(watch_error(
            NativeFilesystemErrorCode::NotDirectory,
            "Only directories can be watched for filesystem changes.",
        ));
    }
    Ok(path)
}

#[cfg(windows)]
fn backend_watch_path(path: &Path) -> PathBuf {
    let value = path_string(path);
    if value.starts_with(r"\\?\") {
        return path.to_path_buf();
    }
    if let Some(unc) = value.strip_prefix(r"\\") {
        return PathBuf::from(format!(r"\\?\UNC\{unc}"));
    }
    PathBuf::from(format!(r"\\?\{value}"))
}

#[cfg(not(windows))]
fn backend_watch_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        path_string(left).eq_ignore_ascii_case(&path_string(right))
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn relevant_event_path(root: &Path, path: &Path) -> bool {
    same_path(root, path)
        || path
            .parent()
            .map(|parent| same_path(root, parent))
            .unwrap_or(false)
}

fn public_event_path(path: &Path) -> String {
    let value = path_string(path);
    #[cfg(windows)]
    {
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(ordinary) = value.strip_prefix(r"\\?\") {
            return ordinary.to_string();
        }
    }
    value
}

fn classify_event(event: Event, root: &Path) -> Option<WatchSignal> {
    let paths: Vec<_> = event
        .paths
        .iter()
        .filter(|path| relevant_event_path(root, path))
        .map(|path| public_event_path(path))
        .collect();
    if !event.paths.is_empty() && paths.is_empty() {
        return None;
    }
    let kind = match event.kind {
        EventKind::Create(_) => NativeFilesystemEventKind::Created,
        EventKind::Remove(_) => NativeFilesystemEventKind::Removed,
        EventKind::Modify(ModifyKind::Name(
            RenameMode::Any
            | RenameMode::Both
            | RenameMode::From
            | RenameMode::To
            | RenameMode::Other,
        )) => NativeFilesystemEventKind::Renamed,
        EventKind::Modify(ModifyKind::Metadata(_)) => NativeFilesystemEventKind::Metadata,
        EventKind::Modify(_) => NativeFilesystemEventKind::Modified,
        EventKind::Any | EventKind::Other => NativeFilesystemEventKind::RescanRequired,
        EventKind::Access(_) => return None,
    };
    Some(WatchSignal {
        kind,
        paths,
        error: None,
    })
}

fn enqueue_signal(
    sender: &SyncSender<WatchSignal>,
    counters: &WatchCounters,
    pending_dropped: &AtomicU64,
    stopping: &AtomicBool,
    signal: WatchSignal,
) {
    if stopping.load(Ordering::Acquire) {
        return;
    }
    counters.raw_events.fetch_add(1, Ordering::Relaxed);
    if let Err(TrySendError::Full(_)) = sender.try_send(signal) {
        counters.dropped_signals.fetch_add(1, Ordering::Relaxed);
        pending_dropped.fetch_add(1, Ordering::Relaxed);
    }
}

fn aggregate(signals: Vec<WatchSignal>, dropped: u64) -> WatchSignal {
    let first_kind = signals
        .first()
        .map(|signal| signal.kind)
        .unwrap_or(NativeFilesystemEventKind::RescanRequired);
    let kind = if signals.iter().all(|signal| signal.kind == first_kind) && dropped == 0 {
        first_kind
    } else {
        NativeFilesystemEventKind::RescanRequired
    };
    let error = signals.iter().find_map(|signal| signal.error.clone());
    let mut unique = HashSet::new();
    let mut paths = Vec::new();
    for path in signals.into_iter().flat_map(|signal| signal.paths) {
        if paths.len() == MAX_EVENT_PATHS {
            break;
        }
        if unique.insert(path.clone()) {
            paths.push(path);
        }
    }
    WatchSignal {
        kind: if error.is_some() {
            NativeFilesystemEventKind::WatchError
        } else {
            kind
        },
        paths,
        error,
    }
}

fn watcher_worker(
    receiver: Receiver<WatchSignal>,
    watch_id: String,
    root_path: String,
    app: AppHandle,
    counters: Arc<WatchCounters>,
    pending_dropped: Arc<AtomicU64>,
    stopping: Arc<AtomicBool>,
) {
    while let Ok(first) = receiver.recv() {
        if stopping.load(Ordering::Acquire) {
            break;
        }
        let started = Instant::now();
        let maximum = started + MAX_COALESCE_WINDOW;
        let mut quiet_until = started + QUIET_WINDOW;
        let mut signals = vec![first];
        loop {
            let now = Instant::now();
            let deadline = quiet_until.min(maximum);
            if now >= deadline {
                break;
            }
            match receiver.recv_timeout(deadline - now) {
                Ok(signal) => {
                    signals.push(signal);
                    quiet_until = (Instant::now() + QUIET_WINDOW).min(maximum);
                }
                Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => break,
            }
        }
        if stopping.load(Ordering::Acquire) {
            break;
        }
        let dropped = pending_dropped.swap(0, Ordering::AcqRel);
        let raw_event_count = signals.len() as u64 + dropped;
        let signal = aggregate(signals, dropped);
        let payload = NativeFilesystemWatchEvent {
            watch_id: watch_id.clone(),
            root_path: root_path.clone(),
            kind: signal.kind,
            paths: signal.paths,
            raw_event_count,
            rescan_required: dropped > 0
                || signal.kind == NativeFilesystemEventKind::RescanRequired,
            error: signal.error,
        };
        if app
            .emit_to(TRUSTED_WEBVIEW_LABEL, WATCH_EVENT_NAME, payload)
            .is_ok()
        {
            counters
                .emitted_invalidations
                .fetch_add(1, Ordering::Relaxed);
        }
    }
}

impl NativeDirectoryWatchState {
    fn start(
        &self,
        app: AppHandle,
        path: &str,
    ) -> Result<NativeDirectoryWatchRegistration, NativeFilesystemError> {
        let path = validate_watch_path(path)?;
        // Keep the registry locked until insertion so simultaneous invoke calls cannot
        // race past the process-wide watcher limit and over-allocate native handles.
        let mut watches = self.inner.watches.lock().unwrap();
        if watches.len() >= MAX_ACTIVE_WATCHERS {
            return Err(watch_error(
                NativeFilesystemErrorCode::WatchFailed,
                "Too many filesystem folders are already being watched.",
            ));
        }
        let id = random_id()?;
        let root_path = path_string(&path);
        let backend_path = backend_watch_path(&path);
        let (sender, receiver) = sync_channel(WATCH_SIGNAL_CAPACITY);
        let callback_sender = sender.clone();
        let callback_counters = self.inner.counters.clone();
        let pending_dropped = Arc::new(AtomicU64::new(0));
        let callback_pending_dropped = pending_dropped.clone();
        let stopping = Arc::new(AtomicBool::new(false));
        let callback_stopping = stopping.clone();
        let callback_root = backend_path.clone();
        let mut watcher = notify::recommended_watcher(move |result| match result {
            Ok(event) => {
                if let Some(signal) = classify_event(event, &callback_root) {
                    enqueue_signal(
                        &callback_sender,
                        &callback_counters,
                        &callback_pending_dropped,
                        &callback_stopping,
                        signal,
                    );
                }
            }
            Err(_) => enqueue_signal(
                &callback_sender,
                &callback_counters,
                &callback_pending_dropped,
                &callback_stopping,
                WatchSignal {
                    kind: NativeFilesystemEventKind::WatchError,
                    paths: Vec::new(),
                    error: Some(watch_error(
                        NativeFilesystemErrorCode::WatchFailed,
                        "Live filesystem updates stopped for this folder.",
                    )),
                },
            ),
        })
        .map_err(|_| {
            watch_error(
                NativeFilesystemErrorCode::WatchUnsupported,
                "This location does not support native filesystem notifications.",
            )
        })?;
        watcher
            .watch(&backend_path, RecursiveMode::NonRecursive)
            .map_err(|_| {
                watch_error(
                    NativeFilesystemErrorCode::WatchFailed,
                    "Windows could not watch this folder for filesystem changes.",
                )
            })?;
        if let Some(parent) = backend_path
            .parent()
            .filter(|parent| !same_path(parent, &backend_path))
        {
            watcher
                .watch(parent, RecursiveMode::NonRecursive)
                .map_err(|_| {
                    watch_error(
                        NativeFilesystemErrorCode::WatchFailed,
                        "Windows could not monitor the parent folder for removal or rename.",
                    )
                })?;
        }
        let worker_id = id.clone();
        let worker_root = root_path.clone();
        let worker_counters = self.inner.counters.clone();
        let worker_pending_dropped = pending_dropped;
        let worker_stopping = stopping.clone();
        let worker = thread::Builder::new()
            .name("nammu-directory-watch".to_string())
            .spawn(move || {
                watcher_worker(
                    receiver,
                    worker_id,
                    worker_root,
                    app,
                    worker_counters,
                    worker_pending_dropped,
                    worker_stopping,
                )
            })
            .map_err(|_| {
                watch_error(
                    NativeFilesystemErrorCode::WatchFailed,
                    "Windows could not start the filesystem watcher worker.",
                )
            })?;
        watches.insert(
            id.clone(),
            ActiveDirectoryWatch {
                watcher: Some(watcher),
                worker: Some(worker),
                stopping,
                wake_worker: sender,
            },
        );
        Ok(NativeDirectoryWatchRegistration {
            id,
            path: root_path,
        })
    }

    fn stop(&self, id: &str) -> Result<NativeDirectoryWatchStop, NativeFilesystemError> {
        validate_watch_id(id)?;
        let (watch, active_watchers) = {
            let mut watches = self.inner.watches.lock().unwrap();
            let watch = watches.remove(id).ok_or_else(|| {
                watch_error(
                    NativeFilesystemErrorCode::NotFound,
                    "The filesystem watcher is no longer active.",
                )
            })?;
            (watch, watches.len())
        };
        watch.stop();
        Ok(NativeDirectoryWatchStop {
            stopped: true,
            active_watchers,
        })
    }

    fn diagnostics(&self) -> NativeDirectoryWatchDiagnostics {
        NativeDirectoryWatchDiagnostics {
            active_watchers: self.inner.watches.lock().unwrap().len(),
            raw_events: self.inner.counters.raw_events.load(Ordering::Relaxed),
            emitted_invalidations: self
                .inner
                .counters
                .emitted_invalidations
                .load(Ordering::Relaxed),
            dropped_signals: self.inner.counters.dropped_signals.load(Ordering::Relaxed),
        }
    }
}

#[tauri::command]
pub fn start_native_directory_watch(
    path: String,
    caller: Webview,
    app: AppHandle,
    state: State<'_, NativeDirectoryWatchState>,
) -> Result<NativeFilesystemResponse<NativeDirectoryWatchRegistration>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(
        state.start(app, &path),
    ))
}

#[tauri::command]
pub fn stop_native_directory_watch(
    id: String,
    caller: Webview,
    state: State<'_, NativeDirectoryWatchState>,
) -> Result<NativeFilesystemResponse<NativeDirectoryWatchStop>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.stop(&id)))
}

#[tauri::command]
pub fn get_native_directory_watch_diagnostics(
    caller: Webview,
    state: State<'_, NativeDirectoryWatchState>,
) -> Result<NativeFilesystemResponse<NativeDirectoryWatchDiagnostics>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::Success {
        value: state.diagnostics(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::mpsc::channel,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn fixture() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("NammuFilesF2CTest-{nonce}"));
        fs::create_dir(&root).unwrap();
        root
    }

    #[test]
    fn validates_only_existing_directories() {
        assert_eq!(
            validate_watch_path("relative").unwrap_err().code,
            NativeFilesystemErrorCode::InvalidPath
        );
        let root = fixture();
        let file = root.join("file.txt");
        fs::write(&file, b"fixture").unwrap();
        assert_eq!(
            validate_watch_path(&path_string(&file)).unwrap_err().code,
            NativeFilesystemErrorCode::NotDirectory
        );
        assert_eq!(validate_watch_path(&path_string(&root)).unwrap(), root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn coalesces_bursts_without_losing_rescan_semantics() {
        let signals = vec![
            WatchSignal {
                kind: NativeFilesystemEventKind::Created,
                paths: vec!["C:\\one".to_string()],
                error: None,
            },
            WatchSignal {
                kind: NativeFilesystemEventKind::Removed,
                paths: vec!["C:\\two".to_string()],
                error: None,
            },
        ];
        let combined = aggregate(signals, 4);
        assert_eq!(combined.kind, NativeFilesystemEventKind::RescanRequired);
        assert_eq!(combined.paths.len(), 2);
    }

    #[test]
    fn ids_are_opaque_and_validated() {
        let id = random_id().unwrap();
        assert_eq!(id.len(), 32);
        assert!(validate_watch_id(&id).is_ok());
        assert_eq!(
            validate_watch_id("not-an-id").unwrap_err().code,
            NativeFilesystemErrorCode::InvalidPath
        );
    }

    #[cfg(windows)]
    #[test]
    fn native_backend_observes_external_create_modify_rename_delete_and_stops_on_drop() {
        fn wait_for(
            receiver: &std::sync::mpsc::Receiver<notify::Result<Event>>,
            expected_path: &Path,
            expected: fn(&EventKind) -> bool,
        ) {
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if let Ok(Ok(event)) = receiver.recv_timeout(Duration::from_millis(100)) {
                    if event.paths.iter().any(|path| path == expected_path) && expected(&event.kind)
                    {
                        return;
                    }
                }
            }
            panic!("native watcher did not observe the expected generated fixture change");
        }

        let root = fixture();
        let created = root.join("Unicode watched file.txt");
        let renamed = root.join("Renamed watched file.txt");
        let (sender, receiver) = channel();
        let mut watcher = notify::recommended_watcher(sender).unwrap();
        watcher.watch(&root, RecursiveMode::NonRecursive).unwrap();

        fs::write(&created, b"one").unwrap();
        wait_for(&receiver, &created, |kind| {
            matches!(kind, EventKind::Create(_))
        });
        fs::write(&created, b"modified content").unwrap();
        wait_for(&receiver, &created, |kind| {
            matches!(kind, EventKind::Modify(_))
        });
        fs::rename(&created, &renamed).unwrap();
        wait_for(&receiver, &renamed, |kind| {
            matches!(kind, EventKind::Modify(ModifyKind::Name(_)))
        });
        fs::remove_file(&renamed).unwrap();
        wait_for(&receiver, &renamed, |kind| {
            matches!(kind, EventKind::Remove(_))
        });

        drop(watcher);
        while receiver.try_recv().is_ok() {}
        fs::write(root.join("after-unsubscribe.txt"), b"ignored").unwrap();
        assert!(receiver.recv_timeout(Duration::from_millis(250)).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
