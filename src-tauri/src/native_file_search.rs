use crate::native_filesystem::{
    metadata_from_path, path_string, require_trusted_caller, validate_path, NativeFileKind,
    NativeFileMetadata, NativeFilesystemError, NativeFilesystemErrorCode, NativeFilesystemResponse,
};
use getrandom::fill as random_fill;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{State, Webview};

const MAX_ACTIVE_SEARCHES: usize = 2;
const MAX_SEARCH_RECORDS: usize = 16;
const TERMINAL_SEARCH_TTL: Duration = Duration::from_secs(2 * 60);
const RESULT_LIMIT: usize = 5_000;
const RESULT_BATCH_LIMIT: usize = 200;
const MAX_QUERY_UNITS: usize = 256;
const MAX_EXTENSIONS: usize = 16;
const MAX_EXTENSION_UNITS: usize = 24;
const PROGRESS_FLUSH_ENTRIES: u64 = 64;
const PROGRESS_FLUSH_INTERVAL: Duration = Duration::from_millis(40);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileSearchScope {
    CurrentFolder,
    CurrentTree,
    SelectedDrive,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileSearchKind {
    All,
    Files,
    Folders,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileSearchQuery {
    pub root_path: String,
    pub text: String,
    pub scope: NativeFileSearchScope,
    pub kind: NativeFileSearchKind,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileSearchStatus {
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileSearchSnapshot {
    pub id: String,
    pub query: NativeFileSearchQuery,
    pub state: NativeFileSearchStatus,
    pub scanned_entries: u64,
    pub matched_entries: u64,
    pub inaccessible_entries: u64,
    pub retained_results: usize,
    pub result_limit: usize,
    pub truncated: bool,
    pub duration_ms: f64,
    pub result_offset: usize,
    pub results: Vec<NativeFileMetadata>,
    pub error: Option<NativeFilesystemError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileSearchRelease {
    pub released: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileSearchDiagnostics {
    pub active_searches: usize,
    pub retained_searches: usize,
    pub retained_results: usize,
}

struct SearchProgress {
    state: NativeFileSearchStatus,
    scanned_entries: u64,
    matched_entries: u64,
    inaccessible_entries: u64,
    results: Vec<NativeFileMetadata>,
    truncated: bool,
    error: Option<NativeFilesystemError>,
    finished_at: Option<Instant>,
}

struct NativeFileSearchJob {
    id: String,
    query: NativeFileSearchQuery,
    started_at: Instant,
    cancelled: AtomicBool,
    released: AtomicBool,
    progress: Mutex<SearchProgress>,
}

#[derive(Clone, Default)]
pub struct NativeFileSearchState {
    jobs: Arc<Mutex<HashMap<String, Arc<NativeFileSearchJob>>>>,
}

#[derive(Default)]
struct PendingProgress {
    scanned_entries: u64,
    matched_entries: u64,
    inaccessible_entries: u64,
    results: Vec<NativeFileMetadata>,
    truncated: bool,
    last_flush: Option<Instant>,
}

fn search_error(code: NativeFilesystemErrorCode, message: &'static str) -> NativeFilesystemError {
    NativeFilesystemError::new(code, message)
}

fn random_id() -> Result<String, NativeFilesystemError> {
    let mut bytes = [0_u8; 16];
    random_fill(&mut bytes).map_err(|_| {
        search_error(
            NativeFilesystemErrorCode::IoError,
            "Windows could not initialize the native file search.",
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn validate_id(id: &str) -> Result<(), NativeFilesystemError> {
    if id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(NativeFilesystemError::invalid_path())
    }
}

fn normalized_extension(extension: &str) -> Option<String> {
    let value = extension
        .trim()
        .trim_start_matches("*.")
        .trim_start_matches('.')
        .to_lowercase();
    (!value.is_empty()
        && value.encode_utf16().count() <= MAX_EXTENSION_UNITS
        && value
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, '-' | '_')))
    .then_some(value)
}

fn validate_query(
    mut query: NativeFileSearchQuery,
) -> Result<(NativeFileSearchQuery, PathBuf), NativeFilesystemError> {
    let requested_root = validate_path(&query.root_path)?;
    let metadata = fs::metadata(backend_path(&requested_root)).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The search location could not be opened.")
    })?;
    if !metadata.is_dir() {
        return Err(search_error(
            NativeFilesystemErrorCode::NotDirectory,
            "Native file search requires a directory.",
        ));
    }

    query.text = query.text.trim().to_string();
    if query.text.encode_utf16().count() > MAX_QUERY_UNITS {
        return Err(search_error(
            NativeFilesystemErrorCode::InvalidPath,
            "The search query is too long.",
        ));
    }
    if query.extensions.len() > MAX_EXTENSIONS {
        return Err(search_error(
            NativeFilesystemErrorCode::InvalidPath,
            "Too many file extensions were requested.",
        ));
    }
    let mut extensions = query
        .extensions
        .iter()
        .filter_map(|extension| normalized_extension(extension))
        .collect::<Vec<_>>();
    extensions.sort();
    extensions.dedup();
    if extensions.len() != query.extensions.len() {
        return Err(search_error(
            NativeFilesystemErrorCode::InvalidPath,
            "A search extension is invalid.",
        ));
    }
    query.extensions = extensions;
    if query.text.is_empty() && query.extensions.is_empty() {
        return Err(search_error(
            NativeFilesystemErrorCode::InvalidPath,
            "Enter a filename or choose a file type before searching.",
        ));
    }

    let root = match query.scope {
        NativeFileSearchScope::CurrentFolder | NativeFileSearchScope::CurrentTree => requested_root,
        NativeFileSearchScope::SelectedDrive => {
            if query.root_path.starts_with("\\\\") {
                return Err(search_error(
                    NativeFilesystemErrorCode::InvalidPath,
                    "Selected Drive search does not automatically traverse network locations.",
                ));
            }
            requested_root
                .ancestors()
                .last()
                .map(Path::to_path_buf)
                .ok_or_else(NativeFilesystemError::invalid_path)?
        }
    };
    query.root_path = path_string(&root);
    Ok((query, root))
}

#[cfg(windows)]
fn backend_path(path: &Path) -> PathBuf {
    let value = path.as_os_str().to_string_lossy();
    if value.starts_with(r"\\?\") {
        return path.to_path_buf();
    }
    if let Some(unc) = value.strip_prefix(r"\\") {
        return PathBuf::from(format!(r"\\?\UNC\{unc}"));
    }
    PathBuf::from(format!(r"\\?\{value}"))
}

#[cfg(not(windows))]
fn backend_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

#[cfg(windows)]
fn public_path(path: &Path) -> PathBuf {
    let value = path.as_os_str().to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    if let Some(value) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(value);
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
fn public_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn matches_query(metadata: &NativeFileMetadata, query: &NativeFileSearchQuery) -> bool {
    let kind_matches = match query.kind {
        NativeFileSearchKind::All => true,
        NativeFileSearchKind::Files => metadata.kind == NativeFileKind::File,
        NativeFileSearchKind::Folders => {
            matches!(
                metadata.kind,
                NativeFileKind::Directory | NativeFileKind::ReparsePoint
            ) && metadata.navigable
        }
    };
    if !kind_matches {
        return false;
    }
    if !query.extensions.is_empty()
        && !metadata
            .extension
            .as_ref()
            .is_some_and(|extension| query.extensions.contains(&extension.to_lowercase()))
    {
        return false;
    }
    query.text.is_empty()
        || metadata
            .name
            .to_lowercase()
            .contains(&query.text.to_lowercase())
}

fn terminal(state: NativeFileSearchStatus) -> bool {
    matches!(
        state,
        NativeFileSearchStatus::Completed
            | NativeFileSearchStatus::Cancelled
            | NativeFileSearchStatus::Failed
    )
}

fn flush_progress(job: &NativeFileSearchJob, pending: &mut PendingProgress, force: bool) {
    let now = Instant::now();
    let should_flush = force
        || pending.scanned_entries >= PROGRESS_FLUSH_ENTRIES
        || pending.results.len() >= RESULT_BATCH_LIMIT
        || pending
            .last_flush
            .is_none_or(|last_flush| last_flush.elapsed() >= PROGRESS_FLUSH_INTERVAL);
    if !should_flush {
        return;
    }
    if let Ok(mut progress) = job.progress.lock() {
        progress.scanned_entries = progress
            .scanned_entries
            .saturating_add(pending.scanned_entries);
        progress.matched_entries = progress
            .matched_entries
            .saturating_add(pending.matched_entries);
        progress.inaccessible_entries = progress
            .inaccessible_entries
            .saturating_add(pending.inaccessible_entries);
        let available = RESULT_LIMIT.saturating_sub(progress.results.len());
        let retained = available.min(pending.results.len());
        progress.results.extend(pending.results.drain(..retained));
        pending.results.clear();
        progress.truncated |= pending.truncated || retained < pending.matched_entries as usize;
    }
    pending.scanned_entries = 0;
    pending.matched_entries = 0;
    pending.inaccessible_entries = 0;
    pending.truncated = false;
    pending.last_flush = Some(now);
}

fn record_entry(
    job: &NativeFileSearchJob,
    pending: &mut PendingProgress,
    metadata: NativeFileMetadata,
) {
    pending.scanned_entries = pending.scanned_entries.saturating_add(1);
    if matches_query(&metadata, &job.query) {
        pending.matched_entries = pending.matched_entries.saturating_add(1);
        if pending.results.len() < RESULT_LIMIT {
            pending.results.push(metadata);
        } else {
            pending.truncated = true;
        }
    }
    flush_progress(job, pending, false);
}

fn mark_inaccessible(job: &NativeFileSearchJob, pending: &mut PendingProgress) {
    pending.inaccessible_entries = pending.inaccessible_entries.saturating_add(1);
    flush_progress(job, pending, false);
}

fn scan(job: &NativeFileSearchJob, root: &Path) -> NativeFileSearchStatus {
    if let Ok(mut progress) = job.progress.lock() {
        progress.state = NativeFileSearchStatus::Running;
    }
    let recursive = job.query.scope != NativeFileSearchScope::CurrentFolder;
    let mut pending = PendingProgress {
        last_flush: Some(Instant::now()),
        ..PendingProgress::default()
    };
    let root = backend_path(root);
    let first = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(_) => {
            mark_inaccessible(job, &mut pending);
            flush_progress(job, &mut pending, true);
            return NativeFileSearchStatus::Failed;
        }
    };
    let mut directories = vec![first];

    while let Some(entries) = directories.last_mut() {
        if job.cancelled.load(Ordering::Acquire) {
            flush_progress(job, &mut pending, true);
            return NativeFileSearchStatus::Cancelled;
        }
        let Some(next) = entries.next() else {
            directories.pop();
            continue;
        };
        let entry = match next {
            Ok(entry) => entry,
            Err(_) => {
                mark_inaccessible(job, &mut pending);
                continue;
            }
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let entry_backend_path = entry.path();
        let mut metadata = match metadata_from_path(&entry_backend_path, name) {
            Ok(metadata) => metadata,
            Err(_) => {
                mark_inaccessible(job, &mut pending);
                continue;
            }
        };
        metadata.path = path_string(&public_path(&entry_backend_path));
        let recurse = recursive && metadata.kind == NativeFileKind::Directory;
        record_entry(job, &mut pending, metadata);
        if recurse {
            match fs::read_dir(&entry_backend_path) {
                Ok(children) => directories.push(children),
                Err(_) => mark_inaccessible(job, &mut pending),
            }
        }
    }
    flush_progress(job, &mut pending, true);
    NativeFileSearchStatus::Completed
}

fn finish_job(job: &NativeFileSearchJob, state: NativeFileSearchStatus) {
    if let Ok(mut progress) = job.progress.lock() {
        progress.state = state;
        if state == NativeFileSearchStatus::Failed {
            progress.error = Some(search_error(
                NativeFilesystemErrorCode::IoError,
                "The search root became unavailable before it could be scanned.",
            ));
        }
        if state == NativeFileSearchStatus::Cancelled || job.released.load(Ordering::Acquire) {
            progress.results.clear();
        }
        progress.finished_at = Some(Instant::now());
    }
}

impl NativeFileSearchJob {
    fn snapshot(
        &self,
        result_offset: usize,
    ) -> Result<NativeFileSearchSnapshot, NativeFilesystemError> {
        let progress = self.progress.lock().map_err(|_| {
            search_error(
                NativeFilesystemErrorCode::IoError,
                "The native search state is unavailable.",
            )
        })?;
        let offset = result_offset.min(progress.results.len());
        let end = (offset + RESULT_BATCH_LIMIT).min(progress.results.len());
        Ok(NativeFileSearchSnapshot {
            id: self.id.clone(),
            query: self.query.clone(),
            state: progress.state,
            scanned_entries: progress.scanned_entries,
            matched_entries: progress.matched_entries,
            inaccessible_entries: progress.inaccessible_entries,
            retained_results: progress.results.len(),
            result_limit: RESULT_LIMIT,
            truncated: progress.truncated,
            duration_ms: self.started_at.elapsed().as_secs_f64() * 1_000.0,
            result_offset: offset,
            results: progress.results[offset..end].to_vec(),
            error: progress.error.clone(),
        })
    }
}

impl NativeFileSearchState {
    fn prune(&self) {
        let Ok(mut jobs) = self.jobs.lock() else {
            return;
        };
        jobs.retain(|_, job| {
            let Ok(progress) = job.progress.lock() else {
                return false;
            };
            if job.released.load(Ordering::Acquire) && terminal(progress.state) {
                return false;
            }
            progress
                .finished_at
                .is_none_or(|finished| finished.elapsed() < TERMINAL_SEARCH_TTL)
        });
        if jobs.len() <= MAX_SEARCH_RECORDS {
            return;
        }
        let mut terminal_jobs = jobs
            .iter()
            .filter_map(|(id, job)| {
                job.progress.lock().ok().and_then(|progress| {
                    terminal(progress.state).then_some((id.clone(), job.started_at))
                })
            })
            .collect::<Vec<_>>();
        terminal_jobs.sort_by_key(|(_, started_at)| *started_at);
        for (id, _) in terminal_jobs
            .into_iter()
            .take(jobs.len().saturating_sub(MAX_SEARCH_RECORDS))
        {
            jobs.remove(&id);
        }
    }

    fn start(
        &self,
        query: NativeFileSearchQuery,
    ) -> Result<NativeFileSearchSnapshot, NativeFilesystemError> {
        let (query, root) = validate_query(query)?;
        self.prune();
        let mut jobs = self.jobs.lock().map_err(|_| {
            search_error(
                NativeFilesystemErrorCode::IoError,
                "The native search service is unavailable.",
            )
        })?;
        let active = jobs
            .values()
            .filter(|job| {
                job.progress
                    .lock()
                    .is_ok_and(|progress| !terminal(progress.state))
            })
            .count();
        if active >= MAX_ACTIVE_SEARCHES {
            return Err(search_error(
                NativeFilesystemErrorCode::IoError,
                "Too many native file searches are already running.",
            ));
        }
        let id = random_id()?;
        let job = Arc::new(NativeFileSearchJob {
            id: id.clone(),
            query,
            started_at: Instant::now(),
            cancelled: AtomicBool::new(false),
            released: AtomicBool::new(false),
            progress: Mutex::new(SearchProgress {
                state: NativeFileSearchStatus::Queued,
                scanned_entries: 0,
                matched_entries: 0,
                inaccessible_entries: 0,
                results: Vec::new(),
                truncated: false,
                error: None,
                finished_at: None,
            }),
        });
        let initial = job.snapshot(0)?;
        jobs.insert(id.clone(), Arc::clone(&job));
        drop(jobs);
        let state = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let status = scan(&job, &root);
            finish_job(&job, status);
            if job.released.load(Ordering::Acquire) {
                if let Ok(mut jobs) = state.jobs.lock() {
                    jobs.remove(&id);
                }
            }
        });
        Ok(initial)
    }

    fn get(
        &self,
        id: &str,
        result_offset: usize,
    ) -> Result<NativeFileSearchSnapshot, NativeFilesystemError> {
        validate_id(id)?;
        if result_offset > RESULT_LIMIT {
            return Err(NativeFilesystemError::invalid_path());
        }
        self.prune();
        let jobs = self.jobs.lock().map_err(|_| {
            search_error(
                NativeFilesystemErrorCode::IoError,
                "The native search service is unavailable.",
            )
        })?;
        jobs.get(id)
            .ok_or_else(|| {
                search_error(
                    NativeFilesystemErrorCode::NotFound,
                    "The native search is no longer available.",
                )
            })?
            .snapshot(result_offset)
    }

    fn cancel(&self, id: &str) -> Result<NativeFileSearchSnapshot, NativeFilesystemError> {
        validate_id(id)?;
        let jobs = self.jobs.lock().map_err(|_| {
            search_error(
                NativeFilesystemErrorCode::IoError,
                "The native search service is unavailable.",
            )
        })?;
        let job = jobs.get(id).ok_or_else(|| {
            search_error(
                NativeFilesystemErrorCode::NotFound,
                "The native search is no longer available.",
            )
        })?;
        job.cancelled.store(true, Ordering::Release);
        job.snapshot(0)
    }

    fn release(&self, id: &str) -> Result<NativeFileSearchRelease, NativeFilesystemError> {
        validate_id(id)?;
        let mut jobs = self.jobs.lock().map_err(|_| {
            search_error(
                NativeFilesystemErrorCode::IoError,
                "The native search service is unavailable.",
            )
        })?;
        let job = jobs.get(id).cloned().ok_or_else(|| {
            search_error(
                NativeFilesystemErrorCode::NotFound,
                "The native search is no longer available.",
            )
        })?;
        job.cancelled.store(true, Ordering::Release);
        job.released.store(true, Ordering::Release);
        let finished = job.progress.lock().is_ok_and(|mut progress| {
            progress.results.clear();
            terminal(progress.state)
        });
        if finished {
            jobs.remove(id);
        }
        Ok(NativeFileSearchRelease { released: true })
    }

    fn diagnostics(&self) -> NativeFileSearchDiagnostics {
        self.prune();
        let Ok(jobs) = self.jobs.lock() else {
            return NativeFileSearchDiagnostics {
                active_searches: 0,
                retained_searches: 0,
                retained_results: 0,
            };
        };
        let mut active_searches = 0;
        let mut retained_results = 0;
        for job in jobs.values() {
            if let Ok(progress) = job.progress.lock() {
                if !terminal(progress.state) {
                    active_searches += 1;
                }
                retained_results += progress.results.len();
            }
        }
        NativeFileSearchDiagnostics {
            active_searches,
            retained_searches: jobs.len(),
            retained_results,
        }
    }
}

impl Drop for NativeFileSearchState {
    fn drop(&mut self) {
        if Arc::strong_count(&self.jobs) != 1 {
            return;
        }
        if let Ok(jobs) = self.jobs.lock() {
            for job in jobs.values() {
                job.cancelled.store(true, Ordering::Release);
                job.released.store(true, Ordering::Release);
            }
        }
    }
}

#[tauri::command]
pub fn start_native_file_search(
    query: NativeFileSearchQuery,
    state: State<'_, NativeFileSearchState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileSearchSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.start(query)))
}

#[tauri::command]
pub fn get_native_file_search(
    id: String,
    result_offset: usize,
    state: State<'_, NativeFileSearchState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileSearchSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(
        state.get(&id, result_offset),
    ))
}

#[tauri::command]
pub fn cancel_native_file_search(
    id: String,
    state: State<'_, NativeFileSearchState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileSearchSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.cancel(&id)))
}

#[tauri::command]
pub fn release_native_file_search(
    id: String,
    state: State<'_, NativeFileSearchState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileSearchRelease>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.release(&id)))
}

#[tauri::command]
pub fn get_native_file_search_diagnostics(
    state: State<'_, NativeFileSearchState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileSearchDiagnostics>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(Ok(
        state.diagnostics()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{thread, time::SystemTime};

    fn fixture(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("NammuFilesF3ATest-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn query(root: &Path, text: &str) -> NativeFileSearchQuery {
        NativeFileSearchQuery {
            root_path: path_string(root),
            text: text.to_string(),
            scope: NativeFileSearchScope::CurrentTree,
            kind: NativeFileSearchKind::All,
            extensions: Vec::new(),
        }
    }

    fn run(job_query: NativeFileSearchQuery) -> NativeFileSearchSnapshot {
        let state = NativeFileSearchState::default();
        let initial = state.start(job_query).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let snapshot = state.get(&initial.id, 0).unwrap();
            if terminal(snapshot.state) {
                return snapshot;
            }
            assert!(Instant::now() < deadline, "search timed out");
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn matches_exact_partial_case_extension_kind_and_zero_results() {
        let root = fixture("matching");
        fs::create_dir_all(root.join("Projects")).unwrap();
        fs::write(root.join("Invoice-2026.PDF"), b"pdf").unwrap();
        fs::write(root.join("report.ts"), b"ts").unwrap();

        let exact = run(query(&root, "Invoice-2026.PDF"));
        assert_eq!(exact.matched_entries, 1);
        assert_eq!(exact.results[0].name, "Invoice-2026.PDF");
        assert_eq!(run(query(&root, "invoice")).matched_entries, 1);
        assert_eq!(run(query(&root, "INVOICE")).matched_entries, 1);

        let mut extension = query(&root, "");
        extension.extensions = vec!["pdf".to_string()];
        assert_eq!(run(extension).matched_entries, 1);

        let mut folders = query(&root, "project");
        folders.kind = NativeFileSearchKind::Folders;
        assert_eq!(run(folders).matched_entries, 1);
        let mut files = query(&root, "project");
        files.kind = NativeFileSearchKind::Files;
        assert_eq!(run(files).matched_entries, 0);
        assert_eq!(run(query(&root, "missing-result")).matched_entries, 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn traverses_unicode_spaces_long_paths_and_empty_directories() {
        let root = fixture("paths");
        let nested = root.join("Reports and notes").join("Unicode-हिंदी");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir_all(root.join("Empty folder")).unwrap();
        let mut long = nested;
        for index in 0..8 {
            long = long.join(format!("long-segment-{index:02}-abcdefghijklmnop"));
        }
        fs::create_dir_all(backend_path(&long)).unwrap();
        fs::write(backend_path(&long.join("needle-long-path.txt")), b"found").unwrap();
        let result = run(query(&root, "needle"));
        assert_eq!(result.matched_entries, 1);
        assert!(result.results[0].path.encode_utf16().count() > 260);
        assert!(!result.results[0].path.starts_with(r"\\?\"));
        fs::remove_dir_all(backend_path(&root)).unwrap();
    }

    #[test]
    fn does_not_follow_directory_reparse_points() {
        let root = fixture("reparse");
        let outside = fixture("outside");
        fs::write(outside.join("loop-needle.txt"), b"outside").unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside, root.join("linked-folder")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("linked-folder")).unwrap();
        let result = run(query(&root, "needle"));
        assert_eq!(result.matched_entries, 0);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn reports_missing_roots_and_rejects_empty_queries() {
        let missing = std::env::temp_dir().join("NammuFilesF3ATest-missing-root");
        let state = NativeFileSearchState::default();
        assert_eq!(
            state.start(query(&missing, "needle")).unwrap_err().code,
            NativeFilesystemErrorCode::NotFound
        );
        let root = fixture("empty-query");
        assert_eq!(
            state.start(query(&root, "   ")).unwrap_err().code,
            NativeFilesystemErrorCode::InvalidPath
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn skips_an_inaccessible_subtree_and_continues_other_locations() {
        use std::{fs::OpenOptions, os::windows::fs::OpenOptionsExt};

        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        let root = fixture("inaccessible-subtree");
        let locked = root.join("locked");
        let accessible = root.join("accessible");
        fs::create_dir_all(&locked).unwrap();
        fs::create_dir_all(&accessible).unwrap();
        fs::write(locked.join("needle-locked.txt"), b"locked").unwrap();
        fs::write(accessible.join("needle-accessible.txt"), b"accessible").unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(&locked)
            .unwrap();

        let result = run(query(&root, "needle"));
        assert_eq!(result.state, NativeFileSearchStatus::Completed);
        assert_eq!(result.matched_entries, 1);
        assert_eq!(result.results[0].name, "needle-accessible.txt");
        assert!(result.inaccessible_entries >= 1);

        drop(lock);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn streams_bounded_batches_caps_results_and_releases_jobs() {
        let root = fixture("bounded");
        for index in 0..(RESULT_LIMIT + 40) {
            fs::write(root.join(format!("match-{index:05}.txt")), b"x").unwrap();
        }
        let state = NativeFileSearchState::default();
        let started = state.start(query(&root, "match")).unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        let terminal_snapshot = loop {
            let snapshot = state.get(&started.id, 0).unwrap();
            assert!(snapshot.results.len() <= RESULT_BATCH_LIMIT);
            if terminal(snapshot.state) {
                break snapshot;
            }
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(5));
        };
        assert_eq!(
            terminal_snapshot.matched_entries,
            (RESULT_LIMIT + 40) as u64
        );
        assert_eq!(terminal_snapshot.retained_results, RESULT_LIMIT);
        assert!(terminal_snapshot.truncated);
        assert_eq!(
            state
                .get(&started.id, RESULT_LIMIT - 50)
                .unwrap()
                .results
                .len(),
            50
        );
        state.release(&started.id).unwrap();
        assert_eq!(state.diagnostics().retained_searches, 0);

        let first = state.start(query(&root, "match")).unwrap();
        let second = state.start(query(&root, "match")).unwrap();
        let rejected = state.start(query(&root, "match")).unwrap_err();
        assert_eq!(rejected.code, NativeFilesystemErrorCode::IoError);
        assert!(rejected.message.contains("Too many"));
        state.release(&first.id).unwrap();
        state.release(&second.id).unwrap();
        let cleanup_deadline = Instant::now() + Duration::from_secs(2);
        while state.diagnostics().active_searches > 0 {
            assert!(Instant::now() < cleanup_deadline);
            thread::sleep(Duration::from_millis(2));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancellation_is_real_and_clears_native_results() {
        let root = fixture("cancel");
        for directory in 0..50 {
            let folder = root.join(format!("folder-{directory:03}"));
            fs::create_dir_all(&folder).unwrap();
            for file in 0..100 {
                fs::write(folder.join(format!("match-{file:03}.txt")), b"x").unwrap();
            }
        }
        let state = NativeFileSearchState::default();
        let started = state.start(query(&root, "match")).unwrap();
        state.cancel(&started.id).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let snapshot = state.get(&started.id, 0).unwrap();
            if snapshot.state == NativeFileSearchStatus::Cancelled {
                assert_eq!(snapshot.retained_results, 0);
                break;
            }
            assert!(
                Instant::now() < deadline,
                "cancellation was not observed quickly"
            );
            thread::sleep(Duration::from_millis(2));
        }
        state.release(&started.id).unwrap();
        assert_eq!(state.diagnostics().active_searches, 0);
        fs::remove_dir_all(root).unwrap();
    }
}
