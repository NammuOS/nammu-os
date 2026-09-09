use serde::Serialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Webview;

use crate::trusted_shell::require_trusted_shell;

const MAX_NATIVE_PATH_UNITS: usize = 32_767;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NativeFilesystemErrorCode {
    NotFound,
    AccessDenied,
    NotDirectory,
    DriveUnavailable,
    InvalidPath,
    AlreadyExists,
    InvalidName,
    InvalidDestination,
    FileInUse,
    ReadOnly,
    SourceEqualsDestination,
    DestinationInsideSource,
    OperationCancelled,
    RecycleUnsupported,
    RootOperationForbidden,
    ConfirmationRequired,
    UndoUnavailable,
    WatchUnsupported,
    WatchFailed,
    PreviewUnsupported,
    PdfEncrypted,
    DecodeFailed,
    FileChanged,
    ArchiveUnsupported,
    ArchiveInvalid,
    ArchiveEncrypted,
    ArchiveLimitExceeded,
    ArchiveEntryUnsafe,
    ArchiveCorrupt,
    ClipboardBusy,
    ClipboardUnavailable,
    ClipboardFormatUnsupported,
    ClipboardTooLarge,
    InvalidClipboardData,
    IoError,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFilesystemError {
    pub code: NativeFilesystemErrorCode,
    pub message: String,
}

impl NativeFilesystemError {
    pub(crate) fn new(code: NativeFilesystemErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub(crate) fn invalid_path() -> Self {
        Self::new(
            NativeFilesystemErrorCode::InvalidPath,
            "The filesystem path is invalid.",
        )
    }

    pub(crate) fn from_io(error: &io::Error, operation: &'static str) -> Self {
        let code = match error.kind() {
            io::ErrorKind::NotFound => NativeFilesystemErrorCode::NotFound,
            _ if is_file_in_use(error) => NativeFilesystemErrorCode::FileInUse,
            _ if is_read_only(error) => NativeFilesystemErrorCode::ReadOnly,
            io::ErrorKind::PermissionDenied => NativeFilesystemErrorCode::AccessDenied,
            io::ErrorKind::NotADirectory => NativeFilesystemErrorCode::NotDirectory,
            io::ErrorKind::AlreadyExists => NativeFilesystemErrorCode::AlreadyExists,
            _ if is_drive_unavailable(error) => NativeFilesystemErrorCode::DriveUnavailable,
            _ => NativeFilesystemErrorCode::IoError,
        };
        let message = match code {
            NativeFilesystemErrorCode::NotFound => "The requested item no longer exists.",
            NativeFilesystemErrorCode::AccessDenied => {
                "Windows did not allow Nammu to read this location."
            }
            NativeFilesystemErrorCode::NotDirectory => "The requested location is not a directory.",
            NativeFilesystemErrorCode::DriveUnavailable => {
                "The requested drive or network location is unavailable."
            }
            NativeFilesystemErrorCode::InvalidPath => "The filesystem path is invalid.",
            NativeFilesystemErrorCode::AlreadyExists => {
                "An item with that name already exists in the destination."
            }
            NativeFilesystemErrorCode::InvalidName => "The item name is not valid on Windows.",
            NativeFilesystemErrorCode::InvalidDestination => {
                "The selected destination cannot accept this operation."
            }
            NativeFilesystemErrorCode::FileInUse => {
                "The item is currently in use by another application."
            }
            NativeFilesystemErrorCode::ReadOnly => "The destination is read-only.",
            NativeFilesystemErrorCode::SourceEqualsDestination => {
                "The source and destination are the same location."
            }
            NativeFilesystemErrorCode::DestinationInsideSource => {
                "A folder cannot be copied or moved into itself."
            }
            NativeFilesystemErrorCode::OperationCancelled => "The operation was cancelled.",
            NativeFilesystemErrorCode::RecycleUnsupported => {
                "This location does not support the Windows Recycle Bin."
            }
            NativeFilesystemErrorCode::RootOperationForbidden => {
                "Filesystem roots cannot be deleted."
            }
            NativeFilesystemErrorCode::ConfirmationRequired => {
                "Permanent deletion requires explicit confirmation."
            }
            NativeFilesystemErrorCode::UndoUnavailable => {
                "This operation is no longer available to undo."
            }
            NativeFilesystemErrorCode::WatchUnsupported => {
                "This location does not support live filesystem updates."
            }
            NativeFilesystemErrorCode::WatchFailed => {
                "Live filesystem updates are temporarily unavailable for this folder."
            }
            NativeFilesystemErrorCode::PreviewUnsupported => {
                "This file type does not support a safe preview."
            }
            NativeFilesystemErrorCode::PdfEncrypted => {
                "Password-protected PDFs are not previewed in Files."
            }
            NativeFilesystemErrorCode::DecodeFailed => "The file could not be decoded safely.",
            NativeFilesystemErrorCode::FileChanged => {
                "The file changed while its preview was being prepared."
            }
            NativeFilesystemErrorCode::ArchiveUnsupported => {
                "This archive format or compression method is not supported."
            }
            NativeFilesystemErrorCode::ArchiveInvalid => "The ZIP archive is invalid.",
            NativeFilesystemErrorCode::ArchiveEncrypted => {
                "Password-protected archives are unavailable in this version."
            }
            NativeFilesystemErrorCode::ArchiveLimitExceeded => {
                "The archive exceeds Nammu's extraction safety limits."
            }
            NativeFilesystemErrorCode::ArchiveEntryUnsafe => {
                "The archive contains an unsafe path or link entry."
            }
            NativeFilesystemErrorCode::ArchiveCorrupt => {
                "The archive is corrupt or failed its integrity check."
            }
            NativeFilesystemErrorCode::ClipboardBusy => {
                "The Windows clipboard is busy. Try again in a moment."
            }
            NativeFilesystemErrorCode::ClipboardUnavailable => {
                "The Windows file clipboard is temporarily unavailable."
            }
            NativeFilesystemErrorCode::ClipboardFormatUnsupported => {
                "The clipboard file list uses an unsupported Windows format."
            }
            NativeFilesystemErrorCode::ClipboardTooLarge => {
                "The file selection is too large for the Windows clipboard."
            }
            NativeFilesystemErrorCode::InvalidClipboardData => {
                "The Windows file clipboard contains invalid path data."
            }
            NativeFilesystemErrorCode::IoError => operation,
        };
        Self::new(code, message)
    }
}

fn is_file_in_use(error: &io::Error) -> bool {
    #[cfg(windows)]
    {
        matches!(error.raw_os_error(), Some(32 | 33))
    }
    #[cfg(not(windows))]
    {
        let _ = error;
        false
    }
}

fn is_read_only(error: &io::Error) -> bool {
    #[cfg(windows)]
    {
        matches!(error.raw_os_error(), Some(19))
    }
    #[cfg(not(windows))]
    {
        let _ = error;
        false
    }
}

fn is_drive_unavailable(error: &io::Error) -> bool {
    #[cfg(windows)]
    {
        matches!(error.raw_os_error(), Some(15 | 21 | 53 | 67 | 1005 | 1167))
    }
    #[cfg(not(windows))]
    {
        let _ = error;
        false
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileRootKind {
    Local,
    Removable,
    Network,
    Optical,
    RamDisk,
    Other,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileRoot {
    pub path: String,
    pub name: String,
    pub kind: NativeFileRootKind,
    pub label: Option<String>,
    pub file_system: Option<String>,
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
    pub accessible: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileRoots {
    pub roots: Vec<NativeFileRoot>,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileKind {
    File,
    Directory,
    ReparsePoint,
    Other,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileMetadata {
    pub name: String,
    pub path: String,
    pub kind: NativeFileKind,
    pub size_bytes: Option<u64>,
    pub created_at_ms: Option<u64>,
    pub modified_at_ms: Option<u64>,
    pub extension: Option<String>,
    pub hidden: bool,
    pub system: bool,
    pub read_only: bool,
    pub readable: bool,
    pub navigable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileBreadcrumb {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDirectoryListing {
    pub path: String,
    pub parent_path: Option<String>,
    pub breadcrumbs: Vec<NativeFileBreadcrumb>,
    pub entries: Vec<NativeFileMetadata>,
    pub omitted_entries: usize,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum NativeFilesystemResponse<T> {
    Success { value: T },
    Error { error: NativeFilesystemError },
}

impl<T> NativeFilesystemResponse<T> {
    pub(crate) fn from_result(result: Result<T, NativeFilesystemError>) -> Self {
        match result {
            Ok(value) => Self::Success { value },
            Err(error) => Self::Error { error },
        }
    }
}

pub(crate) fn require_trusted_caller(caller: &Webview) -> Result<(), String> {
    require_trusted_shell(caller)
}

pub(crate) fn validate_path(raw: &str) -> Result<PathBuf, NativeFilesystemError> {
    if raw.is_empty()
        || raw.chars().any(char::is_control)
        || raw.encode_utf16().count() > MAX_NATIVE_PATH_UNITS
    {
        return Err(NativeFilesystemError::invalid_path());
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(NativeFilesystemError::invalid_path());
    }
    Ok(path)
}

pub(crate) fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn timestamp_ms(value: io::Result<SystemTime>) -> Option<u64> {
    value
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

#[cfg(windows)]
fn windows_attributes(metadata: &fs::Metadata) -> (bool, bool, bool) {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_SYSTEM,
    };

    let attributes = metadata.file_attributes();
    (
        attributes & FILE_ATTRIBUTE_HIDDEN != 0,
        attributes & FILE_ATTRIBUTE_SYSTEM != 0,
        attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0,
    )
}

#[cfg(not(windows))]
fn windows_attributes(_metadata: &fs::Metadata) -> (bool, bool, bool) {
    (false, false, false)
}

pub(crate) fn metadata_from_path(
    path: &Path,
    name: String,
) -> Result<NativeFileMetadata, NativeFilesystemError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The item metadata could not be read.")
    })?;
    let file_type = metadata.file_type();
    let (attribute_hidden, system, reparse) = windows_attributes(&metadata);
    let linked_directory = if file_type.is_symlink() || reparse {
        fs::metadata(path)
            .ok()
            .is_some_and(|target| target.is_dir())
    } else {
        false
    };
    let navigable = file_type.is_dir() || linked_directory;
    let kind = if file_type.is_symlink() || reparse {
        NativeFileKind::ReparsePoint
    } else if file_type.is_dir() {
        NativeFileKind::Directory
    } else if file_type.is_file() {
        NativeFileKind::File
    } else {
        NativeFileKind::Other
    };
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);

    Ok(NativeFileMetadata {
        hidden: attribute_hidden || name.starts_with('.'),
        system,
        read_only: metadata.permissions().readonly(),
        readable: true,
        navigable,
        size_bytes: (!navigable && file_type.is_file()).then_some(metadata.len()),
        created_at_ms: timestamp_ms(metadata.created()),
        modified_at_ms: timestamp_ms(metadata.modified()),
        extension,
        name,
        path: path_string(path),
        kind,
    })
}

fn unreadable_entry(path: PathBuf, name: String) -> NativeFileMetadata {
    NativeFileMetadata {
        hidden: name.starts_with('.'),
        system: false,
        read_only: false,
        readable: false,
        navigable: false,
        size_bytes: None,
        created_at_ms: None,
        modified_at_ms: None,
        extension: path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase),
        name,
        path: path_string(&path),
        kind: NativeFileKind::Other,
    }
}

fn breadcrumbs(path: &Path) -> Vec<NativeFileBreadcrumb> {
    let mut ancestors = path
        .ancestors()
        .filter(|ancestor| !ancestor.as_os_str().is_empty())
        .collect::<Vec<_>>();
    ancestors.reverse();
    ancestors
        .into_iter()
        .map(|ancestor| {
            let path_value = path_string(ancestor);
            let name = ancestor
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_string)
                .unwrap_or_else(|| path_value.trim_end_matches(['\\', '/']).to_string());
            NativeFileBreadcrumb {
                name,
                path: path_value,
            }
        })
        .collect()
}

fn list_directory_impl(raw: &str) -> Result<NativeDirectoryListing, NativeFilesystemError> {
    let started = Instant::now();
    let path = validate_path(raw)?;
    let metadata = fs::metadata(&path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The directory could not be inspected.")
    })?;
    if !metadata.is_dir() {
        return Err(NativeFilesystemError::new(
            NativeFilesystemErrorCode::NotDirectory,
            "The requested location is not a directory.",
        ));
    }

    let directory = fs::read_dir(&path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The directory could not be read.")
    })?;
    let mut entries = Vec::new();
    let mut omitted_entries = 0;
    for result in directory {
        let entry = match result {
            Ok(entry) => entry,
            Err(_) => {
                omitted_entries += 1;
                continue;
            }
        };
        let child_path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        entries.push(
            metadata_from_path(&child_path, name.clone())
                .unwrap_or_else(|_| unreadable_entry(child_path, name)),
        );
    }
    entries.sort_by(|left, right| {
        right
            .navigable
            .cmp(&left.navigable)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(NativeDirectoryListing {
        path: path_string(&path),
        parent_path: path
            .parent()
            .filter(|parent| parent.is_absolute())
            .map(path_string),
        breadcrumbs: breadcrumbs(&path),
        entries,
        omitted_entries,
        duration_ms: started.elapsed().as_secs_f64() * 1_000.0,
    })
}

fn stat_impl(raw: &str) -> Result<NativeFileMetadata, NativeFilesystemError> {
    let path = validate_path(raw)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path_string(&path));
    metadata_from_path(&path, name)
}

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
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
fn list_roots_impl() -> Result<NativeFileRoots, NativeFilesystemError> {
    use windows_sys::Win32::{
        Storage::FileSystem::{
            GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
        },
        System::WindowsProgramming::{
            DRIVE_CDROM, DRIVE_FIXED, DRIVE_RAMDISK, DRIVE_REMOTE, DRIVE_REMOVABLE,
        },
    };

    let started = Instant::now();
    let drive_mask = unsafe { GetLogicalDrives() };
    if drive_mask == 0 {
        return Err(NativeFilesystemError::new(
            NativeFilesystemErrorCode::IoError,
            "Windows could not enumerate the available drives.",
        ));
    }

    let mut roots = Vec::new();
    for index in 0..26_u32 {
        if drive_mask & (1 << index) == 0 {
            continue;
        }
        let letter = char::from_u32(u32::from(b'A') + index).unwrap_or('A');
        let path = format!("{letter}:\\");
        let wide_path = wide_null(&path);
        let drive_type = unsafe { GetDriveTypeW(wide_path.as_ptr()) };
        let kind = match drive_type {
            DRIVE_FIXED => NativeFileRootKind::Local,
            DRIVE_REMOVABLE => NativeFileRootKind::Removable,
            DRIVE_REMOTE => NativeFileRootKind::Network,
            DRIVE_CDROM => NativeFileRootKind::Optical,
            DRIVE_RAMDISK => NativeFileRootKind::RamDisk,
            _ => NativeFileRootKind::Other,
        };

        // Disconnected network roots can block for a long time. They remain visible,
        // but capacity/volume probing is deferred until explicit navigation.
        let should_probe = kind != NativeFileRootKind::Network;
        let accessible = should_probe && fs::metadata(&path).is_ok_and(|entry| entry.is_dir());
        let mut label = None;
        let mut file_system = None;
        let mut total_bytes = None;
        let mut free_bytes = None;
        if accessible {
            let mut volume_buffer = [0_u16; 261];
            let mut filesystem_buffer = [0_u16; 64];
            let volume_ok = unsafe {
                GetVolumeInformationW(
                    wide_path.as_ptr(),
                    volume_buffer.as_mut_ptr(),
                    volume_buffer.len() as u32,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    filesystem_buffer.as_mut_ptr(),
                    filesystem_buffer.len() as u32,
                )
            } != 0;
            if volume_ok {
                label = utf16_buffer(&volume_buffer);
                file_system = utf16_buffer(&filesystem_buffer);
            }
            let mut available = 0_u64;
            let mut total = 0_u64;
            let mut total_free = 0_u64;
            let space_ok = unsafe {
                GetDiskFreeSpaceExW(
                    wide_path.as_ptr(),
                    &mut available,
                    &mut total,
                    &mut total_free,
                )
            } != 0;
            if space_ok {
                total_bytes = Some(total);
                free_bytes = Some(available);
            }
        }
        let fallback = match kind {
            NativeFileRootKind::Local => "Local Disk",
            NativeFileRootKind::Removable => "Removable Drive",
            NativeFileRootKind::Network => "Network Drive",
            NativeFileRootKind::Optical => "Optical Drive",
            NativeFileRootKind::RamDisk => "RAM Disk",
            NativeFileRootKind::Other => "Drive",
        };
        let name = format!("{} ({letter}:)", label.as_deref().unwrap_or(fallback));
        roots.push(NativeFileRoot {
            path,
            name,
            kind,
            label,
            file_system,
            total_bytes,
            free_bytes,
            accessible: accessible || kind == NativeFileRootKind::Network,
        });
    }

    Ok(NativeFileRoots {
        roots,
        duration_ms: started.elapsed().as_secs_f64() * 1_000.0,
    })
}

#[cfg(not(windows))]
fn list_roots_impl() -> Result<NativeFileRoots, NativeFilesystemError> {
    let started = Instant::now();
    Ok(NativeFileRoots {
        roots: vec![NativeFileRoot {
            path: "/".to_string(),
            name: "Computer".to_string(),
            kind: NativeFileRootKind::Local,
            label: None,
            file_system: None,
            total_bytes: None,
            free_bytes: None,
            accessible: true,
        }],
        duration_ms: started.elapsed().as_secs_f64() * 1_000.0,
    })
}

async fn run_blocking<T, F>(operation: F) -> NativeFilesystemResponse<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, NativeFilesystemError> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(operation).await {
        Ok(result) => NativeFilesystemResponse::from_result(result),
        Err(_) => NativeFilesystemResponse::Error {
            error: NativeFilesystemError::new(
                NativeFilesystemErrorCode::IoError,
                "The native filesystem worker stopped unexpectedly.",
            ),
        },
    }
}

#[tauri::command]
pub async fn list_native_file_roots(
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileRoots>, String> {
    require_trusted_caller(&caller)?;
    Ok(run_blocking(list_roots_impl).await)
}

#[tauri::command]
pub async fn list_native_directory(
    path: String,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeDirectoryListing>, String> {
    require_trusted_caller(&caller)?;
    Ok(run_blocking(move || list_directory_impl(&path)).await)
}

#[tauri::command]
pub async fn stat_native_file(
    path: String,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileMetadata>, String> {
    require_trusted_caller(&caller)?;
    Ok(run_blocking(move || stat_impl(&path)).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let unique = format!(
            "nammu-files-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        fs::create_dir_all(root.join("folder with spaces").join("nested")).unwrap();
        fs::write(root.join("unicode-नम्मु.txt"), b"nammu").unwrap();
        fs::write(
            root.join("folder with spaces").join("nested.txt"),
            b"nested",
        )
        .unwrap();
        root
    }

    #[test]
    fn lists_only_direct_children_with_metadata() {
        let root = fixture();
        let listing = list_directory_impl(&path_string(&root)).unwrap();
        assert_eq!(listing.entries.len(), 2);
        assert_eq!(listing.omitted_entries, 0);
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.name == "folder with spaces" && entry.navigable));
        let unicode = listing
            .entries
            .iter()
            .find(|entry| entry.name == "unicode-नम्मु.txt")
            .unwrap();
        assert_eq!(unicode.size_bytes, Some(5));
        assert_eq!(unicode.extension.as_deref(), Some("txt"));
        assert!(!listing
            .entries
            .iter()
            .any(|entry| entry.name == "nested.txt"));
        let empty = list_directory_impl(&path_string(
            &root.join("folder with spaces").join("nested"),
        ))
        .unwrap();
        assert!(empty.entries.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_relative_and_missing_paths_with_structured_codes() {
        assert_eq!(
            list_directory_impl("relative/path").unwrap_err().code,
            NativeFilesystemErrorCode::InvalidPath
        );
        let missing = std::env::temp_dir().join("nammu-files-path-that-does-not-exist");
        assert_eq!(
            list_directory_impl(&path_string(&missing))
                .unwrap_err()
                .code,
            NativeFilesystemErrorCode::NotFound
        );
    }

    #[test]
    fn reports_files_as_not_directories() {
        let root = fixture();
        let file = root.join("unicode-नम्मु.txt");
        assert_eq!(
            list_directory_impl(&path_string(&file)).unwrap_err().code,
            NativeFilesystemErrorCode::NotDirectory
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stat_is_read_only_and_preserves_unicode_names() {
        let root = fixture();
        let file = root.join("unicode-नम्मु.txt");
        let metadata = stat_impl(&path_string(&file)).unwrap();
        assert_eq!(metadata.name, "unicode-नम्मु.txt");
        assert_eq!(metadata.kind, NativeFileKind::File);
        assert_eq!(metadata.size_bytes, Some(5));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn large_directory_listing_baseline_is_direct_and_bounded() {
        let root = fixture();
        let large = root.join("large folder");
        fs::create_dir_all(&large).unwrap();
        for index in 0..1_500 {
            fs::write(large.join(format!("item-{index:04}.txt")), b"").unwrap();
        }

        let started = Instant::now();
        let listing = list_directory_impl(&path_string(&large)).unwrap();
        let elapsed = started.elapsed();
        println!(
            "native filesystem large-directory baseline: {} entries in {:.2} ms",
            listing.entries.len(),
            elapsed.as_secs_f64() * 1_000.0
        );
        assert_eq!(listing.entries.len(), 1_500);
        assert!(elapsed.as_secs() < 10);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn permission_errors_are_not_reduced_to_generic_io_errors() {
        let error = io::Error::from(io::ErrorKind::PermissionDenied);
        assert_eq!(
            NativeFilesystemError::from_io(&error, "fallback").code,
            NativeFilesystemErrorCode::AccessDenied
        );
    }

    #[test]
    fn root_enumeration_does_not_assume_a_specific_drive_letter() {
        let roots = list_roots_impl().unwrap();
        assert!(!roots.roots.is_empty());
        assert!(roots
            .roots
            .iter()
            .all(|root| Path::new(&root.path).is_absolute()));
    }

    #[test]
    fn host_drive_and_typical_folder_readonly_baseline() {
        let roots = list_roots_impl().unwrap();
        println!(
            "native filesystem drive-enumeration baseline: {} roots in {:.2} ms",
            roots.roots.len(),
            roots.duration_ms
        );
        if let Some(root) = roots.roots.iter().find(|root| root.accessible) {
            let listing = list_directory_impl(&root.path).unwrap();
            println!(
                "native filesystem typical-folder baseline: {} entries in {:.2} ms",
                listing.entries.len(),
                listing.duration_ms
            );
        }
    }
}
