mod safety;

use crate::native_filesystem::{
    path_string, require_trusted_caller, validate_path, NativeFilesystemError,
    NativeFilesystemErrorCode, NativeFilesystemResponse,
};
use getrandom::fill as random_fill;
use safety::{
    destination_path as archive_destination_path, display_name, ensure_free_space,
    ensure_no_reparse_ancestors, is_reparse_point, keep_both_path, normalize_archive_path,
    path_key, validate_declared_limits, BUFFER_BYTES, MAX_ARCHIVE_ENTRIES, MAX_LIST_PAGE,
    MAX_TOTAL_BYTES,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, UNIX_EPOCH},
};
use tauri::{State, Webview};
use zip::{
    read::ZipArchive,
    write::{SimpleFileOptions, ZipWriter},
    CompressionMethod,
};

const MAX_OPEN_ARCHIVES: usize = 16;
const MAX_ACTIVE_JOBS: usize = 2;
const MAX_JOB_RECORDS: usize = 32;
const TERMINAL_JOB_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeArchiveEntryKind {
    File,
    Directory,
    Symlink,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeArchiveEntry {
    pub id: String,
    pub path: String,
    pub parent_path: String,
    pub name: String,
    pub kind: NativeArchiveEntryKind,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub modified: Option<String>,
    pub compression_method: String,
    pub encrypted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeArchiveSummary {
    pub id: String,
    pub archive_path: String,
    pub name: String,
    pub entry_count: usize,
    pub file_count: usize,
    pub directory_count: usize,
    pub encrypted_entries: usize,
    pub symlink_entries: usize,
    pub unsupported_entries: usize,
    pub total_compressed_bytes: u64,
    pub total_uncompressed_bytes: u64,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeArchiveListing {
    pub archive_id: String,
    pub path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<NativeArchiveEntry>,
    pub total_entries: usize,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeArchiveConflictStrategy {
    Skip,
    KeepBoth,
    Cancel,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeArchiveOperationType {
    Extract,
    CreateZip,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeArchiveOperationStatus {
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeArchiveFailure {
    pub entry: String,
    pub error: NativeFilesystemError,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeArchiveOperationSnapshot {
    pub id: String,
    pub operation: NativeArchiveOperationType,
    pub state: NativeArchiveOperationStatus,
    pub archive_path: String,
    pub destination_path: String,
    pub current_entry: Option<String>,
    pub files_completed: u64,
    pub directories_completed: u64,
    pub entries_total: u64,
    pub bytes_processed: u64,
    pub bytes_total: u64,
    pub skipped_entries: u64,
    pub failures: Vec<NativeArchiveFailure>,
    pub error: Option<NativeFilesystemError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeArchiveDiagnostics {
    pub open_archives: usize,
    pub active_jobs: usize,
    pub retained_jobs: usize,
    pub max_active_jobs: usize,
    pub max_archive_entries: usize,
    pub max_total_uncompressed_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeArchiveRelease {
    pub released: bool,
}

#[derive(Clone, PartialEq, Eq)]
struct FileIdentity {
    length: u64,
    modified_nanos: u128,
}

#[derive(Clone)]
struct StoredArchiveEntry {
    public: NativeArchiveEntry,
    raw_index: Option<usize>,
    supported: bool,
}

#[derive(Clone)]
struct ArchiveSession {
    summary: NativeArchiveSummary,
    identity: FileIdentity,
    entries: Vec<StoredArchiveEntry>,
}

struct ArchiveJob {
    snapshot: Mutex<NativeArchiveOperationSnapshot>,
    cancelled: AtomicBool,
    finished_at: Mutex<Option<Instant>>,
}

#[derive(Clone, Default)]
pub struct NativeArchiveState {
    archives: Arc<Mutex<HashMap<String, Arc<ArchiveSession>>>>,
    jobs: Arc<Mutex<HashMap<String, Arc<ArchiveJob>>>>,
}

fn error(code: NativeFilesystemErrorCode, message: impl Into<String>) -> NativeFilesystemError {
    NativeFilesystemError::new(code, message)
}

fn random_id() -> Result<String, NativeFilesystemError> {
    let mut bytes = [0u8; 16];
    random_fill(&mut bytes).map_err(|_| {
        error(
            NativeFilesystemErrorCode::IoError,
            "A secure archive operation identifier could not be generated.",
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn file_identity(path: &Path) -> Result<FileIdentity, NativeFilesystemError> {
    let metadata = fs::metadata(path).map_err(|value| {
        NativeFilesystemError::from_io(&value, "The ZIP could not be inspected.")
    })?;
    if !metadata.is_file() {
        return Err(error(
            NativeFilesystemErrorCode::ArchiveInvalid,
            "The selected item is not a ZIP file.",
        ));
    }
    let modified_nanos = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    Ok(FileIdentity {
        length: metadata.len(),
        modified_nanos,
    })
}

fn zip_error(value: zip::result::ZipError) -> NativeFilesystemError {
    use zip::result::ZipError;
    match value {
        ZipError::Io(inner) => NativeFilesystemError::from_io(&inner, "The ZIP operation failed."),
        ZipError::UnsupportedArchive(message) => error(
            NativeFilesystemErrorCode::ArchiveUnsupported,
            format!("The ZIP uses an unsupported feature: {message}"),
        ),
        ZipError::InvalidArchive(message) => error(
            NativeFilesystemErrorCode::ArchiveInvalid,
            format!("The ZIP archive is invalid: {message}"),
        ),
        _ => error(
            NativeFilesystemErrorCode::ArchiveCorrupt,
            "The ZIP archive is corrupt or could not be processed.",
        ),
    }
}

fn compression_label(method: CompressionMethod) -> (String, bool) {
    match method {
        CompressionMethod::Stored => ("Stored".to_string(), true),
        CompressionMethod::Deflated => ("Deflate".to_string(), true),
        other => (format!("{other:?}"), false),
    }
}

fn parent_and_name(path: &str) -> (String, String) {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rsplit_once('/') {
        Some((parent, name)) => (parent.to_string(), name.to_string()),
        None => (String::new(), trimmed.to_string()),
    }
}

fn make_implicit_directory(path: String) -> StoredArchiveEntry {
    let normalized = format!("{}/", path.trim_end_matches('/'));
    let (parent_path, name) = parent_and_name(&normalized);
    StoredArchiveEntry {
        public: NativeArchiveEntry {
            id: format!("dir:{}", path_key(&normalized)),
            path: normalized,
            parent_path,
            name,
            kind: NativeArchiveEntryKind::Directory,
            compressed_size: 0,
            uncompressed_size: 0,
            modified: None,
            compression_method: "Directory".to_string(),
            encrypted: false,
        },
        raw_index: None,
        supported: true,
    }
}

fn open_archive_impl(raw_path: &str) -> Result<ArchiveSession, NativeFilesystemError> {
    let started = Instant::now();
    let path = validate_path(raw_path)?;
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
        != Some("zip")
    {
        return Err(error(
            NativeFilesystemErrorCode::ArchiveUnsupported,
            "F5B supports ZIP archives only.",
        ));
    }
    if is_reparse_point(&path)? {
        return Err(error(
            NativeFilesystemErrorCode::ArchiveEntryUnsafe,
            "Archive files exposed through reparse points are not opened.",
        ));
    }
    let identity = file_identity(&path)?;
    let file = File::open(&path)
        .map_err(|value| NativeFilesystemError::from_io(&value, "The ZIP could not be opened."))?;
    let mut archive = ZipArchive::new(BufReader::new(file)).map_err(zip_error)?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(error(
            NativeFilesystemErrorCode::ArchiveLimitExceeded,
            "The ZIP contains more than 100,000 entries.",
        ));
    }

    let id = random_id()?;
    let mut by_key: BTreeMap<String, StoredArchiveEntry> = BTreeMap::new();
    let mut total_compressed = 0u64;
    let mut total_uncompressed = 0u64;
    let mut encrypted_entries = 0usize;
    let mut symlink_entries = 0usize;
    let mut unsupported_entries = 0usize;
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(zip_error)?;
        let is_symlink = entry.is_symlink();
        let is_directory = entry.is_dir();
        let normalized = normalize_archive_path(entry.name(), is_directory)?;
        let key = path_key(&normalized);
        if let Some(existing) = by_key.get(&key) {
            if !(existing.public.kind == NativeArchiveEntryKind::Directory && is_directory) {
                return Err(error(
                    NativeFilesystemErrorCode::ArchiveEntryUnsafe,
                    "The ZIP contains duplicate paths that collide on Windows.",
                ));
            }
        }
        let trimmed = normalized.trim_end_matches('/');
        let parts = trimmed.split('/').collect::<Vec<_>>();
        let mut ancestor = String::new();
        for part in parts.iter().take(parts.len().saturating_sub(1)) {
            if !ancestor.is_empty() {
                ancestor.push('/');
            }
            ancestor.push_str(part);
            let ancestor_key = path_key(&ancestor);
            match by_key.get(&ancestor_key) {
                Some(existing) if existing.public.kind != NativeArchiveEntryKind::Directory => {
                    return Err(error(
                        NativeFilesystemErrorCode::ArchiveEntryUnsafe,
                        "The ZIP contains a file/directory path collision.",
                    ));
                }
                Some(_) => {}
                None => {
                    by_key.insert(ancestor_key, make_implicit_directory(ancestor.clone()));
                    if by_key.len() > MAX_ARCHIVE_ENTRIES {
                        return Err(error(
                            NativeFilesystemErrorCode::ArchiveLimitExceeded,
                            "The ZIP's logical hierarchy exceeds 100,000 entries.",
                        ));
                    }
                }
            }
        }
        let encrypted = entry.encrypted();
        let (compression_method, supported_method) = compression_label(entry.compression());
        let kind = if is_symlink {
            NativeArchiveEntryKind::Symlink
        } else if is_directory {
            NativeArchiveEntryKind::Directory
        } else {
            NativeArchiveEntryKind::File
        };
        if encrypted {
            encrypted_entries += 1;
        }
        if is_symlink {
            symlink_entries += 1;
        }
        if !supported_method {
            unsupported_entries += 1;
        }
        total_compressed = total_compressed.saturating_add(entry.compressed_size());
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_TOTAL_BYTES {
            return Err(error(
                NativeFilesystemErrorCode::ArchiveLimitExceeded,
                "The ZIP's declared output exceeds the total extraction limit.",
            ));
        }
        let (parent_path, name) = parent_and_name(&normalized);
        by_key.insert(
            key,
            StoredArchiveEntry {
                public: NativeArchiveEntry {
                    id: format!("entry:{index}"),
                    path: normalized,
                    parent_path,
                    name,
                    kind,
                    compressed_size: entry.compressed_size(),
                    uncompressed_size: entry.size(),
                    modified: entry.last_modified().map(|value| value.to_string()),
                    compression_method,
                    encrypted,
                },
                raw_index: Some(index),
                supported: supported_method,
            },
        );
        if by_key.len() > MAX_ARCHIVE_ENTRIES {
            return Err(error(
                NativeFilesystemErrorCode::ArchiveLimitExceeded,
                "The ZIP's logical hierarchy exceeds 100,000 entries.",
            ));
        }
    }

    let entries = by_key.into_values().collect::<Vec<_>>();
    let file_count = entries
        .iter()
        .filter(|entry| entry.public.kind == NativeArchiveEntryKind::File)
        .count();
    let directory_count = entries
        .iter()
        .filter(|entry| entry.public.kind == NativeArchiveEntryKind::Directory)
        .count();
    Ok(ArchiveSession {
        summary: NativeArchiveSummary {
            id,
            archive_path: path_string(&path),
            name: display_name(&path),
            entry_count: entries.len(),
            file_count,
            directory_count,
            encrypted_entries,
            symlink_entries,
            unsupported_entries,
            total_compressed_bytes: total_compressed,
            total_uncompressed_bytes: total_uncompressed,
            duration_ms: started.elapsed().as_secs_f64() * 1_000.0,
        },
        identity,
        entries,
    })
}

fn verify_session(session: &ArchiveSession) -> Result<(), NativeFilesystemError> {
    let current = file_identity(Path::new(&session.summary.archive_path))?;
    if current != session.identity {
        return Err(error(
            NativeFilesystemErrorCode::FileChanged,
            "The ZIP changed outside Nammu. Close and reopen it before continuing.",
        ));
    }
    Ok(())
}

fn cleanup_state(state: &NativeArchiveState) {
    let mut jobs = state.jobs.lock().unwrap();
    let now = Instant::now();
    jobs.retain(|_, job| {
        job.finished_at
            .lock()
            .unwrap()
            .map(|finished| now.duration_since(finished) < TERMINAL_JOB_TTL)
            .unwrap_or(true)
    });
    if jobs.len() > MAX_JOB_RECORDS {
        let mut finished = jobs
            .iter()
            .filter_map(|(id, job)| {
                job.finished_at
                    .lock()
                    .unwrap()
                    .map(|time| (id.clone(), time))
            })
            .collect::<Vec<_>>();
        finished.sort_by_key(|(_, time)| *time);
        let remove = jobs.len().saturating_sub(MAX_JOB_RECORDS);
        for (id, _) in finished.into_iter().take(remove) {
            jobs.remove(&id);
        }
    }
}

fn active_job_count(state: &NativeArchiveState) -> usize {
    state
        .jobs
        .lock()
        .unwrap()
        .values()
        .filter(|job| {
            matches!(
                job.snapshot.lock().unwrap().state,
                NativeArchiveOperationStatus::Queued | NativeArchiveOperationStatus::Running
            )
        })
        .count()
}

fn terminal(
    job: &ArchiveJob,
    state: NativeArchiveOperationStatus,
    failure: Option<NativeFilesystemError>,
) {
    let mut snapshot = job.snapshot.lock().unwrap();
    snapshot.state = state;
    snapshot.error = failure;
    snapshot.current_entry = None;
    *job.finished_at.lock().unwrap() = Some(Instant::now());
}

fn selected_entries(
    session: &ArchiveSession,
    selected_ids: &[String],
) -> Result<Vec<StoredArchiveEntry>, NativeFilesystemError> {
    if selected_ids.is_empty() {
        return Ok(session.entries.clone());
    }
    if selected_ids.len() > MAX_ARCHIVE_ENTRIES {
        return Err(error(
            NativeFilesystemErrorCode::ArchiveLimitExceeded,
            "Too many archive entries were selected.",
        ));
    }
    let by_id = session
        .entries
        .iter()
        .map(|entry| (entry.public.id.as_str(), entry))
        .collect::<HashMap<_, _>>();
    let mut prefixes = Vec::new();
    let mut exact = HashSet::new();
    for id in selected_ids {
        let entry = by_id.get(id.as_str()).ok_or_else(|| {
            error(
                NativeFilesystemErrorCode::InvalidPath,
                "The selected archive entry no longer exists.",
            )
        })?;
        exact.insert(entry.public.id.clone());
        if entry.public.kind == NativeArchiveEntryKind::Directory {
            prefixes.push(entry.public.path.clone());
        }
    }
    Ok(session
        .entries
        .iter()
        .filter(|entry| {
            exact.contains(&entry.public.id)
                || prefixes
                    .iter()
                    .any(|prefix| entry.public.path.starts_with(prefix))
        })
        .cloned()
        .collect())
}

fn validate_destination(raw: &str) -> Result<PathBuf, NativeFilesystemError> {
    let destination = validate_path(raw)?;
    let metadata = fs::metadata(&destination).map_err(|value| {
        NativeFilesystemError::from_io(&value, "The extraction destination could not be opened.")
    })?;
    if !metadata.is_dir() {
        return Err(error(
            NativeFilesystemErrorCode::NotDirectory,
            "The extraction destination is not a directory.",
        ));
    }
    if metadata.permissions().readonly() {
        return Err(error(
            NativeFilesystemErrorCode::ReadOnly,
            "The extraction destination is read-only.",
        ));
    }
    if is_reparse_point(&destination)? {
        return Err(error(
            NativeFilesystemErrorCode::ArchiveEntryUnsafe,
            "Extraction into a reparse-point destination is not allowed.",
        ));
    }
    Ok(destination)
}

fn extraction_target(
    root: &Path,
    archive_path: &str,
    strategy: NativeArchiveConflictStrategy,
    is_directory: bool,
) -> Result<Option<PathBuf>, NativeFilesystemError> {
    let candidate = archive_destination_path(root, archive_path);
    ensure_no_reparse_ancestors(root, &candidate)?;
    if !candidate.exists() {
        return Ok(Some(candidate));
    }
    if is_directory && candidate.is_dir() && !is_reparse_point(&candidate)? {
        return Ok(Some(candidate));
    }
    match strategy {
        NativeArchiveConflictStrategy::Skip => Ok(None),
        NativeArchiveConflictStrategy::KeepBoth => Ok(Some(keep_both_path(&candidate)?)),
        NativeArchiveConflictStrategy::Cancel => Err(error(
            NativeFilesystemErrorCode::AlreadyExists,
            "Extraction stopped because an item already exists. Choose Skip or Keep Both.",
        )),
    }
}

fn run_extract(
    job: Arc<ArchiveJob>,
    session: Arc<ArchiveSession>,
    entries: Vec<StoredArchiveEntry>,
    destination: PathBuf,
    strategy: NativeArchiveConflictStrategy,
) {
    let result = (|| -> Result<(), NativeFilesystemError> {
        verify_session(&session)?;
        let archive_file = File::open(&session.summary.archive_path).map_err(|value| {
            NativeFilesystemError::from_io(&value, "The ZIP could not be opened for extraction.")
        })?;
        let mut archive = ZipArchive::new(BufReader::new(archive_file)).map_err(zip_error)?;
        job.snapshot.lock().unwrap().state = NativeArchiveOperationStatus::Running;
        for stored in entries {
            if job.cancelled.load(Ordering::Acquire) {
                return Err(error(
                    NativeFilesystemErrorCode::OperationCancelled,
                    "Archive extraction was cancelled. Completed files were preserved.",
                ));
            }
            {
                let mut snapshot = job.snapshot.lock().unwrap();
                snapshot.current_entry = Some(stored.public.path.clone());
            }
            if stored.public.kind == NativeArchiveEntryKind::Symlink {
                let mut snapshot = job.snapshot.lock().unwrap();
                snapshot.skipped_entries += 1;
                snapshot.failures.push(NativeArchiveFailure {
                    entry: stored.public.path.clone(),
                    error: error(
                        NativeFilesystemErrorCode::ArchiveEntryUnsafe,
                        "Archive symlinks are skipped and never recreated.",
                    ),
                });
                continue;
            }
            if stored.public.encrypted {
                return Err(error(
                    NativeFilesystemErrorCode::ArchiveEncrypted,
                    "Password-protected ZIP extraction is unavailable in this version.",
                ));
            }
            if !stored.supported {
                return Err(error(
                    NativeFilesystemErrorCode::ArchiveUnsupported,
                    "The ZIP uses a compression method that is not enabled in Nammu.",
                ));
            }
            let target = match extraction_target(
                &destination,
                &stored.public.path,
                strategy,
                stored.public.kind == NativeArchiveEntryKind::Directory,
            )? {
                Some(target) => target,
                None => {
                    job.snapshot.lock().unwrap().skipped_entries += 1;
                    continue;
                }
            };
            if stored.public.kind == NativeArchiveEntryKind::Directory {
                fs::create_dir_all(&target).map_err(|value| {
                    NativeFilesystemError::from_io(
                        &value,
                        "An archive folder could not be created.",
                    )
                })?;
                job.snapshot.lock().unwrap().directories_completed += 1;
                continue;
            }
            let raw_index = stored.raw_index.ok_or_else(|| {
                error(
                    NativeFilesystemErrorCode::ArchiveInvalid,
                    "The archive entry index is unavailable.",
                )
            })?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|value| {
                    NativeFilesystemError::from_io(
                        &value,
                        "An extraction folder could not be created.",
                    )
                })?;
                ensure_no_reparse_ancestors(&destination, parent)?;
            }
            let partial = target.with_file_name(format!(
                "{}.nammu-partial-{}",
                target
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("archive-entry"),
                job.snapshot.lock().unwrap().id
            ));
            let write_result = (|| -> Result<(), NativeFilesystemError> {
                let mut input = archive.by_index(raw_index).map_err(zip_error)?;
                let output = OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(&partial)
                    .map_err(|value| {
                        NativeFilesystemError::from_io(
                            &value,
                            "An extracted file could not be created.",
                        )
                    })?;
                let mut output = BufWriter::new(output);
                let mut buffer = vec![0u8; BUFFER_BYTES];
                let mut entry_bytes = 0u64;
                loop {
                    if job.cancelled.load(Ordering::Acquire) {
                        return Err(error(
                            NativeFilesystemErrorCode::OperationCancelled,
                            "Archive extraction was cancelled. Completed files were preserved.",
                        ));
                    }
                    let read = input.read(&mut buffer).map_err(|_| {
                        error(
                            NativeFilesystemErrorCode::ArchiveCorrupt,
                            "An archive entry failed decompression or CRC verification.",
                        )
                    })?;
                    if read == 0 {
                        break;
                    }
                    entry_bytes = entry_bytes.saturating_add(read as u64);
                    if entry_bytes > stored.public.uncompressed_size
                        || entry_bytes > safety::MAX_ENTRY_BYTES
                    {
                        return Err(error(
                            NativeFilesystemErrorCode::ArchiveLimitExceeded,
                            "An archive entry exceeded its declared or permitted output size.",
                        ));
                    }
                    {
                        let mut snapshot = job.snapshot.lock().unwrap();
                        if snapshot.bytes_processed.saturating_add(read as u64) > MAX_TOTAL_BYTES {
                            return Err(error(
                                NativeFilesystemErrorCode::ArchiveLimitExceeded,
                                "Archive extraction exceeded the total output limit.",
                            ));
                        }
                        snapshot.bytes_processed += read as u64;
                    }
                    output.write_all(&buffer[..read]).map_err(|value| {
                        NativeFilesystemError::from_io(
                            &value,
                            "An extracted file could not be written.",
                        )
                    })?;
                }
                if entry_bytes != stored.public.uncompressed_size {
                    return Err(error(
                        NativeFilesystemErrorCode::ArchiveCorrupt,
                        "An extracted entry did not match its declared size.",
                    ));
                }
                output.flush().map_err(|value| {
                    NativeFilesystemError::from_io(
                        &value,
                        "An extracted file could not be finalized.",
                    )
                })?;
                drop(output);
                fs::rename(&partial, &target).map_err(|value| {
                    NativeFilesystemError::from_io(
                        &value,
                        "An extracted file could not be published.",
                    )
                })?;
                Ok(())
            })();
            if write_result.is_err() {
                let _ = fs::remove_file(&partial);
            }
            write_result?;
            job.snapshot.lock().unwrap().files_completed += 1;
        }
        Ok(())
    })();
    match result {
        Ok(()) => terminal(&job, NativeArchiveOperationStatus::Completed, None),
        Err(failure) if failure.code == NativeFilesystemErrorCode::OperationCancelled => {
            terminal(&job, NativeArchiveOperationStatus::Cancelled, Some(failure))
        }
        Err(failure) => terminal(&job, NativeArchiveOperationStatus::Failed, Some(failure)),
    }
}

#[derive(Clone)]
struct CreatePlanEntry {
    source: PathBuf,
    archive_path: String,
    is_directory: bool,
    size: u64,
}

fn scan_create_source(
    source: &Path,
    archive_path: &str,
    destination: &Path,
    partial: &Path,
    plan: &mut Vec<CreatePlanEntry>,
    seen: &mut HashSet<String>,
    skipped: &mut u64,
) -> Result<(), NativeFilesystemError> {
    if source == destination || source == partial {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(source).map_err(|value| {
        NativeFilesystemError::from_io(&value, "A ZIP source could not be inspected.")
    })?;
    if is_reparse_point(source)? {
        *skipped = skipped.saturating_add(1);
        return Ok(());
    }
    let normalized = normalize_archive_path(archive_path, metadata.is_dir())?;
    if !seen.insert(path_key(&normalized)) {
        return Err(error(
            NativeFilesystemErrorCode::AlreadyExists,
            "The selected sources contain colliding archive paths.",
        ));
    }
    plan.push(CreatePlanEntry {
        source: source.to_path_buf(),
        archive_path: normalized.clone(),
        is_directory: metadata.is_dir(),
        size: if metadata.is_file() {
            metadata.len()
        } else {
            0
        },
    });
    if plan.len() > MAX_ARCHIVE_ENTRIES {
        return Err(error(
            NativeFilesystemErrorCode::ArchiveLimitExceeded,
            "ZIP creation is limited to 100,000 entries.",
        ));
    }
    if metadata.is_dir() {
        let mut children = fs::read_dir(source)
            .map_err(|value| {
                NativeFilesystemError::from_io(&value, "A ZIP source folder could not be read.")
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|value| {
                NativeFilesystemError::from_io(&value, "A ZIP source folder could not be read.")
            })?;
        children.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
        for child in children {
            let child_name = child.file_name().to_string_lossy().into_owned();
            let child_archive = format!("{}{child_name}", normalized);
            scan_create_source(
                &child.path(),
                &child_archive,
                destination,
                partial,
                plan,
                seen,
                skipped,
            )?;
        }
    }
    Ok(())
}

fn build_create_plan(
    sources: &[String],
    destination: &Path,
    partial: &Path,
) -> Result<(Vec<CreatePlanEntry>, u64), NativeFilesystemError> {
    if sources.is_empty() || sources.len() > 1_024 {
        return Err(NativeFilesystemError::invalid_path());
    }
    let mut plan = Vec::new();
    let mut seen = HashSet::new();
    let mut skipped = 0u64;
    let mut total = 0u64;
    for raw in sources {
        let source = validate_path(raw)?;
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .ok_or_else(NativeFilesystemError::invalid_path)?;
        scan_create_source(
            &source,
            name,
            destination,
            partial,
            &mut plan,
            &mut seen,
            &mut skipped,
        )?;
    }
    for entry in &plan {
        total = total.saturating_add(entry.size);
        if total > MAX_TOTAL_BYTES {
            return Err(error(
                NativeFilesystemErrorCode::ArchiveLimitExceeded,
                "The selected sources exceed the ZIP creation safety limit.",
            ));
        }
    }
    Ok((plan, skipped))
}

fn run_create(
    job: Arc<ArchiveJob>,
    plan: Vec<CreatePlanEntry>,
    partial: PathBuf,
    destination: PathBuf,
) {
    let result = (|| -> Result<(), NativeFilesystemError> {
        job.snapshot.lock().unwrap().state = NativeArchiveOperationStatus::Running;
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&partial)
            .map_err(|value| {
                NativeFilesystemError::from_io(&value, "The ZIP output could not be created.")
            })?;
        let mut writer = ZipWriter::new(BufWriter::new(file));
        for entry in plan {
            if job.cancelled.load(Ordering::Acquire) {
                return Err(error(
                    NativeFilesystemErrorCode::OperationCancelled,
                    "ZIP creation was cancelled.",
                ));
            }
            job.snapshot.lock().unwrap().current_entry = Some(entry.archive_path.clone());
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .large_file(entry.size > u32::MAX as u64);
            if entry.is_directory {
                writer
                    .add_directory(&entry.archive_path, options)
                    .map_err(zip_error)?;
                job.snapshot.lock().unwrap().directories_completed += 1;
                continue;
            }
            writer
                .start_file(&entry.archive_path, options)
                .map_err(zip_error)?;
            let input = File::open(&entry.source).map_err(|value| {
                NativeFilesystemError::from_io(&value, "A ZIP source file could not be opened.")
            })?;
            let mut input = BufReader::new(input);
            let mut buffer = vec![0u8; BUFFER_BYTES];
            let mut file_bytes = 0u64;
            loop {
                if job.cancelled.load(Ordering::Acquire) {
                    return Err(error(
                        NativeFilesystemErrorCode::OperationCancelled,
                        "ZIP creation was cancelled.",
                    ));
                }
                let read = input.read(&mut buffer).map_err(|value| {
                    NativeFilesystemError::from_io(&value, "A ZIP source file could not be read.")
                })?;
                if read == 0 {
                    break;
                }
                writer.write_all(&buffer[..read]).map_err(|value| {
                    NativeFilesystemError::from_io(&value, "ZIP output could not be written.")
                })?;
                file_bytes += read as u64;
                job.snapshot.lock().unwrap().bytes_processed += read as u64;
            }
            if file_bytes != entry.size {
                return Err(error(
                    NativeFilesystemErrorCode::FileChanged,
                    "A source file changed while the ZIP was being created.",
                ));
            }
            job.snapshot.lock().unwrap().files_completed += 1;
        }
        let mut output = writer.finish().map_err(zip_error)?;
        output.flush().map_err(|value| {
            NativeFilesystemError::from_io(&value, "The ZIP output could not be finalized.")
        })?;
        drop(output);
        fs::rename(&partial, &destination).map_err(|value| {
            NativeFilesystemError::from_io(&value, "The completed ZIP could not be published.")
        })?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    match result {
        Ok(()) => terminal(&job, NativeArchiveOperationStatus::Completed, None),
        Err(failure) if failure.code == NativeFilesystemErrorCode::OperationCancelled => {
            terminal(&job, NativeArchiveOperationStatus::Cancelled, Some(failure))
        }
        Err(failure) => terminal(&job, NativeArchiveOperationStatus::Failed, Some(failure)),
    }
}

#[tauri::command]
pub async fn open_native_archive(
    path: String,
    caller: Webview,
    state: State<'_, NativeArchiveState>,
) -> Result<NativeFilesystemResponse<NativeArchiveSummary>, String> {
    require_trusted_caller(&caller)?;
    let session = match tauri::async_runtime::spawn_blocking(move || open_archive_impl(&path)).await
    {
        Ok(Ok(session)) => session,
        Ok(Err(failure)) => return Ok(NativeFilesystemResponse::from_result(Err(failure))),
        Err(_) => {
            return Ok(NativeFilesystemResponse::from_result(Err(error(
                NativeFilesystemErrorCode::IoError,
                "The archive worker stopped unexpectedly.",
            ))))
        }
    };
    let summary = session.summary.clone();
    let mut archives = state.archives.lock().unwrap();
    if archives.len() >= MAX_OPEN_ARCHIVES {
        return Ok(NativeFilesystemResponse::from_result(Err(error(
            NativeFilesystemErrorCode::ArchiveLimitExceeded,
            "Close another open archive before opening this one.",
        ))));
    }
    archives.insert(summary.id.clone(), Arc::new(session));
    Ok(NativeFilesystemResponse::from_result(Ok(summary)))
}

#[tauri::command]
pub async fn get_native_archive_entries(
    archive_id: String,
    path: String,
    offset: usize,
    limit: usize,
    query: Option<String>,
    caller: Webview,
    state: State<'_, NativeArchiveState>,
) -> Result<NativeFilesystemResponse<NativeArchiveListing>, String> {
    require_trusted_caller(&caller)?;
    let session = state.archives.lock().unwrap().get(&archive_id).cloned();
    let result = (|| -> Result<NativeArchiveListing, NativeFilesystemError> {
        let session = session.ok_or_else(|| {
            error(
                NativeFilesystemErrorCode::NotFound,
                "The archive session is no longer open.",
            )
        })?;
        verify_session(&session)?;
        let normalized_path = if path.is_empty() {
            String::new()
        } else {
            normalize_archive_path(&path, true)?
                .trim_end_matches('/')
                .to_string()
        };
        let query = query.unwrap_or_default().trim().to_lowercase();
        if query.len() > 256 || limit == 0 || limit > MAX_LIST_PAGE {
            return Err(NativeFilesystemError::invalid_path());
        }
        let mut entries = session
            .entries
            .iter()
            .filter(|entry| entry.public.parent_path == normalized_path)
            .filter(|entry| query.is_empty() || entry.public.name.to_lowercase().contains(&query))
            .map(|entry| entry.public.clone())
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            let left_dir = left.kind == NativeArchiveEntryKind::Directory;
            let right_dir = right.kind == NativeArchiveEntryKind::Directory;
            right_dir
                .cmp(&left_dir)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        let total_entries = entries.len();
        let page = entries.into_iter().skip(offset).take(limit).collect();
        let parent_path = normalized_path
            .rsplit_once('/')
            .map(|(parent, _)| parent.to_string())
            .or_else(|| (!normalized_path.is_empty()).then(String::new));
        Ok(NativeArchiveListing {
            archive_id,
            path: normalized_path,
            parent_path,
            entries: page,
            total_entries,
            offset,
            limit,
            has_more: offset.saturating_add(limit) < total_entries,
        })
    })();
    Ok(NativeFilesystemResponse::from_result(result))
}

#[tauri::command]
pub fn release_native_archive(
    archive_id: String,
    caller: Webview,
    state: State<'_, NativeArchiveState>,
) -> Result<NativeFilesystemResponse<NativeArchiveRelease>, String> {
    require_trusted_caller(&caller)?;
    let released = state.archives.lock().unwrap().remove(&archive_id).is_some();
    Ok(NativeFilesystemResponse::from_result(Ok(
        NativeArchiveRelease { released },
    )))
}

#[tauri::command]
pub fn start_native_archive_extract(
    archive_id: String,
    destination_path: String,
    selected_entry_ids: Vec<String>,
    conflict_strategy: NativeArchiveConflictStrategy,
    caller: Webview,
    state: State<'_, NativeArchiveState>,
) -> Result<NativeFilesystemResponse<NativeArchiveOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    cleanup_state(&state);
    if active_job_count(&state) >= MAX_ACTIVE_JOBS {
        return Ok(NativeFilesystemResponse::from_result(Err(error(
            NativeFilesystemErrorCode::ArchiveLimitExceeded,
            "Two archive operations are already running.",
        ))));
    }
    let session = match state.archives.lock().unwrap().get(&archive_id).cloned() {
        Some(session) => session,
        None => {
            return Ok(NativeFilesystemResponse::from_result(Err(error(
                NativeFilesystemErrorCode::NotFound,
                "The archive session is no longer open.",
            ))))
        }
    };
    let destination = match validate_destination(&destination_path) {
        Ok(value) => value,
        Err(failure) => return Ok(NativeFilesystemResponse::from_result(Err(failure))),
    };
    let entries = match selected_entries(&session, &selected_entry_ids) {
        Ok(value) => value,
        Err(failure) => return Ok(NativeFilesystemResponse::from_result(Err(failure))),
    };
    let preflight = (|| -> Result<(), NativeFilesystemError> {
        let mut total = 0u64;
        for entry in &entries {
            if entry.public.kind == NativeArchiveEntryKind::Symlink {
                continue;
            }
            if entry.public.encrypted {
                return Err(error(
                    NativeFilesystemErrorCode::ArchiveEncrypted,
                    "Password-protected ZIP extraction is unavailable in this version.",
                ));
            }
            if !entry.supported {
                return Err(error(
                    NativeFilesystemErrorCode::ArchiveUnsupported,
                    "The ZIP uses a compression method that is not enabled in Nammu.",
                ));
            }
            validate_declared_limits(entry.public.compressed_size, entry.public.uncompressed_size)?;
            total = total.saturating_add(entry.public.uncompressed_size);
            if total > MAX_TOTAL_BYTES {
                return Err(error(
                    NativeFilesystemErrorCode::ArchiveLimitExceeded,
                    "The selected archive output exceeds the total extraction limit.",
                ));
            }
        }
        Ok(())
    })();
    if let Err(failure) = preflight {
        return Ok(NativeFilesystemResponse::from_result(Err(failure)));
    }
    if conflict_strategy == NativeArchiveConflictStrategy::Cancel {
        for entry in &entries {
            if entry.public.kind == NativeArchiveEntryKind::Symlink {
                continue;
            }
            let candidate = archive_destination_path(&destination, &entry.public.path);
            if let Err(failure) = ensure_no_reparse_ancestors(&destination, &candidate) {
                return Ok(NativeFilesystemResponse::from_result(Err(failure)));
            }
            if candidate.exists()
                && !(entry.public.kind == NativeArchiveEntryKind::Directory && candidate.is_dir())
            {
                return Ok(NativeFilesystemResponse::from_result(Err(error(
                    NativeFilesystemErrorCode::AlreadyExists,
                    "Extraction was not started because an output item already exists.",
                ))));
            }
        }
    }
    let required_bytes = entries
        .iter()
        .map(|entry| entry.public.uncompressed_size)
        .sum();
    if let Err(failure) = ensure_free_space(&destination, required_bytes) {
        return Ok(NativeFilesystemResponse::from_result(Err(failure)));
    }
    let id = match random_id() {
        Ok(value) => value,
        Err(failure) => return Ok(NativeFilesystemResponse::from_result(Err(failure))),
    };
    let snapshot = NativeArchiveOperationSnapshot {
        id: id.clone(),
        operation: NativeArchiveOperationType::Extract,
        state: NativeArchiveOperationStatus::Queued,
        archive_path: session.summary.archive_path.clone(),
        destination_path: path_string(&destination),
        current_entry: None,
        files_completed: 0,
        directories_completed: 0,
        entries_total: entries.len() as u64,
        bytes_processed: 0,
        bytes_total: entries
            .iter()
            .map(|entry| entry.public.uncompressed_size)
            .sum(),
        skipped_entries: 0,
        failures: Vec::new(),
        error: None,
    };
    let job = Arc::new(ArchiveJob {
        snapshot: Mutex::new(snapshot.clone()),
        cancelled: AtomicBool::new(false),
        finished_at: Mutex::new(None),
    });
    state.jobs.lock().unwrap().insert(id, job.clone());
    std::thread::spawn(move || run_extract(job, session, entries, destination, conflict_strategy));
    Ok(NativeFilesystemResponse::from_result(Ok(snapshot)))
}

#[tauri::command]
pub fn start_native_zip_create(
    sources: Vec<String>,
    destination_path: String,
    conflict_strategy: NativeArchiveConflictStrategy,
    caller: Webview,
    state: State<'_, NativeArchiveState>,
) -> Result<NativeFilesystemResponse<NativeArchiveOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    cleanup_state(&state);
    if active_job_count(&state) >= MAX_ACTIVE_JOBS {
        return Ok(NativeFilesystemResponse::from_result(Err(error(
            NativeFilesystemErrorCode::ArchiveLimitExceeded,
            "Two archive operations are already running.",
        ))));
    }
    let requested = match validate_path(&destination_path) {
        Ok(value) => value,
        Err(failure) => return Ok(NativeFilesystemResponse::from_result(Err(failure))),
    };
    if requested
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
        != Some("zip")
    {
        return Ok(NativeFilesystemResponse::from_result(Err(error(
            NativeFilesystemErrorCode::InvalidName,
            "The archive destination must use the .zip extension.",
        ))));
    }
    let destination = if requested.exists() {
        match conflict_strategy {
            NativeArchiveConflictStrategy::KeepBoth => match keep_both_path(&requested) {
                Ok(value) => value,
                Err(failure) => return Ok(NativeFilesystemResponse::from_result(Err(failure))),
            },
            NativeArchiveConflictStrategy::Skip => {
                return Ok(NativeFilesystemResponse::from_result(Err(error(
                    NativeFilesystemErrorCode::AlreadyExists,
                    "The ZIP destination already exists.",
                ))))
            }
            NativeArchiveConflictStrategy::Cancel => {
                return Ok(NativeFilesystemResponse::from_result(Err(error(
                    NativeFilesystemErrorCode::AlreadyExists,
                    "The ZIP destination already exists. Choose another name.",
                ))))
            }
        }
    } else {
        requested
    };
    let parent = match destination.parent() {
        Some(value) => value,
        None => {
            return Ok(NativeFilesystemResponse::from_result(Err(
                NativeFilesystemError::invalid_path(),
            )))
        }
    };
    if let Err(failure) = validate_destination(&path_string(parent)) {
        return Ok(NativeFilesystemResponse::from_result(Err(failure)));
    }
    let id = match random_id() {
        Ok(value) => value,
        Err(failure) => return Ok(NativeFilesystemResponse::from_result(Err(failure))),
    };
    let partial = destination.with_file_name(format!(
        "{}.nammu-partial-{id}",
        destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Archive.zip")
    ));
    let (plan, skipped_entries) = match build_create_plan(&sources, &destination, &partial) {
        Ok(value) => value,
        Err(failure) => return Ok(NativeFilesystemResponse::from_result(Err(failure))),
    };
    let snapshot = NativeArchiveOperationSnapshot {
        id: id.clone(),
        operation: NativeArchiveOperationType::CreateZip,
        state: NativeArchiveOperationStatus::Queued,
        archive_path: path_string(&destination),
        destination_path: path_string(&destination),
        current_entry: None,
        files_completed: 0,
        directories_completed: 0,
        entries_total: plan.len() as u64,
        bytes_processed: 0,
        bytes_total: plan.iter().map(|entry| entry.size).sum(),
        skipped_entries,
        failures: Vec::new(),
        error: None,
    };
    let job = Arc::new(ArchiveJob {
        snapshot: Mutex::new(snapshot.clone()),
        cancelled: AtomicBool::new(false),
        finished_at: Mutex::new(None),
    });
    state.jobs.lock().unwrap().insert(id, job.clone());
    std::thread::spawn(move || run_create(job, plan, partial, destination));
    Ok(NativeFilesystemResponse::from_result(Ok(snapshot)))
}

#[tauri::command]
pub fn get_native_archive_operation(
    id: String,
    caller: Webview,
    state: State<'_, NativeArchiveState>,
) -> Result<NativeFilesystemResponse<NativeArchiveOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    cleanup_state(&state);
    let result = state
        .jobs
        .lock()
        .unwrap()
        .get(&id)
        .map(|job| job.snapshot.lock().unwrap().clone())
        .ok_or_else(|| {
            error(
                NativeFilesystemErrorCode::NotFound,
                "The archive operation is no longer available.",
            )
        });
    Ok(NativeFilesystemResponse::from_result(result))
}

#[tauri::command]
pub fn cancel_native_archive_operation(
    id: String,
    caller: Webview,
    state: State<'_, NativeArchiveState>,
) -> Result<NativeFilesystemResponse<NativeArchiveOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    let result = state
        .jobs
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| {
            error(
                NativeFilesystemErrorCode::NotFound,
                "The archive operation is no longer available.",
            )
        })
        .map(|job| {
            job.cancelled.store(true, Ordering::Release);
            job.snapshot.lock().unwrap().clone()
        });
    Ok(NativeFilesystemResponse::from_result(result))
}

#[tauri::command]
pub fn release_native_archive_operation(
    id: String,
    caller: Webview,
    state: State<'_, NativeArchiveState>,
) -> Result<NativeFilesystemResponse<NativeArchiveRelease>, String> {
    require_trusted_caller(&caller)?;
    let mut jobs = state.jobs.lock().unwrap();
    let released = match jobs.get(&id) {
        Some(job)
            if matches!(
                job.snapshot.lock().unwrap().state,
                NativeArchiveOperationStatus::Queued | NativeArchiveOperationStatus::Running
            ) =>
        {
            false
        }
        Some(_) => {
            jobs.remove(&id);
            true
        }
        None => false,
    };
    Ok(NativeFilesystemResponse::from_result(Ok(
        NativeArchiveRelease { released },
    )))
}

#[tauri::command]
pub fn get_native_archive_diagnostics(
    caller: Webview,
    state: State<'_, NativeArchiveState>,
) -> Result<NativeFilesystemResponse<NativeArchiveDiagnostics>, String> {
    require_trusted_caller(&caller)?;
    cleanup_state(&state);
    let jobs = state.jobs.lock().unwrap();
    let active_jobs = jobs
        .values()
        .filter(|job| {
            matches!(
                job.snapshot.lock().unwrap().state,
                NativeArchiveOperationStatus::Queued | NativeArchiveOperationStatus::Running
            )
        })
        .count();
    Ok(NativeFilesystemResponse::from_result(Ok(
        NativeArchiveDiagnostics {
            open_archives: state.archives.lock().unwrap().len(),
            active_jobs,
            retained_jobs: jobs.len(),
            max_active_jobs: MAX_ACTIVE_JOBS,
            max_archive_entries: MAX_ARCHIVE_ENTRIES,
            max_total_uncompressed_bytes: MAX_TOTAL_BYTES,
        },
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    fn fixture_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "NammuFilesF5BTest-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8], CompressionMethod)]) {
        let file = File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        for (name, bytes, method) in entries {
            writer
                .start_file(
                    *name,
                    SimpleFileOptions::default().compression_method(*method),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn opens_stored_deflated_nested_and_unicode_entries() {
        let root = fixture_root();
        let path = root.join("नम्मु archive.zip");
        write_zip(
            &path,
            &[
                ("nested/stored.txt", b"stored", CompressionMethod::Stored),
                ("nested/चित्र.txt", b"unicode", CompressionMethod::Deflated),
            ],
        );
        let session = open_archive_impl(&path_string(&path)).unwrap();
        assert_eq!(session.summary.file_count, 2);
        assert_eq!(session.summary.directory_count, 1);
        assert!(session
            .entries
            .iter()
            .any(|entry| entry.public.path == "nested/"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_fake_and_truncated_zip() {
        let root = fixture_root();
        let fake = root.join("fake.zip");
        fs::write(&fake, b"not zip").unwrap();
        assert!(open_archive_impl(&path_string(&fake)).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn zip_slip_is_rejected_while_opening() {
        let root = fixture_root();
        let path = root.join("slip.zip");
        write_zip(
            &path,
            &[("../../escape.txt", b"no", CompressionMethod::Stored)],
        );
        let failure = open_archive_impl(&path_string(&path)).err().unwrap();
        assert_eq!(failure.code, NativeFilesystemErrorCode::ArchiveEntryUnsafe);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn high_compression_ratio_is_rejected() {
        let failure = validate_declared_limits(1_024, 32 * 1024 * 1024).unwrap_err();
        assert_eq!(
            failure.code,
            NativeFilesystemErrorCode::ArchiveLimitExceeded
        );
    }

    #[test]
    fn writer_round_trip_preserves_bytes() {
        let root = fixture_root();
        let source = root.join("source.txt");
        let archive = root.join("round-trip.zip");
        fs::write(&source, b"round trip bytes").unwrap();
        let partial = root.join("partial.zip");
        let (plan, _) = build_create_plan(&[path_string(&source)], &archive, &partial).unwrap();
        let snapshot = NativeArchiveOperationSnapshot {
            id: "00000000000000000000000000000000".to_string(),
            operation: NativeArchiveOperationType::CreateZip,
            state: NativeArchiveOperationStatus::Queued,
            archive_path: path_string(&archive),
            destination_path: path_string(&archive),
            current_entry: None,
            files_completed: 0,
            directories_completed: 0,
            entries_total: plan.len() as u64,
            bytes_processed: 0,
            bytes_total: 16,
            skipped_entries: 0,
            failures: Vec::new(),
            error: None,
        };
        let job = Arc::new(ArchiveJob {
            snapshot: Mutex::new(snapshot),
            cancelled: AtomicBool::new(false),
            finished_at: Mutex::new(None),
        });
        run_create(job.clone(), plan, partial, archive.clone());
        assert_eq!(
            job.snapshot.lock().unwrap().state,
            NativeArchiveOperationStatus::Completed
        );
        let mut zip = ZipArchive::new(File::open(archive).unwrap()).unwrap();
        let mut bytes = Vec::new();
        zip.by_name("source.txt")
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert_eq!(bytes, b"round trip bytes");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancellation_does_not_publish_partial_zip() {
        let root = fixture_root();
        let source = root.join("large.bin");
        fs::write(&source, vec![7u8; 2 * 1024 * 1024]).unwrap();
        let archive = root.join("cancel.zip");
        let partial = root.join("cancel.partial");
        let (plan, _) = build_create_plan(&[path_string(&source)], &archive, &partial).unwrap();
        let snapshot = NativeArchiveOperationSnapshot {
            id: "00000000000000000000000000000000".to_string(),
            operation: NativeArchiveOperationType::CreateZip,
            state: NativeArchiveOperationStatus::Queued,
            archive_path: path_string(&archive),
            destination_path: path_string(&archive),
            current_entry: None,
            files_completed: 0,
            directories_completed: 0,
            entries_total: plan.len() as u64,
            bytes_processed: 0,
            bytes_total: 2 * 1024 * 1024,
            skipped_entries: 0,
            failures: Vec::new(),
            error: None,
        };
        let job = Arc::new(ArchiveJob {
            snapshot: Mutex::new(snapshot),
            cancelled: AtomicBool::new(true),
            finished_at: Mutex::new(None),
        });
        run_create(job.clone(), plan, partial.clone(), archive.clone());
        assert!(!archive.exists());
        assert!(!partial.exists());
        assert_eq!(
            job.snapshot.lock().unwrap().state,
            NativeArchiveOperationStatus::Cancelled
        );
        fs::remove_dir_all(root).unwrap();
    }
}
