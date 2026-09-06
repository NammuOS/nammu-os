use crate::native_filesystem::{
    path_string, require_trusted_caller, validate_path, NativeFileRootKind, NativeFilesystemError,
    NativeFilesystemErrorCode, NativeFilesystemResponse,
};
use getrandom::fill as random_fill;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{State, Webview};

const MAX_PROPERTY_PATHS: usize = 256;
const MAX_ACTIVE_MEASUREMENTS: usize = 2;
const MAX_MEASUREMENT_RECORDS: usize = 16;
const TERMINAL_MEASUREMENT_TTL: Duration = Duration::from_secs(2 * 60);
const PROGRESS_FLUSH_ENTRIES: u64 = 64;
const PROGRESS_FLUSH_INTERVAL: Duration = Duration::from_millis(40);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativePropertyItemKind {
    File,
    Directory,
    Drive,
    SymbolicLink,
    Junction,
    OtherReparse,
    Other,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileAttributes {
    pub read_only: bool,
    pub hidden: bool,
    pub system: bool,
    pub archive: bool,
    pub compressed: bool,
    pub encrypted: bool,
    pub sparse: bool,
    pub offline: bool,
    pub temporary: bool,
    pub reparse_point: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVolumeProperties {
    pub path: String,
    pub label: Option<String>,
    pub kind: NativeFileRootKind,
    pub file_system: Option<String>,
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
    pub used_bytes: Option<u64>,
    pub accessible: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFilePropertyItem {
    pub name: String,
    pub path: String,
    pub parent_path: Option<String>,
    pub extension: Option<String>,
    pub kind: NativePropertyItemKind,
    pub size_bytes: Option<u64>,
    pub allocated_bytes: Option<u64>,
    pub created_at_ms: Option<u64>,
    pub modified_at_ms: Option<u64>,
    pub accessed_at_ms: Option<u64>,
    pub attributes: NativeFileAttributes,
    pub hard_link_count: Option<u32>,
    pub link_target: Option<String>,
    pub volume: Option<NativeVolumeProperties>,
    pub accessible: bool,
    pub access_error: Option<NativeFilesystemError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileProperties {
    pub items: Vec<NativeFilePropertyItem>,
    pub item_count: usize,
    pub file_count: usize,
    pub folder_count: usize,
    pub drive_count: usize,
    pub direct_file_bytes: u64,
    pub direct_allocated_bytes: Option<u64>,
    pub contains_unmeasured_folders: bool,
    pub common_parent_path: Option<String>,
    pub mixed_kinds: bool,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DirectoryMeasurementStatus {
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryMeasurementSnapshot {
    pub id: String,
    pub state: DirectoryMeasurementStatus,
    pub root_count: usize,
    pub files_scanned: u64,
    pub directories_scanned: u64,
    pub logical_bytes: u64,
    pub allocated_bytes: Option<u64>,
    pub allocation_complete: bool,
    pub skipped_entries: u64,
    pub reparse_points_skipped: u64,
    pub duration_ms: f64,
    pub error: Option<NativeFilesystemError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryMeasurementRelease {
    pub released: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryMeasurementDiagnostics {
    pub active_jobs: usize,
    pub retained_jobs: usize,
    pub max_active_jobs: usize,
}

fn properties_error(message: &'static str) -> NativeFilesystemError {
    NativeFilesystemError::new(NativeFilesystemErrorCode::IoError, message)
}

fn timestamp_ms(value: std::io::Result<SystemTime>) -> Option<u64> {
    value
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
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

#[cfg(windows)]
fn wide_null(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn utf16_buffer(buffer: &[u16]) -> Option<String> {
    let length = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    (length > 0).then(|| String::from_utf16_lossy(&buffer[..length]))
}

#[cfg(windows)]
fn volume_for(path: &Path) -> Option<NativeVolumeProperties> {
    use windows_sys::Win32::{
        Storage::FileSystem::{
            GetDiskFreeSpaceExW, GetDriveTypeW, GetVolumeInformationW, GetVolumePathNameW,
        },
        System::WindowsProgramming::{
            DRIVE_CDROM, DRIVE_FIXED, DRIVE_RAMDISK, DRIVE_REMOTE, DRIVE_REMOVABLE,
        },
    };

    let path = backend_path(path);
    let wide_path = wide_null(&path);
    let mut root_buffer = [0_u16; 32_768];
    if unsafe {
        GetVolumePathNameW(
            wide_path.as_ptr(),
            root_buffer.as_mut_ptr(),
            root_buffer.len() as u32,
        )
    } == 0
    {
        return None;
    }
    let root = utf16_buffer(&root_buffer)?;
    let root_path = PathBuf::from(&root);
    let wide_root = wide_null(&root_path);
    let kind = match unsafe { GetDriveTypeW(wide_root.as_ptr()) } {
        DRIVE_FIXED => NativeFileRootKind::Local,
        DRIVE_REMOVABLE => NativeFileRootKind::Removable,
        DRIVE_REMOTE => NativeFileRootKind::Network,
        DRIVE_CDROM => NativeFileRootKind::Optical,
        DRIVE_RAMDISK => NativeFileRootKind::RamDisk,
        _ => NativeFileRootKind::Other,
    };
    let mut label_buffer = [0_u16; 261];
    let mut filesystem_buffer = [0_u16; 64];
    let volume_ok = unsafe {
        GetVolumeInformationW(
            wide_root.as_ptr(),
            label_buffer.as_mut_ptr(),
            label_buffer.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            filesystem_buffer.as_mut_ptr(),
            filesystem_buffer.len() as u32,
        )
    } != 0;
    let mut available = 0_u64;
    let mut total = 0_u64;
    let mut total_free = 0_u64;
    let space_ok = unsafe {
        GetDiskFreeSpaceExW(
            wide_root.as_ptr(),
            &mut available,
            &mut total,
            &mut total_free,
        )
    } != 0;
    Some(NativeVolumeProperties {
        path: path_string(&public_path(&root_path)),
        label: volume_ok.then(|| utf16_buffer(&label_buffer)).flatten(),
        kind,
        file_system: volume_ok
            .then(|| utf16_buffer(&filesystem_buffer))
            .flatten(),
        total_bytes: space_ok.then_some(total),
        free_bytes: space_ok.then_some(available),
        used_bytes: space_ok.then_some(total.saturating_sub(total_free)),
        accessible: volume_ok || space_ok,
    })
}

#[cfg(not(windows))]
fn volume_for(_path: &Path) -> Option<NativeVolumeProperties> {
    None
}

#[cfg(windows)]
fn windows_item_details(
    path: &Path,
    metadata: &fs::Metadata,
) -> (
    NativeFileAttributes,
    Option<u64>,
    Option<u32>,
    NativePropertyItemKind,
    Option<String>,
) {
    use std::os::windows::{
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    };
    use windows_sys::Win32::{
        Foundation::HANDLE,
        Storage::FileSystem::{
            FileAttributeTagInfo, FileStandardInfo, GetFileInformationByHandle,
            GetFileInformationByHandleEx, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_ARCHIVE,
            FILE_ATTRIBUTE_COMPRESSED, FILE_ATTRIBUTE_ENCRYPTED, FILE_ATTRIBUTE_HIDDEN,
            FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_READONLY, FILE_ATTRIBUTE_REPARSE_POINT,
            FILE_ATTRIBUTE_SPARSE_FILE, FILE_ATTRIBUTE_SYSTEM, FILE_ATTRIBUTE_TAG_INFO,
            FILE_ATTRIBUTE_TEMPORARY, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
            FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
            FILE_STANDARD_INFO,
        },
        System::SystemServices::{IO_REPARSE_TAG_MOUNT_POINT, IO_REPARSE_TAG_SYMLINK},
    };

    let raw = metadata.file_attributes();
    let attributes = NativeFileAttributes {
        read_only: raw & FILE_ATTRIBUTE_READONLY != 0,
        hidden: raw & FILE_ATTRIBUTE_HIDDEN != 0,
        system: raw & FILE_ATTRIBUTE_SYSTEM != 0,
        archive: raw & FILE_ATTRIBUTE_ARCHIVE != 0,
        compressed: raw & FILE_ATTRIBUTE_COMPRESSED != 0,
        encrypted: raw & FILE_ATTRIBUTE_ENCRYPTED != 0,
        sparse: raw & FILE_ATTRIBUTE_SPARSE_FILE != 0,
        offline: raw & FILE_ATTRIBUTE_OFFLINE != 0,
        temporary: raw & FILE_ATTRIBUTE_TEMPORARY != 0,
        reparse_point: raw & FILE_ATTRIBUTE_REPARSE_POINT != 0,
    };

    let mut hard_links = None;
    let mut allocated = None;
    let mut reparse_tag = None;
    let mut options = fs::OpenOptions::new();
    options
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
    if let Ok(file) = options.open(path) {
        let handle = file.as_raw_handle() as HANDLE;
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        if unsafe { GetFileInformationByHandle(handle, &mut info) } != 0 {
            hard_links = metadata.is_file().then_some(info.nNumberOfLinks);
        }
        if metadata.is_file() {
            let mut standard = FILE_STANDARD_INFO {
                AllocationSize: 0,
                EndOfFile: 0,
                NumberOfLinks: 0,
                DeletePending: false,
                Directory: false,
            };
            if unsafe {
                GetFileInformationByHandleEx(
                    handle,
                    FileStandardInfo,
                    (&mut standard as *mut FILE_STANDARD_INFO).cast(),
                    std::mem::size_of::<FILE_STANDARD_INFO>() as u32,
                )
            } != 0
            {
                allocated = u64::try_from(standard.AllocationSize).ok();
            }
        }
        if attributes.reparse_point {
            let mut tag = FILE_ATTRIBUTE_TAG_INFO::default();
            if unsafe {
                GetFileInformationByHandleEx(
                    handle,
                    FileAttributeTagInfo,
                    (&mut tag as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
                    std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
                )
            } != 0
            {
                reparse_tag = Some(tag.ReparseTag);
            }
        }
    }

    let kind = if attributes.reparse_point {
        match reparse_tag {
            Some(IO_REPARSE_TAG_SYMLINK) => NativePropertyItemKind::SymbolicLink,
            Some(IO_REPARSE_TAG_MOUNT_POINT) => NativePropertyItemKind::Junction,
            _ => NativePropertyItemKind::OtherReparse,
        }
    } else if metadata.is_dir() {
        NativePropertyItemKind::Directory
    } else if metadata.is_file() {
        NativePropertyItemKind::File
    } else {
        NativePropertyItemKind::Other
    };
    let target = attributes
        .reparse_point
        .then(|| fs::read_link(path).ok())
        .flatten()
        .map(|target| path_string(&public_path(&target)));
    (attributes, allocated, hard_links, kind, target)
}

#[cfg(not(windows))]
fn windows_item_details(
    _path: &Path,
    metadata: &fs::Metadata,
) -> (
    NativeFileAttributes,
    Option<u64>,
    Option<u32>,
    NativePropertyItemKind,
    Option<String>,
) {
    let kind = if metadata.is_dir() {
        NativePropertyItemKind::Directory
    } else if metadata.is_file() {
        NativePropertyItemKind::File
    } else {
        NativePropertyItemKind::Other
    };
    (NativeFileAttributes::default(), None, None, kind, None)
}

fn is_root(path: &Path) -> bool {
    path.parent().is_none() && path.has_root()
}

fn item_properties(path: &Path) -> NativeFilePropertyItem {
    let public = public_path(path);
    let display_path = path_string(&public);
    let name = public
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| display_path.trim_end_matches(['\\', '/']).to_string());
    let parent_path = public
        .parent()
        .filter(|parent| parent.has_root())
        .map(path_string);
    let extension = public
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    let backend = backend_path(&public);
    let volume = volume_for(&public);

    if is_root(&public) {
        let accessible = volume.as_ref().is_some_and(|value| value.accessible);
        return NativeFilePropertyItem {
            name,
            path: display_path,
            parent_path: None,
            extension: None,
            kind: NativePropertyItemKind::Drive,
            size_bytes: None,
            allocated_bytes: None,
            created_at_ms: None,
            modified_at_ms: None,
            accessed_at_ms: None,
            attributes: NativeFileAttributes::default(),
            hard_link_count: None,
            link_target: None,
            volume,
            accessible,
            access_error: (!accessible).then(|| {
                NativeFilesystemError::new(
                    NativeFilesystemErrorCode::DriveUnavailable,
                    "The selected drive is currently unavailable.",
                )
            }),
        };
    }

    match fs::symlink_metadata(&backend) {
        Ok(metadata) => {
            let (attributes, allocated, hard_link_count, kind, link_target) =
                windows_item_details(&backend, &metadata);
            NativeFilePropertyItem {
                name,
                path: display_path,
                parent_path,
                extension,
                kind,
                size_bytes: metadata.is_file().then_some(metadata.len()),
                allocated_bytes: allocated,
                created_at_ms: timestamp_ms(metadata.created()),
                modified_at_ms: timestamp_ms(metadata.modified()),
                accessed_at_ms: timestamp_ms(metadata.accessed()),
                attributes,
                hard_link_count,
                link_target,
                volume,
                accessible: true,
                access_error: None,
            }
        }
        Err(error) => NativeFilePropertyItem {
            name,
            path: display_path,
            parent_path,
            extension,
            kind: NativePropertyItemKind::Unavailable,
            size_bytes: None,
            allocated_bytes: None,
            created_at_ms: None,
            modified_at_ms: None,
            accessed_at_ms: None,
            attributes: NativeFileAttributes::default(),
            hard_link_count: None,
            link_target: None,
            volume,
            accessible: false,
            access_error: Some(NativeFilesystemError::from_io(
                &error,
                "The selected item metadata could not be read.",
            )),
        },
    }
}

fn get_properties_impl(
    raw_paths: Vec<String>,
) -> Result<NativeFileProperties, NativeFilesystemError> {
    let started = Instant::now();
    if raw_paths.is_empty() || raw_paths.len() > MAX_PROPERTY_PATHS {
        return Err(NativeFilesystemError::invalid_path());
    }
    let mut paths = raw_paths
        .iter()
        .map(|path| validate_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort_by_key(|path| path_string(path).to_lowercase());
    paths.dedup_by(|left, right| path_string(left).eq_ignore_ascii_case(&path_string(right)));
    let items = paths
        .iter()
        .map(|path| item_properties(path))
        .collect::<Vec<_>>();
    let file_count = items
        .iter()
        .filter(|item| item.kind == NativePropertyItemKind::File)
        .count();
    let folder_count = items
        .iter()
        .filter(|item| {
            matches!(
                item.kind,
                NativePropertyItemKind::Directory
                    | NativePropertyItemKind::SymbolicLink
                    | NativePropertyItemKind::Junction
                    | NativePropertyItemKind::OtherReparse
            )
        })
        .count();
    let drive_count = items
        .iter()
        .filter(|item| item.kind == NativePropertyItemKind::Drive)
        .count();
    let direct_file_bytes = items
        .iter()
        .filter_map(|item| item.size_bytes)
        .fold(0_u64, u64::saturating_add);
    let direct_allocated_bytes = (file_count > 0)
        .then(|| {
            items
                .iter()
                .filter(|item| item.kind == NativePropertyItemKind::File)
                .try_fold(0_u64, |total, item| {
                    item.allocated_bytes
                        .map(|value| total.saturating_add(value))
                })
        })
        .flatten();
    let common_parent_path = items.first().and_then(|first| {
        first.parent_path.as_ref().and_then(|parent| {
            items
                .iter()
                .all(|item| {
                    item.parent_path
                        .as_ref()
                        .is_some_and(|value| value.eq_ignore_ascii_case(parent))
                })
                .then(|| parent.clone())
        })
    });
    let first_kind = items.first().map(|item| item.kind);
    let mixed_kinds = first_kind.is_some_and(|kind| items.iter().any(|item| item.kind != kind));
    Ok(NativeFileProperties {
        item_count: items.len(),
        file_count,
        folder_count,
        drive_count,
        direct_file_bytes,
        direct_allocated_bytes,
        contains_unmeasured_folders: folder_count > 0,
        common_parent_path,
        mixed_kinds,
        items,
        duration_ms: started.elapsed().as_secs_f64() * 1_000.0,
    })
}

struct MeasurementProgress {
    state: DirectoryMeasurementStatus,
    files_scanned: u64,
    directories_scanned: u64,
    logical_bytes: u64,
    allocated_bytes: u64,
    allocation_complete: bool,
    skipped_entries: u64,
    reparse_points_skipped: u64,
    error: Option<NativeFilesystemError>,
    finished_at: Option<Instant>,
}

struct DirectoryMeasurementJob {
    id: String,
    roots: Vec<PathBuf>,
    started_at: Instant,
    cancelled: AtomicBool,
    released: AtomicBool,
    progress: Mutex<MeasurementProgress>,
}

#[derive(Clone, Default)]
pub struct NativeFilePropertiesState {
    jobs: Arc<Mutex<HashMap<String, Arc<DirectoryMeasurementJob>>>>,
}

#[derive(Default)]
struct PendingMeasurement {
    files_scanned: u64,
    directories_scanned: u64,
    logical_bytes: u64,
    allocated_bytes: u64,
    allocation_complete: bool,
    skipped_entries: u64,
    reparse_points_skipped: u64,
    last_flush: Option<Instant>,
}

fn terminal(state: DirectoryMeasurementStatus) -> bool {
    matches!(
        state,
        DirectoryMeasurementStatus::Completed
            | DirectoryMeasurementStatus::Cancelled
            | DirectoryMeasurementStatus::Failed
    )
}

fn random_id() -> Result<String, NativeFilesystemError> {
    let mut bytes = [0_u8; 16];
    random_fill(&mut bytes)
        .map_err(|_| properties_error("Windows could not start the measurement."))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn validate_id(id: &str) -> Result<(), NativeFilesystemError> {
    if id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(NativeFilesystemError::invalid_path())
    }
}

fn flush_measurement(job: &DirectoryMeasurementJob, pending: &mut PendingMeasurement, force: bool) {
    let should_flush = force
        || pending
            .files_scanned
            .saturating_add(pending.directories_scanned)
            >= PROGRESS_FLUSH_ENTRIES
        || pending
            .last_flush
            .is_none_or(|last| last.elapsed() >= PROGRESS_FLUSH_INTERVAL);
    if !should_flush {
        return;
    }
    if let Ok(mut progress) = job.progress.lock() {
        progress.files_scanned = progress.files_scanned.saturating_add(pending.files_scanned);
        progress.directories_scanned = progress
            .directories_scanned
            .saturating_add(pending.directories_scanned);
        progress.logical_bytes = progress.logical_bytes.saturating_add(pending.logical_bytes);
        progress.allocated_bytes = progress
            .allocated_bytes
            .saturating_add(pending.allocated_bytes);
        progress.allocation_complete &= pending.allocation_complete;
        progress.skipped_entries = progress
            .skipped_entries
            .saturating_add(pending.skipped_entries);
        progress.reparse_points_skipped = progress
            .reparse_points_skipped
            .saturating_add(pending.reparse_points_skipped);
    }
    *pending = PendingMeasurement {
        allocation_complete: true,
        last_flush: Some(Instant::now()),
        ..PendingMeasurement::default()
    };
}

fn scan_measurement(job: &DirectoryMeasurementJob) -> DirectoryMeasurementStatus {
    if let Ok(mut progress) = job.progress.lock() {
        progress.state = DirectoryMeasurementStatus::Running;
    }
    let mut pending = PendingMeasurement {
        allocation_complete: true,
        last_flush: Some(Instant::now()),
        ..PendingMeasurement::default()
    };
    let mut directories = Vec::new();
    let mut opened_root = false;
    for root in &job.roots {
        let metadata = match fs::symlink_metadata(root) {
            Ok(metadata) => metadata,
            Err(_) => {
                pending.skipped_entries = pending.skipped_entries.saturating_add(1);
                continue;
            }
        };
        let (attributes, allocated, _, kind, _) = windows_item_details(root, &metadata);
        if attributes.reparse_point {
            opened_root = true;
            pending.reparse_points_skipped = pending.reparse_points_skipped.saturating_add(1);
            continue;
        }
        if metadata.is_file() {
            opened_root = true;
            pending.files_scanned = pending.files_scanned.saturating_add(1);
            pending.logical_bytes = pending.logical_bytes.saturating_add(metadata.len());
            if let Some(value) = allocated {
                pending.allocated_bytes = pending.allocated_bytes.saturating_add(value);
            } else {
                pending.allocation_complete = false;
            }
        } else if kind == NativePropertyItemKind::Directory {
            opened_root = true;
            pending.directories_scanned = pending.directories_scanned.saturating_add(1);
            match fs::read_dir(root) {
                Ok(entries) => directories.push(entries),
                Err(_) => pending.skipped_entries = pending.skipped_entries.saturating_add(1),
            }
        }
    }

    if !opened_root {
        flush_measurement(job, &mut pending, true);
        return DirectoryMeasurementStatus::Failed;
    }

    while let Some(entries) = directories.last_mut() {
        if job.cancelled.load(Ordering::Acquire) {
            flush_measurement(job, &mut pending, true);
            return DirectoryMeasurementStatus::Cancelled;
        }
        let Some(next) = entries.next() else {
            directories.pop();
            continue;
        };
        let entry = match next {
            Ok(entry) => entry,
            Err(_) => {
                pending.skipped_entries = pending.skipped_entries.saturating_add(1);
                flush_measurement(job, &mut pending, false);
                continue;
            }
        };
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                pending.skipped_entries = pending.skipped_entries.saturating_add(1);
                flush_measurement(job, &mut pending, false);
                continue;
            }
        };
        let (attributes, allocated, _, kind, _) = windows_item_details(&path, &metadata);
        if attributes.reparse_point {
            pending.reparse_points_skipped = pending.reparse_points_skipped.saturating_add(1);
        } else if metadata.is_file() {
            pending.files_scanned = pending.files_scanned.saturating_add(1);
            pending.logical_bytes = pending.logical_bytes.saturating_add(metadata.len());
            if let Some(value) = allocated {
                pending.allocated_bytes = pending.allocated_bytes.saturating_add(value);
            } else {
                pending.allocation_complete = false;
            }
        } else if kind == NativePropertyItemKind::Directory {
            pending.directories_scanned = pending.directories_scanned.saturating_add(1);
            match fs::read_dir(&path) {
                Ok(children) => directories.push(children),
                Err(_) => pending.skipped_entries = pending.skipped_entries.saturating_add(1),
            }
        } else {
            pending.skipped_entries = pending.skipped_entries.saturating_add(1);
        }
        flush_measurement(job, &mut pending, false);
    }
    flush_measurement(job, &mut pending, true);
    DirectoryMeasurementStatus::Completed
}

impl DirectoryMeasurementJob {
    fn snapshot(&self) -> Result<DirectoryMeasurementSnapshot, NativeFilesystemError> {
        let progress = self
            .progress
            .lock()
            .map_err(|_| properties_error("The directory measurement state is unavailable."))?;
        Ok(DirectoryMeasurementSnapshot {
            id: self.id.clone(),
            state: progress.state,
            root_count: self.roots.len(),
            files_scanned: progress.files_scanned,
            directories_scanned: progress.directories_scanned,
            logical_bytes: progress.logical_bytes,
            allocated_bytes: progress
                .allocation_complete
                .then_some(progress.allocated_bytes),
            allocation_complete: progress.allocation_complete,
            skipped_entries: progress.skipped_entries,
            reparse_points_skipped: progress.reparse_points_skipped,
            duration_ms: self.started_at.elapsed().as_secs_f64() * 1_000.0,
            error: progress.error.clone(),
        })
    }
}

impl NativeFilePropertiesState {
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
                .is_none_or(|finished| finished.elapsed() < TERMINAL_MEASUREMENT_TTL)
        });
        if jobs.len() <= MAX_MEASUREMENT_RECORDS {
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
        terminal_jobs.sort_by_key(|(_, started)| *started);
        let remove = jobs.len().saturating_sub(MAX_MEASUREMENT_RECORDS);
        for (id, _) in terminal_jobs.into_iter().take(remove) {
            jobs.remove(&id);
        }
    }

    fn start(
        &self,
        raw_paths: Vec<String>,
    ) -> Result<DirectoryMeasurementSnapshot, NativeFilesystemError> {
        if raw_paths.is_empty() || raw_paths.len() > MAX_PROPERTY_PATHS {
            return Err(NativeFilesystemError::invalid_path());
        }
        let mut roots = raw_paths
            .iter()
            .map(|path| validate_path(path).map(|path| backend_path(&path)))
            .collect::<Result<Vec<_>, _>>()?;
        roots.sort_by_key(|path| path_string(path).to_lowercase());
        roots.dedup_by(|left, right| path_string(left).eq_ignore_ascii_case(&path_string(right)));
        self.prune();
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| properties_error("The directory measurement service is unavailable."))?;
        let active = jobs
            .values()
            .filter(|job| {
                job.progress
                    .lock()
                    .is_ok_and(|progress| !terminal(progress.state))
            })
            .count();
        if active >= MAX_ACTIVE_MEASUREMENTS {
            return Err(properties_error(
                "Too many directory measurements are already running.",
            ));
        }
        let id = random_id()?;
        let job = Arc::new(DirectoryMeasurementJob {
            id: id.clone(),
            roots,
            started_at: Instant::now(),
            cancelled: AtomicBool::new(false),
            released: AtomicBool::new(false),
            progress: Mutex::new(MeasurementProgress {
                state: DirectoryMeasurementStatus::Queued,
                files_scanned: 0,
                directories_scanned: 0,
                logical_bytes: 0,
                allocated_bytes: 0,
                allocation_complete: true,
                skipped_entries: 0,
                reparse_points_skipped: 0,
                error: None,
                finished_at: None,
            }),
        });
        let initial = job.snapshot()?;
        jobs.insert(id.clone(), Arc::clone(&job));
        drop(jobs);
        let state = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let status = scan_measurement(&job);
            if let Ok(mut progress) = job.progress.lock() {
                progress.state = status;
                if status == DirectoryMeasurementStatus::Failed {
                    progress.error = Some(NativeFilesystemError::new(
                        NativeFilesystemErrorCode::AccessDenied,
                        "None of the selected locations could be measured.",
                    ));
                }
                progress.finished_at = Some(Instant::now());
            }
            if job.released.load(Ordering::Acquire) {
                if let Ok(mut jobs) = state.jobs.lock() {
                    jobs.remove(&id);
                }
            }
        });
        Ok(initial)
    }

    fn job(&self, id: &str) -> Result<Arc<DirectoryMeasurementJob>, NativeFilesystemError> {
        validate_id(id)?;
        self.prune();
        self.jobs
            .lock()
            .map_err(|_| properties_error("The directory measurement service is unavailable."))?
            .get(id)
            .cloned()
            .ok_or_else(|| {
                NativeFilesystemError::new(
                    NativeFilesystemErrorCode::NotFound,
                    "The directory measurement is no longer available.",
                )
            })
    }

    fn get(&self, id: &str) -> Result<DirectoryMeasurementSnapshot, NativeFilesystemError> {
        self.job(id)?.snapshot()
    }

    fn cancel(&self, id: &str) -> Result<DirectoryMeasurementSnapshot, NativeFilesystemError> {
        let job = self.job(id)?;
        job.cancelled.store(true, Ordering::Release);
        job.snapshot()
    }

    fn release(&self, id: &str) -> Result<DirectoryMeasurementRelease, NativeFilesystemError> {
        validate_id(id)?;
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| properties_error("The directory measurement service is unavailable."))?;
        let job = jobs.get(id).cloned().ok_or_else(|| {
            NativeFilesystemError::new(
                NativeFilesystemErrorCode::NotFound,
                "The directory measurement is no longer available.",
            )
        })?;
        job.cancelled.store(true, Ordering::Release);
        job.released.store(true, Ordering::Release);
        let finished = job
            .progress
            .lock()
            .is_ok_and(|progress| terminal(progress.state));
        if finished {
            jobs.remove(id);
        }
        Ok(DirectoryMeasurementRelease { released: true })
    }

    fn diagnostics(&self) -> DirectoryMeasurementDiagnostics {
        self.prune();
        let Ok(jobs) = self.jobs.lock() else {
            return DirectoryMeasurementDiagnostics {
                active_jobs: 0,
                retained_jobs: 0,
                max_active_jobs: MAX_ACTIVE_MEASUREMENTS,
            };
        };
        DirectoryMeasurementDiagnostics {
            active_jobs: jobs
                .values()
                .filter(|job| {
                    job.progress
                        .lock()
                        .is_ok_and(|progress| !terminal(progress.state))
                })
                .count(),
            retained_jobs: jobs.len(),
            max_active_jobs: MAX_ACTIVE_MEASUREMENTS,
        }
    }
}

impl Drop for NativeFilePropertiesState {
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
pub fn get_native_file_properties(
    paths: Vec<String>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileProperties>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(get_properties_impl(
        paths,
    )))
}

#[tauri::command]
pub fn start_native_directory_measurement(
    paths: Vec<String>,
    state: State<'_, NativeFilePropertiesState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<DirectoryMeasurementSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.start(paths)))
}

#[tauri::command]
pub fn get_native_directory_measurement(
    id: String,
    state: State<'_, NativeFilePropertiesState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<DirectoryMeasurementSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.get(&id)))
}

#[tauri::command]
pub fn cancel_native_directory_measurement(
    id: String,
    state: State<'_, NativeFilePropertiesState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<DirectoryMeasurementSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.cancel(&id)))
}

#[tauri::command]
pub fn release_native_directory_measurement(
    id: String,
    state: State<'_, NativeFilePropertiesState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<DirectoryMeasurementRelease>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.release(&id)))
}

#[tauri::command]
pub fn get_native_directory_measurement_diagnostics(
    state: State<'_, NativeFilePropertiesState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<DirectoryMeasurementDiagnostics>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(Ok(
        state.diagnostics()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_file_properties_are_read_only_and_exact() {
        let root =
            std::env::temp_dir().join(format!("nammu-f5a-properties-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let file = root.join("hello world.txt");
        fs::write(&file, b"nammu").unwrap();
        let result = get_properties_impl(vec![path_string(&file)]).unwrap();
        assert_eq!(result.item_count, 1);
        assert_eq!(result.file_count, 1);
        assert_eq!(result.direct_file_bytes, 5);
        assert_eq!(result.items[0].extension.as_deref(), Some("txt"));
        assert!(result.items[0].allocated_bytes.is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn measurement_completes_and_releases_without_retained_jobs() {
        let root = std::env::temp_dir().join(format!("nammu-f5a-measure-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("nested")).unwrap();
        for index in 0..128 {
            fs::write(root.join("nested").join(format!("{index}.bin")), [0_u8; 8]).unwrap();
        }
        let state = NativeFilePropertiesState::default();
        let started = state.start(vec![path_string(&root)]).unwrap();
        let mut snapshot = started;
        for _ in 0..200 {
            snapshot = state.get(&snapshot.id).unwrap();
            if terminal(snapshot.state) {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(snapshot.state, DirectoryMeasurementStatus::Completed);
        assert_eq!(snapshot.files_scanned, 128);
        assert_eq!(snapshot.logical_bytes, 1024);
        state.release(&snapshot.id).unwrap();
        assert_eq!(state.diagnostics().retained_jobs, 0);
        fs::remove_dir_all(root).unwrap();
    }
}
