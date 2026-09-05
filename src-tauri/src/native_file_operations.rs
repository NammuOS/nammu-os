use crate::native_filesystem::{
    metadata_from_path, path_string, require_trusted_caller, validate_path, NativeFileMetadata,
    NativeFilesystemError, NativeFilesystemErrorCode, NativeFilesystemResponse,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{State, Webview};

const MAX_BATCH_SOURCES: usize = 1_024;
const MAX_ACTIVE_JOBS: usize = 4;
const MAX_JOB_RECORDS: usize = 64;
const TERMINAL_JOB_TTL: Duration = Duration::from_secs(15 * 60);
const COPY_BUFFER_SIZE: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileConflictStrategy {
    Cancel,
    KeepBoth,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileOperationType {
    Copy,
    Move,
    Duplicate,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileOperationStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileMutation {
    pub entry: NativeFileMetadata,
    pub affected_directories: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileOperationSuccess {
    pub source_path: String,
    pub destination_path: String,
    pub entry: NativeFileMetadata,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileOperationFailure {
    pub source_path: String,
    pub error: NativeFilesystemError,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileOperationSnapshot {
    pub id: String,
    pub operation: NativeFileOperationType,
    pub state: NativeFileOperationStatus,
    pub sources: Vec<String>,
    pub destination_path: Option<String>,
    pub current_item: Option<String>,
    pub files_completed: u64,
    pub files_total: Option<u64>,
    pub bytes_processed: u64,
    pub bytes_total: Option<u64>,
    pub successes: Vec<NativeFileOperationSuccess>,
    pub failures: Vec<NativeFileOperationFailure>,
}

struct NativeFileOperationJob {
    snapshot: Mutex<NativeFileOperationSnapshot>,
    cancelled: AtomicBool,
    created_at: Instant,
    finished_at: Mutex<Option<Instant>>,
}

#[derive(Clone, Default)]
pub struct NativeFileOperationState {
    jobs: Arc<Mutex<HashMap<String, Arc<NativeFileOperationJob>>>>,
}

#[derive(Debug, Clone)]
struct PlannedEntry {
    relative_path: PathBuf,
    is_directory: bool,
}

#[derive(Debug, Clone)]
struct CopyPlan {
    source: PathBuf,
    destination: PathBuf,
    entries: Vec<PlannedEntry>,
    is_directory: bool,
    file_count: u64,
    byte_count: u64,
}

fn operation_error(
    code: NativeFilesystemErrorCode,
    message: &'static str,
) -> NativeFilesystemError {
    NativeFilesystemError::new(code, message)
}

fn validate_item_name(name: &str) -> Result<(), NativeFilesystemError> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.encode_utf16().count() > 255
        || name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
        || name.ends_with([' ', '.'])
    {
        return Err(operation_error(
            NativeFilesystemErrorCode::InvalidName,
            "The item name is not valid on Windows.",
        ));
    }

    let device_name = name
        .split('.')
        .next()
        .unwrap_or(name)
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();
    let reserved = matches!(
        device_name.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$"
    ) || (device_name.len() == 4
        && (device_name.starts_with("COM") || device_name.starts_with("LPT"))
        && matches!(device_name.as_bytes()[3], b'1'..=b'9'));
    if reserved {
        return Err(operation_error(
            NativeFilesystemErrorCode::InvalidName,
            "That name is reserved by Windows.",
        ));
    }
    Ok(())
}

fn validate_existing_directory(raw: &str) -> Result<PathBuf, NativeFilesystemError> {
    let path = validate_path(raw)?;
    let metadata = fs::metadata(&path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The destination could not be inspected.")
    })?;
    if !metadata.is_dir() {
        return Err(operation_error(
            NativeFilesystemErrorCode::NotDirectory,
            "The selected destination is not a directory.",
        ));
    }
    if metadata.permissions().readonly() {
        return Err(operation_error(
            NativeFilesystemErrorCode::ReadOnly,
            "The destination is read-only.",
        ));
    }
    Ok(path)
}

fn item_name(path: &Path) -> Result<String, NativeFilesystemError> {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .ok_or_else(NativeFilesystemError::invalid_path)
}

fn create_directory_impl(
    parent_raw: &str,
    name: &str,
) -> Result<NativeFileMutation, NativeFilesystemError> {
    validate_item_name(name)?;
    let parent = validate_existing_directory(parent_raw)?;
    let destination = parent.join(name);
    validate_path(&path_string(&destination))?;
    fs::create_dir(&destination).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The folder could not be created.")
    })?;
    Ok(NativeFileMutation {
        entry: metadata_from_path(&destination, name.to_string())?,
        affected_directories: vec![path_string(&parent)],
    })
}

fn create_file_impl(
    parent_raw: &str,
    name: &str,
) -> Result<NativeFileMutation, NativeFilesystemError> {
    validate_item_name(name)?;
    let parent = validate_existing_directory(parent_raw)?;
    let destination = parent.join(name);
    validate_path(&path_string(&destination))?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|error| {
            NativeFilesystemError::from_io(&error, "The file could not be created.")
        })?;
    Ok(NativeFileMutation {
        entry: metadata_from_path(&destination, name.to_string())?,
        affected_directories: vec![path_string(&parent)],
    })
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

fn canonical_same_item(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => same_path(&left, &right),
        _ => false,
    }
}

fn rename_impl(raw: &str, new_name: &str) -> Result<NativeFileMutation, NativeFilesystemError> {
    validate_item_name(new_name)?;
    let source = validate_path(raw)?;
    fs::symlink_metadata(&source).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The item could not be inspected.")
    })?;
    let parent = source
        .parent()
        .ok_or_else(NativeFilesystemError::invalid_path)?;
    let destination = parent.join(new_name);
    validate_path(&path_string(&destination))?;
    if source == destination {
        return Err(operation_error(
            NativeFilesystemErrorCode::SourceEqualsDestination,
            "The source and destination are the same location.",
        ));
    }
    if destination.exists() && !canonical_same_item(&source, &destination) {
        return Err(operation_error(
            NativeFilesystemErrorCode::AlreadyExists,
            "An item with that name already exists in the destination.",
        ));
    }
    fs::rename(&source, &destination).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The item could not be renamed.")
    })?;
    Ok(NativeFileMutation {
        entry: metadata_from_path(&destination, new_name.to_string())?,
        affected_directories: vec![path_string(parent)],
    })
}

fn random_id() -> Result<String, NativeFilesystemError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| {
        operation_error(
            NativeFilesystemErrorCode::IoError,
            "A secure operation identifier could not be generated.",
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn duplicate_destination_avoiding(
    parent: &Path,
    source_name: &str,
    is_directory: bool,
    reserved: &[PathBuf],
) -> PathBuf {
    let original = Path::new(source_name);
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(source_name);
    let extension = original.extension().and_then(|value| value.to_str());
    for index in 1_u32.. {
        let suffix = if index == 1 {
            " copy".to_string()
        } else {
            format!(" copy {index}")
        };
        let name = match extension {
            _ if is_directory => format!("{source_name}{suffix}"),
            Some(extension) if !stem.is_empty() => format!("{stem}{suffix}.{extension}"),
            _ => format!("{source_name}{suffix}"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() && !reserved.iter().any(|path| same_path(path, &candidate)) {
            return candidate;
        }
    }
    unreachable!()
}

fn duplicate_destination(parent: &Path, source_name: &str, is_directory: bool) -> PathBuf {
    duplicate_destination_avoiding(parent, source_name, is_directory, &[])
}

fn resolve_destination(
    source: &Path,
    destination_directory: &Path,
    operation: NativeFileOperationType,
    conflict_strategy: NativeFileConflictStrategy,
) -> Result<PathBuf, NativeFilesystemError> {
    let name = item_name(source)?;
    let is_directory = fs::symlink_metadata(source)
        .map(|metadata| metadata.is_dir() && !is_reparse_point(&metadata))
        .map_err(|error| {
            NativeFilesystemError::from_io(&error, "The source item could not be inspected.")
        })?;
    let initial = destination_directory.join(&name);
    if operation == NativeFileOperationType::Move && same_path(source, &initial) {
        return Err(operation_error(
            NativeFilesystemErrorCode::SourceEqualsDestination,
            "The source and destination are the same location.",
        ));
    }
    let destination = if operation == NativeFileOperationType::Duplicate {
        duplicate_destination(destination_directory, &name, is_directory)
    } else if same_path(source, &initial) {
        match conflict_strategy {
            NativeFileConflictStrategy::KeepBoth => {
                duplicate_destination(destination_directory, &name, is_directory)
            }
            NativeFileConflictStrategy::Cancel => {
                return Err(operation_error(
                    NativeFilesystemErrorCode::SourceEqualsDestination,
                    "The source and destination are the same location.",
                ));
            }
        }
    } else if initial.exists() {
        match conflict_strategy {
            NativeFileConflictStrategy::KeepBoth => {
                duplicate_destination(destination_directory, &name, is_directory)
            }
            NativeFileConflictStrategy::Cancel => {
                return Err(operation_error(
                    NativeFilesystemErrorCode::AlreadyExists,
                    "An item with that name already exists in the destination.",
                ));
            }
        }
    } else {
        initial
    };
    validate_path(&path_string(&destination))?;
    Ok(destination)
}

fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn check_cancelled(job: &NativeFileOperationJob) -> Result<(), NativeFilesystemError> {
    if job.cancelled.load(Ordering::Acquire) {
        Err(operation_error(
            NativeFilesystemErrorCode::OperationCancelled,
            "The operation was cancelled.",
        ))
    } else {
        Ok(())
    }
}

fn scan_entry(
    root: &Path,
    path: &Path,
    entries: &mut Vec<PlannedEntry>,
    job: &NativeFileOperationJob,
) -> Result<(u64, u64), NativeFilesystemError> {
    check_cancelled(job)?;
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The source item could not be inspected.")
    })?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(operation_error(
            NativeFilesystemErrorCode::InvalidDestination,
            "Linked and reparse-point items are not copied in this phase.",
        ));
    }
    let relative_path = path
        .strip_prefix(root)
        .map(Path::to_path_buf)
        .unwrap_or_default();
    if metadata.is_dir() {
        entries.push(PlannedEntry {
            relative_path,
            is_directory: true,
        });
        let mut files = 0_u64;
        let mut bytes = 0_u64;
        let directory = fs::read_dir(path).map_err(|error| {
            NativeFilesystemError::from_io(&error, "The source folder could not be read.")
        })?;
        for child in directory {
            let child = child.map_err(|error| {
                NativeFilesystemError::from_io(&error, "The source folder changed during copy.")
            })?;
            let (child_files, child_bytes) = scan_entry(root, &child.path(), entries, job)?;
            files = files.saturating_add(child_files);
            bytes = bytes.saturating_add(child_bytes);
        }
        Ok((files, bytes))
    } else if metadata.is_file() {
        entries.push(PlannedEntry {
            relative_path,
            is_directory: false,
        });
        Ok((1, metadata.len()))
    } else {
        Err(operation_error(
            NativeFilesystemErrorCode::InvalidDestination,
            "This filesystem item type cannot be copied safely.",
        ))
    }
}

fn path_is_inside(candidate: &Path, ancestor: &Path) -> bool {
    let candidate = path_string(candidate);
    let ancestor = path_string(ancestor);
    #[cfg(windows)]
    {
        let candidate = candidate.to_ascii_lowercase();
        let mut ancestor = ancestor.to_ascii_lowercase();
        if !ancestor.ends_with(['\\', '/']) {
            ancestor.push(std::path::MAIN_SEPARATOR);
        }
        candidate.starts_with(&ancestor)
    }
    #[cfg(not(windows))]
    {
        let mut ancestor = ancestor;
        if !ancestor.ends_with('/') {
            ancestor.push('/');
        }
        candidate.starts_with(&ancestor)
    }
}

fn build_copy_plan(
    source: PathBuf,
    destination: PathBuf,
    job: &NativeFileOperationJob,
) -> Result<CopyPlan, NativeFilesystemError> {
    let metadata = fs::symlink_metadata(&source).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The source item could not be inspected.")
    })?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(operation_error(
            NativeFilesystemErrorCode::InvalidDestination,
            "Linked and reparse-point items are not copied in this phase.",
        ));
    }
    if metadata.is_dir() {
        let canonical_source = fs::canonicalize(&source).map_err(|error| {
            NativeFilesystemError::from_io(&error, "The source folder could not be resolved.")
        })?;
        let destination_parent = destination
            .parent()
            .ok_or_else(NativeFilesystemError::invalid_path)?;
        let canonical_parent = fs::canonicalize(destination_parent).map_err(|error| {
            NativeFilesystemError::from_io(&error, "The destination could not be resolved.")
        })?;
        if same_path(&canonical_source, &canonical_parent)
            || path_is_inside(&canonical_parent, &canonical_source)
        {
            return Err(operation_error(
                NativeFilesystemErrorCode::DestinationInsideSource,
                "A folder cannot be copied or moved into itself.",
            ));
        }
    }
    let mut entries = Vec::new();
    let (file_count, byte_count) = scan_entry(&source, &source, &mut entries, job)?;
    Ok(CopyPlan {
        source,
        destination,
        entries,
        is_directory: metadata.is_dir(),
        file_count,
        byte_count,
    })
}

fn reject_destination_inside_source(
    source: &Path,
    destination: &Path,
) -> Result<(), NativeFilesystemError> {
    let metadata = fs::symlink_metadata(source).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The source item could not be inspected.")
    })?;
    if !metadata.is_dir() || is_reparse_point(&metadata) {
        return Ok(());
    }
    let canonical_source = fs::canonicalize(source).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The source folder could not be resolved.")
    })?;
    let destination_parent = destination
        .parent()
        .ok_or_else(NativeFilesystemError::invalid_path)?;
    let canonical_parent = fs::canonicalize(destination_parent).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The destination could not be resolved.")
    })?;
    if same_path(&canonical_source, &canonical_parent)
        || path_is_inside(&canonical_parent, &canonical_source)
    {
        return Err(operation_error(
            NativeFilesystemErrorCode::DestinationInsideSource,
            "A folder cannot be copied or moved into itself.",
        ));
    }
    Ok(())
}

fn partial_path(destination: &Path, job_id: &str, source_index: usize) -> PathBuf {
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let base = format!(".nammu-partial-{job_id}-{source_index}");
    let mut candidate = parent.join(&base);
    let mut collision = 1_u32;
    while candidate.exists() {
        candidate = parent.join(format!("{base}-{collision}"));
        collision += 1;
    }
    candidate
}

fn cleanup_partial(path: &Path) {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.is_dir() && !is_reparse_point(&metadata) {
            let _ = fs::remove_dir_all(path);
        } else {
            let _ = fs::remove_file(path);
        }
    }
}

fn update_progress(
    job: &NativeFileOperationJob,
    current_item: &Path,
    bytes: u64,
    file_completed: bool,
) {
    if let Ok(mut snapshot) = job.snapshot.lock() {
        snapshot.current_item = Some(path_string(current_item));
        snapshot.bytes_processed = snapshot.bytes_processed.saturating_add(bytes);
        if file_completed {
            snapshot.files_completed = snapshot.files_completed.saturating_add(1);
        }
    }
}

fn copy_file_streaming(
    source: &Path,
    destination: &Path,
    job: &NativeFileOperationJob,
) -> Result<(), NativeFilesystemError> {
    let mut input = File::open(source).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The source file could not be opened.")
    })?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| {
            NativeFilesystemError::from_io(
                &error,
                "The temporary destination could not be created.",
            )
        })?;
    let mut buffer = vec![0_u8; COPY_BUFFER_SIZE];
    loop {
        check_cancelled(job)?;
        let count = input.read(&mut buffer).map_err(|error| {
            NativeFilesystemError::from_io(&error, "The source file could not be read.")
        })?;
        if count == 0 {
            break;
        }
        output.write_all(&buffer[..count]).map_err(|error| {
            NativeFilesystemError::from_io(&error, "The destination file could not be written.")
        })?;
        update_progress(job, source, count as u64, false);
    }
    output.sync_all().map_err(|error| {
        NativeFilesystemError::from_io(&error, "The destination file could not be finalized.")
    })?;
    update_progress(job, source, 0, true);
    Ok(())
}

fn execute_copy_plan(
    plan: &CopyPlan,
    job: &NativeFileOperationJob,
    source_index: usize,
) -> Result<(), NativeFilesystemError> {
    let temporary = partial_path(
        &plan.destination,
        &job.snapshot.lock().unwrap().id,
        source_index,
    );
    let result = (|| {
        check_cancelled(job)?;
        if plan.is_directory {
            fs::create_dir(&temporary).map_err(|error| {
                NativeFilesystemError::from_io(
                    &error,
                    "The temporary destination folder could not be created.",
                )
            })?;
            for entry in &plan.entries {
                check_cancelled(job)?;
                if entry.relative_path.as_os_str().is_empty() {
                    continue;
                }
                let source = plan.source.join(&entry.relative_path);
                let destination = temporary.join(&entry.relative_path);
                if entry.is_directory {
                    fs::create_dir(&destination).map_err(|error| {
                        NativeFilesystemError::from_io(
                            &error,
                            "A destination folder could not be created.",
                        )
                    })?;
                } else {
                    copy_file_streaming(&source, &destination, job)?;
                }
            }
        } else {
            copy_file_streaming(&plan.source, &temporary, job)?;
        }
        check_cancelled(job)?;
        fs::rename(&temporary, &plan.destination).map_err(|error| {
            NativeFilesystemError::from_io(&error, "The copied item could not be finalized.")
        })?;
        Ok(())
    })();
    if result.is_err() {
        cleanup_partial(&temporary);
    }
    result
}

fn verify_copy(plan: &CopyPlan) -> Result<(), NativeFilesystemError> {
    let root_metadata = fs::symlink_metadata(&plan.destination).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The copied destination could not be verified.")
    })?;
    if plan.is_directory != root_metadata.is_dir() || is_reparse_point(&root_metadata) {
        return Err(operation_error(
            NativeFilesystemErrorCode::IoError,
            "The copied destination did not match the source type.",
        ));
    }
    for entry in &plan.entries {
        if entry.relative_path.as_os_str().is_empty() {
            continue;
        }
        let source = plan.source.join(&entry.relative_path);
        let destination = plan.destination.join(&entry.relative_path);
        let source_metadata = fs::symlink_metadata(&source).map_err(|error| {
            NativeFilesystemError::from_io(&error, "The moved source changed during verification.")
        })?;
        let destination_metadata = fs::symlink_metadata(&destination).map_err(|error| {
            NativeFilesystemError::from_io(&error, "The copied destination is incomplete.")
        })?;
        if is_reparse_point(&source_metadata)
            || is_reparse_point(&destination_metadata)
            || source_metadata.is_dir() != destination_metadata.is_dir()
            || (source_metadata.is_file() && source_metadata.len() != destination_metadata.len())
        {
            return Err(operation_error(
                NativeFilesystemErrorCode::IoError,
                "The copied destination could not be verified completely.",
            ));
        }
    }
    Ok(())
}

fn volume_key(path: &Path) -> Option<String> {
    match path.components().next()? {
        Component::Prefix(prefix) => {
            Some(prefix.as_os_str().to_string_lossy().to_ascii_lowercase())
        }
        Component::RootDir => Some(std::path::MAIN_SEPARATOR.to_string()),
        _ => None,
    }
}

fn same_volume(left: &Path, right: &Path) -> bool {
    volume_key(left) == volume_key(right)
}

fn delete_confirmed_move_source(path: &Path) -> Result<(), NativeFilesystemError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The moved source could not be rechecked.")
    })?;
    if metadata.is_dir() && !is_reparse_point(&metadata) {
        fs::remove_dir_all(path).map_err(|error| {
            NativeFilesystemError::from_io(&error, "The copied source folder could not be removed.")
        })
    } else {
        fs::remove_file(path).map_err(|error| {
            NativeFilesystemError::from_io(&error, "The copied source file could not be removed.")
        })
    }
}

fn record_failure(job: &NativeFileOperationJob, source: &Path, error: NativeFilesystemError) {
    if let Ok(mut snapshot) = job.snapshot.lock() {
        snapshot.failures.push(NativeFileOperationFailure {
            source_path: path_string(source),
            error,
        });
    }
}

fn record_success(job: &NativeFileOperationJob, source: &Path, destination: &Path) {
    let name = item_name(destination).unwrap_or_else(|_| path_string(destination));
    match metadata_from_path(destination, name) {
        Ok(entry) => {
            if let Ok(mut snapshot) = job.snapshot.lock() {
                snapshot.successes.push(NativeFileOperationSuccess {
                    source_path: path_string(source),
                    destination_path: path_string(destination),
                    entry,
                });
            }
        }
        Err(error) => record_failure(job, source, error),
    }
}

fn finish_job(job: &NativeFileOperationJob) {
    if let Ok(mut snapshot) = job.snapshot.lock() {
        snapshot.current_item = None;
        snapshot.state = if job.cancelled.load(Ordering::Acquire)
            || snapshot
                .failures
                .iter()
                .any(|failure| failure.error.code == NativeFilesystemErrorCode::OperationCancelled)
        {
            NativeFileOperationStatus::Cancelled
        } else if snapshot.failures.is_empty() {
            NativeFileOperationStatus::Completed
        } else {
            NativeFileOperationStatus::Failed
        };
    }
    if let Ok(mut finished_at) = job.finished_at.lock() {
        *finished_at = Some(Instant::now());
    }
}

fn run_copy_like_job(
    job: Arc<NativeFileOperationJob>,
    destination_raw: Option<String>,
    conflict_strategy: NativeFileConflictStrategy,
) {
    if let Ok(mut snapshot) = job.snapshot.lock() {
        snapshot.state = NativeFileOperationStatus::Running;
    }
    let (operation, sources) = {
        let snapshot = job.snapshot.lock().unwrap();
        (snapshot.operation, snapshot.sources.clone())
    };
    let explicit_destination = match destination_raw {
        Some(raw) => match validate_existing_directory(&raw) {
            Ok(path) => Some(path),
            Err(error) => {
                record_failure(&job, Path::new(&raw), error);
                finish_job(&job);
                return;
            }
        },
        None => None,
    };

    let mut resolved = Vec::new();
    let mut reserved_destinations = Vec::<PathBuf>::new();
    for raw in sources {
        if let Err(error) = check_cancelled(&job) {
            record_failure(&job, Path::new(&raw), error);
            break;
        }
        let source = match validate_path(&raw).and_then(|path| {
            fs::symlink_metadata(&path).map(|_| path).map_err(|error| {
                NativeFilesystemError::from_io(&error, "The source item is unavailable.")
            })
        }) {
            Ok(path) => path,
            Err(error) => {
                record_failure(&job, Path::new(&raw), error);
                continue;
            }
        };
        let destination_directory = match (&explicit_destination, operation) {
            (Some(path), _) => path.clone(),
            (None, NativeFileOperationType::Duplicate) => match source.parent() {
                Some(parent) => parent.to_path_buf(),
                None => {
                    record_failure(&job, &source, NativeFilesystemError::invalid_path());
                    continue;
                }
            },
            _ => {
                record_failure(
                    &job,
                    &source,
                    operation_error(
                        NativeFilesystemErrorCode::InvalidDestination,
                        "A destination folder is required.",
                    ),
                );
                continue;
            }
        };
        match resolve_destination(
            &source,
            &destination_directory,
            operation,
            conflict_strategy,
        ) {
            Ok(mut destination) => {
                if reserved_destinations
                    .iter()
                    .any(|reserved| same_path(reserved, &destination))
                {
                    if conflict_strategy == NativeFileConflictStrategy::KeepBoth
                        || operation == NativeFileOperationType::Duplicate
                    {
                        let name = item_name(&source).unwrap_or_else(|_| "item".to_string());
                        let is_directory = fs::symlink_metadata(&source).is_ok_and(|metadata| {
                            metadata.is_dir() && !is_reparse_point(&metadata)
                        });
                        destination = duplicate_destination_avoiding(
                            &destination_directory,
                            &name,
                            is_directory,
                            &reserved_destinations,
                        );
                    } else {
                        record_failure(
                            &job,
                            &source,
                            operation_error(
                                NativeFilesystemErrorCode::AlreadyExists,
                                "Multiple selected items resolve to the same destination.",
                            ),
                        );
                        continue;
                    }
                }
                if let Err(error) = reject_destination_inside_source(&source, &destination) {
                    record_failure(&job, &source, error);
                    continue;
                }
                if let Err(error) = validate_path(&path_string(&destination)) {
                    record_failure(&job, &source, error);
                    continue;
                }
                reserved_destinations.push(destination.clone());
                resolved.push((source, destination));
            }
            Err(error) => record_failure(&job, &source, error),
        }
    }

    if operation == NativeFileOperationType::Move {
        let mut remaining = Vec::new();
        for (source, destination) in resolved {
            if let Err(error) = check_cancelled(&job) {
                record_failure(&job, &source, error);
                break;
            }
            if same_volume(&source, &destination) {
                match fs::rename(&source, &destination) {
                    Ok(()) => record_success(&job, &source, &destination),
                    Err(error) => record_failure(
                        &job,
                        &source,
                        NativeFilesystemError::from_io(&error, "The item could not be moved."),
                    ),
                }
            } else {
                remaining.push((source, destination));
            }
        }
        resolved = remaining;
    }

    let mut plans = Vec::new();
    for (source, destination) in resolved {
        match build_copy_plan(source.clone(), destination, &job) {
            Ok(plan) => plans.push(plan),
            Err(error) => record_failure(&job, &source, error),
        }
    }
    if let Ok(mut snapshot) = job.snapshot.lock() {
        snapshot.files_total = Some(plans.iter().map(|plan| plan.file_count).sum());
        snapshot.bytes_total = Some(plans.iter().map(|plan| plan.byte_count).sum());
    }

    for (index, plan) in plans.iter().enumerate() {
        match execute_copy_plan(plan, &job, index) {
            Ok(()) => {
                if operation == NativeFileOperationType::Move {
                    if let Err(error) = verify_copy(plan).and_then(|_| check_cancelled(&job)) {
                        record_failure(&job, &plan.source, error);
                        continue;
                    }
                    if let Err(error) = delete_confirmed_move_source(&plan.source) {
                        record_failure(&job, &plan.source, error);
                        continue;
                    }
                }
                record_success(&job, &plan.source, &plan.destination);
            }
            Err(error) => {
                record_failure(&job, &plan.source, error);
                if job.cancelled.load(Ordering::Acquire) {
                    break;
                }
            }
        }
    }
    finish_job(&job);
}

impl NativeFileOperationState {
    fn prune(&self) {
        let Ok(mut jobs) = self.jobs.lock() else {
            return;
        };
        jobs.retain(|_, job| {
            job.finished_at
                .lock()
                .ok()
                .and_then(|finished| *finished)
                .is_none_or(|finished| finished.elapsed() < TERMINAL_JOB_TTL)
        });
        if jobs.len() <= MAX_JOB_RECORDS {
            return;
        }
        let mut terminal = jobs
            .iter()
            .filter_map(|(id, job)| {
                job.finished_at
                    .lock()
                    .ok()
                    .and_then(|finished| finished.map(|_| (id.clone(), job.created_at)))
            })
            .collect::<Vec<_>>();
        terminal.sort_by_key(|(_, created_at)| *created_at);
        let excess = jobs.len().saturating_sub(MAX_JOB_RECORDS);
        for (id, _) in terminal.into_iter().take(excess) {
            jobs.remove(&id);
        }
    }

    fn start(
        &self,
        operation: NativeFileOperationType,
        sources: Vec<String>,
        destination_path: Option<String>,
        conflict_strategy: NativeFileConflictStrategy,
    ) -> Result<NativeFileOperationSnapshot, NativeFilesystemError> {
        if sources.is_empty() || sources.len() > MAX_BATCH_SOURCES {
            return Err(operation_error(
                NativeFilesystemErrorCode::InvalidPath,
                "Select between one and 1,024 source items.",
            ));
        }
        for source in &sources {
            validate_path(source)?;
        }
        for (index, source) in sources.iter().enumerate() {
            if sources[..index]
                .iter()
                .any(|existing| same_path(Path::new(existing), Path::new(source)))
            {
                return Err(operation_error(
                    NativeFilesystemErrorCode::InvalidPath,
                    "The selection contains the same source more than once.",
                ));
            }
        }
        if let Some(destination) = &destination_path {
            validate_path(destination)?;
        }
        self.prune();
        let active_jobs = self
            .jobs
            .lock()
            .map_err(|_| {
                operation_error(
                    NativeFilesystemErrorCode::IoError,
                    "The filesystem operation service is unavailable.",
                )
            })?
            .values()
            .filter(|job| {
                job.snapshot.lock().is_ok_and(|snapshot| {
                    matches!(
                        snapshot.state,
                        NativeFileOperationStatus::Queued | NativeFileOperationStatus::Running
                    )
                })
            })
            .count();
        if active_jobs >= MAX_ACTIVE_JOBS {
            return Err(operation_error(
                NativeFilesystemErrorCode::IoError,
                "Too many filesystem operations are already running.",
            ));
        }
        let id = random_id()?;
        let snapshot = NativeFileOperationSnapshot {
            id: id.clone(),
            operation,
            state: NativeFileOperationStatus::Queued,
            sources,
            destination_path: destination_path.clone(),
            current_item: None,
            files_completed: 0,
            files_total: None,
            bytes_processed: 0,
            bytes_total: None,
            successes: Vec::new(),
            failures: Vec::new(),
        };
        let job = Arc::new(NativeFileOperationJob {
            snapshot: Mutex::new(snapshot.clone()),
            cancelled: AtomicBool::new(false),
            created_at: Instant::now(),
            finished_at: Mutex::new(None),
        });
        self.jobs
            .lock()
            .map_err(|_| {
                operation_error(
                    NativeFilesystemErrorCode::IoError,
                    "The filesystem operation service is unavailable.",
                )
            })?
            .insert(id, Arc::clone(&job));
        tauri::async_runtime::spawn_blocking(move || {
            run_copy_like_job(job, destination_path, conflict_strategy)
        });
        Ok(snapshot)
    }

    fn get(&self, id: &str) -> Result<NativeFileOperationSnapshot, NativeFilesystemError> {
        if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(NativeFilesystemError::invalid_path());
        }
        self.prune();
        let jobs = self.jobs.lock().map_err(|_| {
            operation_error(
                NativeFilesystemErrorCode::IoError,
                "The filesystem operation service is unavailable.",
            )
        })?;
        let job = jobs.get(id).ok_or_else(|| {
            operation_error(
                NativeFilesystemErrorCode::NotFound,
                "The filesystem operation is no longer available.",
            )
        })?;
        let snapshot = job.snapshot.lock().map_err(|_| {
            operation_error(
                NativeFilesystemErrorCode::IoError,
                "The filesystem operation state is unavailable.",
            )
        })?;
        Ok(snapshot.clone())
    }

    fn cancel(&self, id: &str) -> Result<NativeFileOperationSnapshot, NativeFilesystemError> {
        if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(NativeFilesystemError::invalid_path());
        }
        let jobs = self.jobs.lock().map_err(|_| {
            operation_error(
                NativeFilesystemErrorCode::IoError,
                "The filesystem operation service is unavailable.",
            )
        })?;
        let job = jobs.get(id).ok_or_else(|| {
            operation_error(
                NativeFilesystemErrorCode::NotFound,
                "The filesystem operation is no longer available.",
            )
        })?;
        job.cancelled.store(true, Ordering::Release);
        let snapshot = job.snapshot.lock().map_err(|_| {
            operation_error(
                NativeFilesystemErrorCode::IoError,
                "The filesystem operation state is unavailable.",
            )
        })?;
        Ok(snapshot.clone())
    }
}

async fn run_blocking<T, F>(operation: F) -> NativeFilesystemResponse<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, NativeFilesystemError> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(operation).await {
        Ok(result) => NativeFilesystemResponse::from_result(result),
        Err(_) => NativeFilesystemResponse::Error {
            error: operation_error(
                NativeFilesystemErrorCode::IoError,
                "The native filesystem worker stopped unexpectedly.",
            ),
        },
    }
}

#[tauri::command]
pub async fn create_native_directory(
    parent_path: String,
    name: String,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileMutation>, String> {
    require_trusted_caller(&caller)?;
    Ok(run_blocking(move || create_directory_impl(&parent_path, &name)).await)
}

#[tauri::command]
pub async fn create_native_file(
    parent_path: String,
    name: String,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileMutation>, String> {
    require_trusted_caller(&caller)?;
    Ok(run_blocking(move || create_file_impl(&parent_path, &name)).await)
}

#[tauri::command]
pub async fn rename_native_file(
    path: String,
    new_name: String,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileMutation>, String> {
    require_trusted_caller(&caller)?;
    Ok(run_blocking(move || rename_impl(&path, &new_name)).await)
}

fn start_response(
    state: &NativeFileOperationState,
    operation: NativeFileOperationType,
    sources: Vec<String>,
    destination_path: Option<String>,
    conflict_strategy: NativeFileConflictStrategy,
) -> NativeFilesystemResponse<NativeFileOperationSnapshot> {
    NativeFilesystemResponse::from_result(state.start(
        operation,
        sources,
        destination_path,
        conflict_strategy,
    ))
}

#[tauri::command]
pub fn start_native_copy(
    sources: Vec<String>,
    destination_path: String,
    conflict_strategy: NativeFileConflictStrategy,
    state: State<'_, NativeFileOperationState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(start_response(
        &state,
        NativeFileOperationType::Copy,
        sources,
        Some(destination_path),
        conflict_strategy,
    ))
}

#[tauri::command]
pub fn start_native_move(
    sources: Vec<String>,
    destination_path: String,
    conflict_strategy: NativeFileConflictStrategy,
    state: State<'_, NativeFileOperationState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(start_response(
        &state,
        NativeFileOperationType::Move,
        sources,
        Some(destination_path),
        conflict_strategy,
    ))
}

#[tauri::command]
pub fn start_native_duplicate(
    sources: Vec<String>,
    state: State<'_, NativeFileOperationState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(start_response(
        &state,
        NativeFileOperationType::Duplicate,
        sources,
        None,
        NativeFileConflictStrategy::KeepBoth,
    ))
}

#[tauri::command]
pub fn get_native_file_operation(
    id: String,
    state: State<'_, NativeFileOperationState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.get(&id)))
}

#[tauri::command]
pub fn cancel_native_file_operation(
    id: String,
    state: State<'_, NativeFileOperationState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.cancel(&id)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{thread, time::SystemTime};

    fn fixture() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("NammuFilesF2ATest-{nonce}"));
        fs::create_dir(&root).unwrap();
        root
    }

    fn completed_job(
        operation: NativeFileOperationType,
        sources: Vec<String>,
        destination: Option<String>,
        strategy: NativeFileConflictStrategy,
    ) -> NativeFileOperationSnapshot {
        let state = NativeFileOperationState::default();
        let started = state
            .start(operation, sources, destination, strategy)
            .unwrap();
        for _ in 0..1_000 {
            let snapshot = state.get(&started.id).unwrap();
            if matches!(
                snapshot.state,
                NativeFileOperationStatus::Completed
                    | NativeFileOperationStatus::Failed
                    | NativeFileOperationStatus::Cancelled
            ) {
                return snapshot;
            }
            thread::sleep(Duration::from_millis(2));
        }
        panic!("operation did not complete");
    }

    #[test]
    fn validates_windows_names_authoritatively() {
        for invalid in [
            "", ".", "..", "bad?.txt", "bad ", "bad.", "CON", "con.txt", "COM1",
        ] {
            assert_eq!(
                validate_item_name(invalid).unwrap_err().code,
                NativeFilesystemErrorCode::InvalidName
            );
        }
        for valid in [
            "notes.txt",
            "README.md",
            "data.json",
            "example.ts",
            "नम्मु folder",
        ] {
            validate_item_name(valid).unwrap();
        }
    }

    #[test]
    fn creates_files_and_directories_without_overwrite() {
        let root = fixture();
        let folder = create_directory_impl(&path_string(&root), "Folder with spaces").unwrap();
        assert!(Path::new(&folder.entry.path).is_dir());
        let file = create_file_impl(&path_string(&root), "नम्मु.txt").unwrap();
        assert!(Path::new(&file.entry.path).is_file());
        assert_eq!(
            create_file_impl(&path_string(&root), "नम्मु.txt")
                .unwrap_err()
                .code,
            NativeFilesystemErrorCode::AlreadyExists
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn renames_files_directories_and_rejects_collisions() {
        let root = fixture();
        let file = root.join("old.txt");
        fs::write(&file, b"nammu").unwrap();
        let renamed = rename_impl(&path_string(&file), "New.txt").unwrap();
        assert!(Path::new(&renamed.entry.path).exists());
        let folder = root.join("folder");
        fs::create_dir(&folder).unwrap();
        rename_impl(&path_string(&folder), "Folder Renamed").unwrap();
        fs::write(root.join("taken.txt"), b"").unwrap();
        assert_eq!(
            rename_impl(&renamed.entry.path, "taken.txt")
                .unwrap_err()
                .code,
            NativeFilesystemErrorCode::AlreadyExists
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn supports_case_only_rename_on_windows() {
        let root = fixture();
        let source = root.join("report.txt");
        fs::write(&source, b"nammu").unwrap();
        let result = rename_impl(&path_string(&source), "REPORT.txt").unwrap();
        assert_eq!(result.entry.name, "REPORT.txt");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copies_nested_and_empty_directories_and_unicode_files() {
        let root = fixture();
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::create_dir(source.join("empty")).unwrap();
        fs::create_dir(source.join("nested")).unwrap();
        fs::write(source.join("nested").join("नम्मु.txt"), b"payload").unwrap();
        let snapshot = completed_job(
            NativeFileOperationType::Copy,
            vec![path_string(&source)],
            Some(path_string(&destination)),
            NativeFileConflictStrategy::Cancel,
        );
        assert_eq!(snapshot.state, NativeFileOperationStatus::Completed);
        assert!(destination.join("source").join("empty").is_dir());
        assert_eq!(
            fs::read(destination.join("source").join("nested").join("नम्मु.txt")).unwrap(),
            b"payload"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copies_multiple_files_with_explicit_batch_results() {
        let root = fixture();
        let destination = root.join("destination");
        fs::create_dir(&destination).unwrap();
        let first = root.join("first.txt");
        let second = root.join("second.txt");
        fs::write(&first, b"first").unwrap();
        fs::write(&second, b"second").unwrap();
        let snapshot = completed_job(
            NativeFileOperationType::Copy,
            vec![path_string(&first), path_string(&second)],
            Some(path_string(&destination)),
            NativeFileConflictStrategy::Cancel,
        );
        assert_eq!(snapshot.successes.len(), 2);
        assert!(snapshot.failures.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn batch_results_preserve_successes_and_report_missing_sources() {
        let root = fixture();
        let destination = root.join("destination");
        fs::create_dir(&destination).unwrap();
        let present = root.join("present.txt");
        fs::write(&present, b"present").unwrap();
        let missing = root.join("missing.txt");
        let snapshot = completed_job(
            NativeFileOperationType::Copy,
            vec![path_string(&present), path_string(&missing)],
            Some(path_string(&destination)),
            NativeFileConflictStrategy::Cancel,
        );
        assert_eq!(snapshot.state, NativeFileOperationStatus::Failed);
        assert_eq!(snapshot.successes.len(), 1);
        assert_eq!(snapshot.failures.len(), 1);
        assert_eq!(
            snapshot.failures[0].error.code,
            NativeFilesystemErrorCode::NotFound
        );
        assert!(destination.join("present.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_copy_into_self_or_descendant() {
        let root = fixture();
        let source = root.join("source");
        let child = source.join("child");
        fs::create_dir_all(&child).unwrap();
        let same = completed_job(
            NativeFileOperationType::Copy,
            vec![path_string(&source)],
            Some(path_string(&root)),
            NativeFileConflictStrategy::Cancel,
        );
        assert_eq!(
            same.failures[0].error.code,
            NativeFilesystemErrorCode::SourceEqualsDestination
        );
        let descendant = completed_job(
            NativeFileOperationType::Copy,
            vec![path_string(&source)],
            Some(path_string(&child)),
            NativeFileConflictStrategy::Cancel,
        );
        assert_eq!(
            descendant.failures[0].error.code,
            NativeFilesystemErrorCode::DestinationInsideSource
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn same_volume_move_uses_rename_and_never_overwrites() {
        let root = fixture();
        let destination = root.join("destination");
        fs::create_dir(&destination).unwrap();
        let source = root.join("move.txt");
        fs::write(&source, b"move").unwrap();
        let snapshot = completed_job(
            NativeFileOperationType::Move,
            vec![path_string(&source)],
            Some(path_string(&destination)),
            NativeFileConflictStrategy::Cancel,
        );
        assert_eq!(snapshot.state, NativeFileOperationStatus::Completed);
        assert!(!source.exists());
        assert!(destination.join("move.txt").exists());
        fs::write(root.join("collision.txt"), b"source").unwrap();
        fs::write(destination.join("collision.txt"), b"destination").unwrap();
        let collision = completed_job(
            NativeFileOperationType::Move,
            vec![path_string(&root.join("collision.txt"))],
            Some(path_string(&destination)),
            NativeFileConflictStrategy::Cancel,
        );
        assert_eq!(
            collision.failures[0].error.code,
            NativeFilesystemErrorCode::AlreadyExists
        );
        assert_eq!(fs::read(root.join("collision.txt")).unwrap(), b"source");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn duplicate_names_are_deterministic_and_preserve_extensions() {
        let root = fixture();
        let source = root.join("Report.pdf");
        fs::write(&source, b"report").unwrap();
        for expected in ["Report copy.pdf", "Report copy 2.pdf", "Report copy 3.pdf"] {
            let snapshot = completed_job(
                NativeFileOperationType::Duplicate,
                vec![path_string(&source)],
                None,
                NativeFileConflictStrategy::KeepBoth,
            );
            assert_eq!(snapshot.successes[0].entry.name, expected);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn duplicate_directory_suffix_follows_the_complete_directory_name() {
        let root = fixture();
        let source = root.join("project.v1");
        fs::create_dir(&source).unwrap();
        let snapshot = completed_job(
            NativeFileOperationType::Duplicate,
            vec![path_string(&source)],
            None,
            NativeFileConflictStrategy::KeepBoth,
        );
        assert_eq!(snapshot.successes[0].entry.name, "project.v1 copy");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancellation_removes_partial_destination_and_preserves_source() {
        let root = fixture();
        let destination = root.join("destination");
        fs::create_dir(&destination).unwrap();
        let source = root.join("large.bin");
        let file = File::create(&source).unwrap();
        file.set_len(128 * 1024 * 1024).unwrap();
        let state = NativeFileOperationState::default();
        let started = state
            .start(
                NativeFileOperationType::Copy,
                vec![path_string(&source)],
                Some(path_string(&destination)),
                NativeFileConflictStrategy::Cancel,
            )
            .unwrap();
        state.cancel(&started.id).unwrap();
        let snapshot = loop {
            let snapshot = state.get(&started.id).unwrap();
            if snapshot.state == NativeFileOperationStatus::Cancelled {
                break snapshot;
            }
            thread::sleep(Duration::from_millis(2));
        };
        assert!(snapshot.successes.is_empty());
        assert!(source.exists());
        assert!(!destination.join("large.bin").exists());
        assert!(fs::read_dir(&destination).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("nammu-partial")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cross_volume_sequence_requires_verification_before_source_removal() {
        let root = fixture();
        let source = root.join("source.txt");
        let destination = root.join("destination.txt");
        fs::write(&source, b"verified payload").unwrap();
        let job = Arc::new(NativeFileOperationJob {
            snapshot: Mutex::new(NativeFileOperationSnapshot {
                id: "b".repeat(32),
                operation: NativeFileOperationType::Move,
                state: NativeFileOperationStatus::Running,
                sources: vec![path_string(&source)],
                destination_path: destination.parent().map(path_string),
                current_item: None,
                files_completed: 0,
                files_total: None,
                bytes_processed: 0,
                bytes_total: None,
                successes: Vec::new(),
                failures: Vec::new(),
            }),
            cancelled: AtomicBool::new(false),
            created_at: Instant::now(),
            finished_at: Mutex::new(None),
        });
        let plan = build_copy_plan(source.clone(), destination.clone(), &job).unwrap();
        execute_copy_plan(&plan, &job, 0).unwrap();
        verify_copy(&plan).unwrap();
        assert!(source.exists());
        job.cancelled.store(true, Ordering::Release);
        assert_eq!(
            check_cancelled(&job).unwrap_err().code,
            NativeFilesystemErrorCode::OperationCancelled
        );
        assert!(source.exists());
        assert!(destination.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn reports_exclusively_locked_files_as_in_use() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = fixture();
        let source = root.join("locked.txt");
        fs::write(&source, b"locked").unwrap();
        let _lock = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&source)
            .unwrap();
        assert_eq!(
            rename_impl(&path_string(&source), "renamed.txt")
                .unwrap_err()
                .code,
            NativeFilesystemErrorCode::FileInUse
        );
        drop(_lock);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_large_directory_copy_remains_bounded_and_complete() {
        let root = fixture();
        let source = root.join("large-directory");
        let destination = root.join("destination");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        for index in 0..1_000 {
            fs::write(source.join(format!("item-{index:04}.txt")), b"nammu").unwrap();
        }
        let started = Instant::now();
        let snapshot = completed_job(
            NativeFileOperationType::Copy,
            vec![path_string(&source)],
            Some(path_string(&destination)),
            NativeFileConflictStrategy::Cancel,
        );
        println!(
            "F2A 1,000-file directory copy: {:.2} ms",
            started.elapsed().as_secs_f64() * 1_000.0
        );
        assert_eq!(snapshot.state, NativeFileOperationStatus::Completed);
        assert_eq!(snapshot.files_completed, 1_000);
        assert_eq!(snapshot.files_total, Some(1_000));
        assert_eq!(
            fs::read_dir(destination.join("large-directory"))
                .unwrap()
                .count(),
            1_000
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copy_performance_baselines_stream_without_unbounded_memory() {
        let root = fixture();
        let destination = root.join("destination");
        fs::create_dir(&destination).unwrap();
        for (name, size) in [
            ("one-meg.bin", 1024 * 1024),
            ("hundred-meg.bin", 100 * 1024 * 1024),
        ] {
            let source = root.join(name);
            File::create(&source).unwrap().set_len(size).unwrap();
            let started = Instant::now();
            let snapshot = completed_job(
                NativeFileOperationType::Copy,
                vec![path_string(&source)],
                Some(path_string(&destination)),
                NativeFileConflictStrategy::Cancel,
            );
            println!(
                "F2A {name} copy: {:.2} ms",
                started.elapsed().as_secs_f64() * 1_000.0
            );
            assert_eq!(snapshot.state, NativeFileOperationStatus::Completed);
            assert_eq!(fs::metadata(destination.join(name)).unwrap().len(), size);
        }
        fs::remove_dir_all(root).unwrap();
    }
}
