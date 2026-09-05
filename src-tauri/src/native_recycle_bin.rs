use crate::native_file_operations::NativeFileOperationStatus;
use crate::native_filesystem::{
    path_string, require_trusted_caller, validate_path, NativeFilesystemError,
    NativeFilesystemErrorCode, NativeFilesystemResponse,
};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{State, Webview};

const MAX_DELETION_SOURCES: usize = 1_024;
const MAX_ACTIVE_DELETION_JOBS: usize = 2;
const MAX_DELETION_JOB_RECORDS: usize = 64;
const DELETION_JOB_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_UNDO_RECORDS: usize = 32;
const UNDO_RECORD_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeDeletionOperationType {
    Trash,
    PermanentDelete,
    Restore,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeDeletionCancellationMode {
    RecoverableBetweenItems,
    StopRemainingOnly,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDeletionSuccess {
    pub source_path: String,
    pub destination_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDeletionFailure {
    pub source_path: String,
    pub error: NativeFilesystemError,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDeletionOperationSnapshot {
    pub id: String,
    pub operation: NativeDeletionOperationType,
    pub state: NativeFileOperationStatus,
    pub sources: Vec<String>,
    pub current_item: Option<String>,
    pub files_completed: u64,
    pub files_total: u64,
    pub successes: Vec<NativeDeletionSuccess>,
    pub failures: Vec<NativeDeletionFailure>,
    pub undo_id: Option<String>,
    pub reversible: bool,
    pub cancellation_mode: NativeDeletionCancellationMode,
}

struct NativeDeletionJob {
    snapshot: Mutex<NativeDeletionOperationSnapshot>,
    cancelled: AtomicBool,
    finished_at: Mutex<Option<Instant>>,
}

#[derive(Debug, Clone)]
struct RecycledItem {
    original_path: PathBuf,
    opaque_shell_identity: String,
}

#[derive(Debug, Clone)]
struct RecycleUndoRecord {
    id: String,
    items: Vec<RecycledItem>,
    created_at: Instant,
}

#[derive(Clone, Default)]
pub struct NativeRecycleBinState {
    jobs: Arc<Mutex<HashMap<String, Arc<NativeDeletionJob>>>>,
    undo: Arc<Mutex<VecDeque<RecycleUndoRecord>>>,
}

fn deletion_error(code: NativeFilesystemErrorCode, message: &'static str) -> NativeFilesystemError {
    NativeFilesystemError::new(code, message)
}

fn random_id() -> Result<String, NativeFilesystemError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| {
        deletion_error(
            NativeFilesystemErrorCode::IoError,
            "Windows could not initialize the filesystem operation.",
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn validate_operation_id(id: &str) -> Result<(), NativeFilesystemError> {
    if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(NativeFilesystemError::invalid_path());
    }
    Ok(())
}

fn path_has_no_normal_component(path: &Path) -> bool {
    !path
        .components()
        .any(|component| matches!(component, Component::Normal(_)))
}

fn validate_destructive_shape(raw: &str) -> Result<PathBuf, NativeFilesystemError> {
    let submitted = validate_path(raw)?;
    if submitted
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(NativeFilesystemError::invalid_path());
    }
    if submitted.parent().is_none() || path_has_no_normal_component(&submitted) {
        return Err(deletion_error(
            NativeFilesystemErrorCode::RootOperationForbidden,
            "Filesystem roots cannot be deleted.",
        ));
    }
    Ok(submitted)
}

fn validate_destructive_path(raw: &str) -> Result<PathBuf, NativeFilesystemError> {
    let submitted = validate_destructive_shape(raw)?;
    fs::symlink_metadata(&submitted).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The selected item could not be inspected.")
    })?;
    Ok(submitted)
}

fn parent_and_name(path: &Path) -> Result<(PathBuf, String), NativeFilesystemError> {
    let parent = path
        .parent()
        .filter(|parent| parent.is_absolute())
        .ok_or_else(|| {
            deletion_error(
                NativeFilesystemErrorCode::RootOperationForbidden,
                "Filesystem roots cannot be deleted.",
            )
        })?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(NativeFilesystemError::invalid_path)?;
    Ok((parent.to_path_buf(), name.to_string()))
}

fn normalize_sources(sources: Vec<String>) -> Result<Vec<String>, NativeFilesystemError> {
    if sources.is_empty() || sources.len() > MAX_DELETION_SOURCES {
        return Err(NativeFilesystemError::invalid_path());
    }
    let mut result: Vec<String> = Vec::with_capacity(sources.len());
    for source in sources {
        let path = validate_destructive_shape(&source)?;
        let normalized = path_string(&path);
        if !result
            .iter()
            .any(|existing| paths_equal(existing, &normalized))
        {
            result.push(normalized);
        }
    }
    Ok(result)
}

fn paths_equal(left: &str, right: &str) -> bool {
    #[cfg(windows)]
    {
        left.eq_ignore_ascii_case(right)
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn delete_permanently(path: &Path) -> Result<(), NativeFilesystemError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The selected item could not be inspected.")
    })?;
    if metadata.permissions().readonly() {
        return Err(deletion_error(
            NativeFilesystemErrorCode::ReadOnly,
            "The selected item is read-only.",
        ));
    }

    #[cfg(windows)]
    let reparse = {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    };
    #[cfg(not(windows))]
    let reparse = metadata.file_type().is_symlink();

    let result = if reparse {
        if metadata.is_dir() {
            fs::remove_dir(path)
        } else {
            fs::remove_file(path)
        }
    } else if metadata.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|error| {
        NativeFilesystemError::from_io(&error, "Windows could not permanently delete the item.")
    })
}

fn terminal(state: NativeFileOperationStatus) -> bool {
    matches!(
        state,
        NativeFileOperationStatus::Completed
            | NativeFileOperationStatus::Failed
            | NativeFileOperationStatus::Cancelled
    )
}

fn finish_job(job: &NativeDeletionJob) {
    let mut snapshot = job.snapshot.lock().unwrap();
    if snapshot.state == NativeFileOperationStatus::Running {
        snapshot.state = if job.cancelled.load(Ordering::Acquire) {
            NativeFileOperationStatus::Cancelled
        } else if snapshot.failures.is_empty() {
            NativeFileOperationStatus::Completed
        } else {
            NativeFileOperationStatus::Failed
        };
    }
    snapshot.current_item = None;
    *job.finished_at.lock().unwrap() = Some(Instant::now());
}

fn fail_item(job: &NativeDeletionJob, source: &str, error: NativeFilesystemError) {
    let mut snapshot = job.snapshot.lock().unwrap();
    snapshot.files_completed += 1;
    snapshot.failures.push(NativeDeletionFailure {
        source_path: source.to_string(),
        error,
    });
}

fn succeed_item(job: &NativeDeletionJob, source: &str, destination: Option<String>) {
    let mut snapshot = job.snapshot.lock().unwrap();
    snapshot.files_completed += 1;
    snapshot.successes.push(NativeDeletionSuccess {
        source_path: source.to_string(),
        destination_path: destination,
    });
}

#[cfg(windows)]
mod windows_shell {
    use super::*;
    use windows::{
        core::{implement, Error as WindowsError, Ref, HRESULT, HSTRING, PCWSTR},
        Win32::{
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                FileOperation, IFileOperation, IFileOperationProgressSink,
                IFileOperationProgressSink_Impl, IShellItem, SHCreateItemFromParsingName,
                SHQueryRecycleBinW, FILEOPERATION_FLAGS, FOFX_ADDUNDORECORD, FOFX_EARLYFAILURE,
                FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI,
                FOF_NORECURSEREPARSE, FOF_SILENT, FOF_WANTNUKEWARNING, SHQUERYRBINFO,
                SIGDN_DESKTOPABSOLUTEPARSING,
            },
        },
    };

    struct ComApartment;

    impl ComApartment {
        fn initialize() -> Result<Self, NativeFilesystemError> {
            let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if result.is_err() {
                return Err(shell_error(
                    &WindowsError::from_hresult(result),
                    "Windows Shell could not initialize the Recycle Bin operation.",
                ));
            }
            Ok(Self)
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    fn shell_error(error: &WindowsError, fallback: &'static str) -> NativeFilesystemError {
        let win32 = error.code().0 as u32 & 0xffff;
        let code = match win32 {
            2 | 3 => NativeFilesystemErrorCode::NotFound,
            5 => NativeFilesystemErrorCode::AccessDenied,
            19 => NativeFilesystemErrorCode::ReadOnly,
            21 | 53 | 67 | 1005 | 1167 => NativeFilesystemErrorCode::DriveUnavailable,
            32 | 33 => NativeFilesystemErrorCode::FileInUse,
            1223 => NativeFilesystemErrorCode::OperationCancelled,
            _ => NativeFilesystemErrorCode::IoError,
        };
        NativeFilesystemError::new(code, fallback)
    }

    fn shell_item(path: &str) -> Result<IShellItem, NativeFilesystemError> {
        let shell_path = path
            .strip_prefix(r"\\?\UNC\")
            .map(|path| format!(r"\\{path}"))
            .or_else(|| path.strip_prefix(r"\\?\").map(str::to_string))
            .unwrap_or_else(|| path.to_string());
        let path = HSTRING::from(shell_path);
        unsafe { SHCreateItemFromParsingName(&path, None) }.map_err(|error| {
            shell_error(
                &error,
                "Windows Shell could not identify the selected filesystem item.",
            )
        })
    }

    fn opaque_shell_identity(item: &IShellItem) -> Result<String, NativeFilesystemError> {
        let value =
            unsafe { item.GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING) }.map_err(|error| {
                shell_error(
                    &error,
                    "Windows did not provide a recoverable Recycle Bin identity.",
                )
            })?;
        let text = unsafe { value.to_string() }.map_err(|_| {
            deletion_error(
                NativeFilesystemErrorCode::RecycleUnsupported,
                "Windows did not provide a recoverable Recycle Bin identity.",
            )
        });
        unsafe { CoTaskMemFree(Some(value.0.cast())) };
        text
    }

    fn volume_root(path: &Path) -> Result<PathBuf, NativeFilesystemError> {
        let mut root = PathBuf::new();
        for component in path.components() {
            match component {
                Component::Prefix(_) | Component::RootDir => root.push(component.as_os_str()),
                Component::CurDir => continue,
                Component::ParentDir | Component::Normal(_) => break,
            }
        }
        if root.is_absolute() && path_has_no_normal_component(&root) {
            Ok(root)
        } else {
            Err(NativeFilesystemError::invalid_path())
        }
    }

    fn require_recycle_support(path: &Path) -> Result<(), NativeFilesystemError> {
        let root = volume_root(path)?;
        let root = HSTRING::from(path_string(&root));
        let mut info = SHQUERYRBINFO {
            cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
            ..Default::default()
        };
        unsafe { SHQueryRecycleBinW(&root, &mut info) }.map_err(|_| {
            deletion_error(
                NativeFilesystemErrorCode::RecycleUnsupported,
                "This location does not support the Windows Recycle Bin.",
            )
        })
    }

    fn require_delete_access(path: &Path) -> Result<(), NativeFilesystemError> {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        };

        let mut options = fs::OpenOptions::new();
        options
            .access_mode(0x0001_0000)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
        if path.is_dir() {
            options.custom_flags(FILE_FLAG_BACKUP_SEMANTICS);
        }
        options.open(path).map(|_| ()).map_err(|error| {
            NativeFilesystemError::from_io(
                &error,
                "Windows did not allow the item to be moved to Recycle Bin.",
            )
        })
    }

    #[derive(Clone)]
    struct DeleteCapture {
        result: Arc<Mutex<Option<Result<String, NativeFilesystemError>>>>,
    }

    impl DeleteCapture {
        fn new() -> Self {
            Self {
                result: Arc::new(Mutex::new(None)),
            }
        }
    }

    #[implement(IFileOperationProgressSink)]
    struct RecycleProgressSink {
        capture: DeleteCapture,
    }

    #[allow(non_snake_case)]
    impl IFileOperationProgressSink_Impl for RecycleProgressSink_Impl {
        fn StartOperations(&self) -> windows::core::Result<()> {
            Ok(())
        }

        fn FinishOperations(&self, _result: HRESULT) -> windows::core::Result<()> {
            Ok(())
        }

        fn PreRenameItem(
            &self,
            _flags: u32,
            _item: Ref<'_, IShellItem>,
            _new_name: &PCWSTR,
        ) -> windows::core::Result<()> {
            Ok(())
        }

        fn PostRenameItem(
            &self,
            _flags: u32,
            _item: Ref<'_, IShellItem>,
            _new_name: &PCWSTR,
            _result: HRESULT,
            _new_item: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            Ok(())
        }

        fn PreMoveItem(
            &self,
            _flags: u32,
            _item: Ref<'_, IShellItem>,
            _destination: Ref<'_, IShellItem>,
            _new_name: &PCWSTR,
        ) -> windows::core::Result<()> {
            Ok(())
        }

        fn PostMoveItem(
            &self,
            _flags: u32,
            _item: Ref<'_, IShellItem>,
            _destination: Ref<'_, IShellItem>,
            _new_name: &PCWSTR,
            _result: HRESULT,
            _new_item: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            Ok(())
        }

        fn PreCopyItem(
            &self,
            _flags: u32,
            _item: Ref<'_, IShellItem>,
            _destination: Ref<'_, IShellItem>,
            _new_name: &PCWSTR,
        ) -> windows::core::Result<()> {
            Ok(())
        }

        fn PostCopyItem(
            &self,
            _flags: u32,
            _item: Ref<'_, IShellItem>,
            _destination: Ref<'_, IShellItem>,
            _new_name: &PCWSTR,
            _result: HRESULT,
            _new_item: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            Ok(())
        }

        fn PreDeleteItem(
            &self,
            _flags: u32,
            _item: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            Ok(())
        }

        fn PostDeleteItem(
            &self,
            _flags: u32,
            _item: Ref<'_, IShellItem>,
            result: HRESULT,
            newly_created: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            let captured = if result.is_err() {
                Err(shell_error(
                    &WindowsError::from_hresult(result),
                    "Windows could not move the item to the Recycle Bin.",
                ))
            } else if let Some(item) = newly_created.as_ref() {
                opaque_shell_identity(item)
            } else {
                Err(deletion_error(
                    NativeFilesystemErrorCode::RecycleUnsupported,
                    "Windows did not create a recoverable Recycle Bin item.",
                ))
            };
            *self.capture.result.lock().unwrap() = Some(captured);
            Ok(())
        }

        fn PreNewItem(
            &self,
            _flags: u32,
            _destination: Ref<'_, IShellItem>,
            _new_name: &PCWSTR,
        ) -> windows::core::Result<()> {
            Ok(())
        }

        fn PostNewItem(
            &self,
            _flags: u32,
            _destination: Ref<'_, IShellItem>,
            _new_name: &PCWSTR,
            _template_name: &PCWSTR,
            _attributes: u32,
            _result: HRESULT,
            _new_item: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            Ok(())
        }

        fn UpdateProgress(&self, _total: u32, _completed: u32) -> windows::core::Result<()> {
            Ok(())
        }

        fn ResetTimer(&self) -> windows::core::Result<()> {
            Ok(())
        }

        fn PauseTimer(&self) -> windows::core::Result<()> {
            Ok(())
        }

        fn ResumeTimer(&self) -> windows::core::Result<()> {
            Ok(())
        }
    }

    fn operation_flags(recycle: bool) -> FILEOPERATION_FLAGS {
        let mut flags = FOF_NOCONFIRMATION.0
            | FOF_NOERRORUI.0
            | FOF_SILENT.0
            | FOF_NORECURSEREPARSE.0
            | FOFX_EARLYFAILURE.0;
        if recycle {
            flags |= FOF_ALLOWUNDO.0
                | FOF_WANTNUKEWARNING.0
                | FOFX_RECYCLEONDELETE.0
                | FOFX_ADDUNDORECORD.0;
        }
        FILEOPERATION_FLAGS(flags)
    }

    pub(super) fn recycle_one(path: &Path) -> Result<String, NativeFilesystemError> {
        require_recycle_support(path)?;
        require_delete_access(path)?;
        let _apartment = ComApartment::initialize()?;
        let item = shell_item(&path_string(path))?;
        let operation: IFileOperation =
            unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER) }.map_err(
                |error| shell_error(&error, "Windows could not start the Recycle Bin operation."),
            )?;
        unsafe { operation.SetOperationFlags(operation_flags(true)) }.map_err(|error| {
            shell_error(
                &error,
                "Windows could not configure the Recycle Bin operation.",
            )
        })?;

        let capture = DeleteCapture::new();
        let sink: IFileOperationProgressSink = RecycleProgressSink {
            capture: capture.clone(),
        }
        .into();
        unsafe { operation.DeleteItem(&item, &sink) }.map_err(|error| {
            shell_error(&error, "Windows could not queue the Recycle Bin operation.")
        })?;
        unsafe { operation.PerformOperations() }.map_err(|error| {
            shell_error(
                &error,
                "Windows could not move the item to the Recycle Bin.",
            )
        })?;
        if unsafe { operation.GetAnyOperationsAborted() }
            .map_err(|error| shell_error(&error, "The Recycle Bin operation did not finish."))?
            .as_bool()
        {
            return Err(deletion_error(
                NativeFilesystemErrorCode::OperationCancelled,
                "The Recycle Bin operation was cancelled.",
            ));
        }
        let captured = capture.result.lock().unwrap().take().unwrap_or_else(|| {
            Err(deletion_error(
                NativeFilesystemErrorCode::RecycleUnsupported,
                "Windows did not return a recoverable Recycle Bin item.",
            ))
        });
        captured
    }

    pub(super) fn restore_one(item: &RecycledItem) -> Result<PathBuf, NativeFilesystemError> {
        if item.original_path.exists() {
            return Err(deletion_error(
                NativeFilesystemErrorCode::AlreadyExists,
                "An item now exists at the original location. Restore did not overwrite it.",
            ));
        }
        let (parent, name) = parent_and_name(&item.original_path)?;
        if !parent.is_dir() {
            return Err(deletion_error(
                NativeFilesystemErrorCode::InvalidDestination,
                "The original folder is no longer available.",
            ));
        }

        let _apartment = ComApartment::initialize()?;
        let recycled = shell_item(&item.opaque_shell_identity)?;
        let destination = shell_item(&path_string(&parent))?;
        let name = HSTRING::from(name);
        let operation: IFileOperation =
            unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER) }.map_err(
                |error| shell_error(&error, "Windows could not start the restore operation."),
            )?;
        unsafe { operation.SetOperationFlags(operation_flags(false)) }
            .map_err(|error| shell_error(&error, "Windows could not configure restore."))?;
        unsafe { operation.MoveItem(&recycled, &destination, &name, None) }
            .map_err(|error| shell_error(&error, "Windows could not queue restore."))?;
        unsafe { operation.PerformOperations() }
            .map_err(|error| shell_error(&error, "Windows could not restore the item."))?;
        if unsafe { operation.GetAnyOperationsAborted() }
            .map_err(|error| shell_error(&error, "The restore operation did not finish."))?
            .as_bool()
        {
            return Err(deletion_error(
                NativeFilesystemErrorCode::OperationCancelled,
                "The restore operation was cancelled.",
            ));
        }
        if !item.original_path.exists() {
            return Err(deletion_error(
                NativeFilesystemErrorCode::IoError,
                "Windows did not restore the item to its original location.",
            ));
        }
        Ok(item.original_path.clone())
    }
}

#[cfg(not(windows))]
mod windows_shell {
    use super::*;

    pub(super) fn recycle_one(_path: &Path) -> Result<String, NativeFilesystemError> {
        Err(deletion_error(
            NativeFilesystemErrorCode::RecycleUnsupported,
            "Recycle Bin operations are currently available on Windows only.",
        ))
    }

    pub(super) fn restore_one(_item: &RecycledItem) -> Result<PathBuf, NativeFilesystemError> {
        Err(deletion_error(
            NativeFilesystemErrorCode::RecycleUnsupported,
            "Recycle Bin restore is currently available on Windows only.",
        ))
    }
}

impl NativeRecycleBinState {
    fn prune(&self) {
        let now = Instant::now();
        let mut jobs = self.jobs.lock().unwrap();
        jobs.retain(|_, job| {
            let finished = *job.finished_at.lock().unwrap();
            finished.is_none_or(|finished| now.duration_since(finished) < DELETION_JOB_TTL)
        });
        if jobs.len() > MAX_DELETION_JOB_RECORDS {
            let mut terminal_jobs: Vec<_> = jobs
                .iter()
                .filter_map(|(id, job)| {
                    job.finished_at
                        .lock()
                        .unwrap()
                        .map(|finished| (id.clone(), finished))
                })
                .collect();
            terminal_jobs.sort_by_key(|(_, finished)| *finished);
            let excess = jobs.len() - MAX_DELETION_JOB_RECORDS;
            for (id, _) in terminal_jobs.into_iter().take(excess) {
                jobs.remove(&id);
            }
        }
        drop(jobs);

        let mut undo = self.undo.lock().unwrap();
        undo.retain(|record| now.duration_since(record.created_at) < UNDO_RECORD_TTL);
        while undo.len() > MAX_UNDO_RECORDS {
            undo.pop_front();
        }
    }

    fn create_job(
        &self,
        operation: NativeDeletionOperationType,
        sources: Vec<String>,
    ) -> Result<Arc<NativeDeletionJob>, NativeFilesystemError> {
        self.prune();
        let mut jobs = self.jobs.lock().unwrap();
        let active = jobs
            .values()
            .filter(|job| !terminal(job.snapshot.lock().unwrap().state))
            .count();
        if active >= MAX_ACTIVE_DELETION_JOBS {
            return Err(deletion_error(
                NativeFilesystemErrorCode::IoError,
                "Too many destructive filesystem operations are already running.",
            ));
        }
        let id = random_id()?;
        let cancellation_mode = if operation == NativeDeletionOperationType::PermanentDelete {
            NativeDeletionCancellationMode::StopRemainingOnly
        } else {
            NativeDeletionCancellationMode::RecoverableBetweenItems
        };
        let job = Arc::new(NativeDeletionJob {
            snapshot: Mutex::new(NativeDeletionOperationSnapshot {
                id: id.clone(),
                operation,
                state: NativeFileOperationStatus::Queued,
                files_total: sources.len() as u64,
                sources,
                current_item: None,
                files_completed: 0,
                successes: Vec::new(),
                failures: Vec::new(),
                undo_id: None,
                reversible: false,
                cancellation_mode,
            }),
            cancelled: AtomicBool::new(false),
            finished_at: Mutex::new(None),
        });
        jobs.insert(id, job.clone());
        Ok(job)
    }

    fn start_trash(
        &self,
        sources: Vec<String>,
    ) -> Result<NativeDeletionOperationSnapshot, NativeFilesystemError> {
        let sources = normalize_sources(sources)?;
        let job = self.create_job(NativeDeletionOperationType::Trash, sources.clone())?;
        let initial = job.snapshot.lock().unwrap().clone();
        let state = self.clone();
        thread::spawn(move || {
            job.snapshot.lock().unwrap().state = NativeFileOperationStatus::Running;
            let mut recycled = Vec::new();
            for source in sources {
                if job.cancelled.load(Ordering::Acquire) {
                    break;
                }
                job.snapshot.lock().unwrap().current_item = Some(source.clone());
                let path = match validate_destructive_path(&source) {
                    Ok(path) => path,
                    Err(error) => {
                        fail_item(&job, &source, error);
                        continue;
                    }
                };
                match windows_shell::recycle_one(&path) {
                    Ok(identity) => {
                        recycled.push(RecycledItem {
                            original_path: path,
                            opaque_shell_identity: identity,
                        });
                        succeed_item(&job, &source, None);
                    }
                    Err(error) => fail_item(&job, &source, error),
                }
            }
            if !recycled.is_empty() {
                if let Ok(undo_id) = random_id() {
                    state.undo.lock().unwrap().push_back(RecycleUndoRecord {
                        id: undo_id.clone(),
                        items: recycled,
                        created_at: Instant::now(),
                    });
                    let mut snapshot = job.snapshot.lock().unwrap();
                    snapshot.undo_id = Some(undo_id);
                    snapshot.reversible = true;
                }
            }
            finish_job(&job);
            state.prune();
        });
        Ok(initial)
    }

    fn start_permanent_delete(
        &self,
        sources: Vec<String>,
        confirmed: bool,
    ) -> Result<NativeDeletionOperationSnapshot, NativeFilesystemError> {
        if !confirmed {
            return Err(deletion_error(
                NativeFilesystemErrorCode::ConfirmationRequired,
                "Permanent deletion requires explicit confirmation.",
            ));
        }
        let sources = normalize_sources(sources)?;
        let job = self.create_job(
            NativeDeletionOperationType::PermanentDelete,
            sources.clone(),
        )?;
        let initial = job.snapshot.lock().unwrap().clone();
        let state = self.clone();
        thread::spawn(move || {
            job.snapshot.lock().unwrap().state = NativeFileOperationStatus::Running;
            for source in sources {
                if job.cancelled.load(Ordering::Acquire) {
                    break;
                }
                job.snapshot.lock().unwrap().current_item = Some(source.clone());
                let path = match validate_destructive_path(&source) {
                    Ok(path) => path,
                    Err(error) => {
                        fail_item(&job, &source, error);
                        continue;
                    }
                };
                match delete_permanently(&path) {
                    Ok(()) => succeed_item(&job, &source, None),
                    Err(error) => fail_item(&job, &source, error),
                }
            }
            finish_job(&job);
            state.prune();
        });
        Ok(initial)
    }

    fn start_restore(
        &self,
        undo_id: &str,
    ) -> Result<NativeDeletionOperationSnapshot, NativeFilesystemError> {
        validate_operation_id(undo_id)?;
        self.prune();
        let record = self
            .undo
            .lock()
            .unwrap()
            .iter()
            .find(|record| record.id == undo_id)
            .cloned()
            .ok_or_else(|| {
                deletion_error(
                    NativeFilesystemErrorCode::UndoUnavailable,
                    "This Recycle Bin operation is no longer available to undo.",
                )
            })?;
        let sources = record
            .items
            .iter()
            .map(|item| path_string(&item.original_path))
            .collect();
        let job = self.create_job(NativeDeletionOperationType::Restore, sources)?;
        let initial = job.snapshot.lock().unwrap().clone();
        let state = self.clone();
        thread::spawn(move || {
            job.snapshot.lock().unwrap().state = NativeFileOperationStatus::Running;
            let mut remaining = Vec::new();
            for item in record.items {
                let source = path_string(&item.original_path);
                if job.cancelled.load(Ordering::Acquire) {
                    remaining.push(item);
                    continue;
                }
                job.snapshot.lock().unwrap().current_item = Some(source.clone());
                match windows_shell::restore_one(&item) {
                    Ok(destination) => succeed_item(&job, &source, Some(path_string(&destination))),
                    Err(error) => {
                        fail_item(&job, &source, error);
                        remaining.push(item);
                    }
                }
            }
            let mut undo = state.undo.lock().unwrap();
            if let Some(position) = undo.iter().position(|entry| entry.id == record.id) {
                if remaining.is_empty() {
                    undo.remove(position);
                } else {
                    undo[position].items = remaining;
                    let mut snapshot = job.snapshot.lock().unwrap();
                    snapshot.undo_id = Some(record.id.clone());
                    snapshot.reversible = true;
                }
            }
            drop(undo);
            finish_job(&job);
            state.prune();
        });
        Ok(initial)
    }

    fn get(&self, id: &str) -> Result<NativeDeletionOperationSnapshot, NativeFilesystemError> {
        validate_operation_id(id)?;
        self.prune();
        self.jobs
            .lock()
            .unwrap()
            .get(id)
            .map(|job| job.snapshot.lock().unwrap().clone())
            .ok_or_else(|| {
                deletion_error(
                    NativeFilesystemErrorCode::NotFound,
                    "The filesystem operation is no longer available.",
                )
            })
    }

    fn cancel(&self, id: &str) -> Result<NativeDeletionOperationSnapshot, NativeFilesystemError> {
        validate_operation_id(id)?;
        self.prune();
        let job = self.jobs.lock().unwrap().get(id).cloned().ok_or_else(|| {
            deletion_error(
                NativeFilesystemErrorCode::NotFound,
                "The filesystem operation is no longer available.",
            )
        })?;
        if !terminal(job.snapshot.lock().unwrap().state) {
            job.cancelled.store(true, Ordering::Release);
        }
        let snapshot = job.snapshot.lock().unwrap().clone();
        Ok(snapshot)
    }
}

#[tauri::command]
pub fn start_native_trash(
    sources: Vec<String>,
    caller: Webview,
    state: State<'_, NativeRecycleBinState>,
) -> Result<NativeFilesystemResponse<NativeDeletionOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(
        state.start_trash(sources),
    ))
}

#[tauri::command]
pub fn start_native_permanent_delete(
    sources: Vec<String>,
    confirmed: bool,
    caller: Webview,
    state: State<'_, NativeRecycleBinState>,
) -> Result<NativeFilesystemResponse<NativeDeletionOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(
        state.start_permanent_delete(sources, confirmed),
    ))
}

#[tauri::command]
pub fn start_native_restore(
    undo_id: String,
    caller: Webview,
    state: State<'_, NativeRecycleBinState>,
) -> Result<NativeFilesystemResponse<NativeDeletionOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(
        state.start_restore(&undo_id),
    ))
}

#[tauri::command]
pub fn get_native_deletion_operation(
    id: String,
    caller: Webview,
    state: State<'_, NativeRecycleBinState>,
) -> Result<NativeFilesystemResponse<NativeDeletionOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.get(&id)))
}

#[tauri::command]
pub fn cancel_native_deletion_operation(
    id: String,
    caller: Webview,
    state: State<'_, NativeRecycleBinState>,
) -> Result<NativeFilesystemResponse<NativeDeletionOperationSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.cancel(&id)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("NammuFilesF2BTest-{nonce}"));
        fs::create_dir(&root).unwrap();
        root
    }

    fn wait_for(
        state: &NativeRecycleBinState,
        started: &NativeDeletionOperationSnapshot,
    ) -> NativeDeletionOperationSnapshot {
        for _ in 0..2_000 {
            let snapshot = state.get(&started.id).unwrap();
            if terminal(snapshot.state) {
                return snapshot;
            }
            thread::sleep(Duration::from_millis(5));
        }
        panic!("deletion operation did not complete");
    }

    #[test]
    fn rejects_empty_relative_and_filesystem_root_paths() {
        assert_eq!(
            normalize_sources(vec![]).unwrap_err().code,
            NativeFilesystemErrorCode::InvalidPath
        );
        assert_eq!(
            validate_destructive_path("relative.txt").unwrap_err().code,
            NativeFilesystemErrorCode::InvalidPath
        );
        #[cfg(windows)]
        {
            assert_eq!(
                validate_destructive_path("C:\\").unwrap_err().code,
                NativeFilesystemErrorCode::RootOperationForbidden
            );
            assert_eq!(
                validate_destructive_shape("C:\\Windows\\..")
                    .unwrap_err()
                    .code,
                NativeFilesystemErrorCode::InvalidPath
            );
            assert_eq!(
                validate_destructive_shape("C:\\.").unwrap_err().code,
                NativeFilesystemErrorCode::RootOperationForbidden
            );
        }
    }

    #[test]
    fn permanent_delete_requires_confirmation_and_handles_batches() {
        let root = fixture();
        let first = root.join("one.txt");
        let nested = root.join("Nested folder");
        fs::write(&first, b"one").unwrap();
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("two.txt"), b"two").unwrap();
        let state = NativeRecycleBinState::default();
        assert_eq!(
            state
                .start_permanent_delete(vec![path_string(&first)], false)
                .unwrap_err()
                .code,
            NativeFilesystemErrorCode::ConfirmationRequired
        );
        let started = state
            .start_permanent_delete(vec![path_string(&first), path_string(&nested)], true)
            .unwrap();
        let completed = wait_for(&state, &started);
        assert_eq!(completed.state, NativeFileOperationStatus::Completed);
        assert_eq!(completed.successes.len(), 2);
        assert!(!first.exists());
        assert!(!nested.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn permanent_delete_reports_partial_failure_without_hiding_success() {
        let root = fixture();
        let present = root.join("present.txt");
        let missing = root.join("missing.txt");
        fs::write(&present, b"present").unwrap();
        let state = NativeRecycleBinState::default();
        let started = state
            .start_permanent_delete(vec![path_string(&present), path_string(&missing)], true)
            .unwrap();
        let completed = wait_for(&state, &started);
        assert_eq!(completed.state, NativeFileOperationStatus::Failed);
        assert_eq!(completed.successes.len(), 1);
        assert_eq!(completed.failures.len(), 1);
        assert_eq!(
            completed.failures[0].error.code,
            NativeFilesystemErrorCode::NotFound
        );
        assert!(!present.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn recycle_and_restore_preserve_content_and_refuse_restore_collisions() {
        use sha2::{Digest, Sha256};

        let root = fixture();
        let source = root.join("Unicode Nammu file.txt");
        let payload = b"Nammu F2B recycle integrity";
        fs::write(&source, payload).unwrap();
        let expected = Sha256::digest(payload);
        let state = NativeRecycleBinState::default();
        let started = state.start_trash(vec![path_string(&source)]).unwrap();
        let trashed = wait_for(&state, &started);
        assert_eq!(
            trashed.state,
            NativeFileOperationStatus::Completed,
            "trash failures: {:?}",
            trashed.failures
        );
        assert!(!source.exists());
        let undo_id = trashed.undo_id.clone().expect("trash should be reversible");

        fs::write(&source, b"conflict").unwrap();
        let conflict = state.start_restore(&undo_id).unwrap();
        let conflict = wait_for(&state, &conflict);
        assert_eq!(
            conflict.failures[0].error.code,
            NativeFilesystemErrorCode::AlreadyExists
        );
        assert_eq!(fs::read(&source).unwrap(), b"conflict");
        fs::remove_file(&source).unwrap();

        let restored = state.start_restore(&undo_id).unwrap();
        let restored = wait_for(&state, &restored);
        assert_eq!(restored.state, NativeFileOperationStatus::Completed);
        assert_eq!(Sha256::digest(fs::read(&source).unwrap()), expected);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn recycles_and_restores_nested_unicode_space_and_long_paths() {
        let root = fixture();
        let folder = root.join("Folder with spaces");
        let mut deepest = folder.clone();
        fs::create_dir(&folder).unwrap();
        fs::create_dir(folder.join("Empty")).unwrap();
        for index in 0..12 {
            deepest = deepest.join(format!("segment-{index:02}-nammu-files"));
            fs::create_dir(&deepest).unwrap();
        }
        assert!(path_string(&deepest).encode_utf16().count() > 260);
        fs::write(deepest.join("Nammu unicode.txt"), b"long path content").unwrap();

        let state = NativeRecycleBinState::default();
        let started = state.start_trash(vec![path_string(&folder)]).unwrap();
        let trashed = wait_for(&state, &started);
        assert_eq!(trashed.state, NativeFileOperationStatus::Completed);
        assert!(!folder.exists());
        let restored = state
            .start_restore(trashed.undo_id.as_deref().unwrap())
            .unwrap();
        let restored = wait_for(&state, &restored);
        assert_eq!(restored.state, NativeFileOperationStatus::Completed);
        assert!(folder.join("Empty").is_dir());
        assert_eq!(
            fs::read(deepest.join("Nammu unicode.txt")).unwrap(),
            b"long path content"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn recycle_and_restore_performance_covers_one_hundred_files() {
        let root = fixture();
        let sources: Vec<_> = (0..100)
            .map(|index| {
                let path = root.join(format!("item-{index:03}.txt"));
                fs::write(&path, b"nammu").unwrap();
                path_string(&path)
            })
            .collect();
        let state = NativeRecycleBinState::default();
        let recycle_started = Instant::now();
        let started = state.start_trash(sources).unwrap();
        let trashed = wait_for(&state, &started);
        println!(
            "F2B 100-file recycle: {:.2} ms",
            recycle_started.elapsed().as_secs_f64() * 1_000.0
        );
        assert_eq!(trashed.state, NativeFileOperationStatus::Completed);
        assert_eq!(trashed.successes.len(), 100);

        let restore_started = Instant::now();
        let restored = state
            .start_restore(trashed.undo_id.as_deref().unwrap())
            .unwrap();
        let restored = wait_for(&state, &restored);
        println!(
            "F2B 100-file restore: {:.2} ms",
            restore_started.elapsed().as_secs_f64() * 1_000.0
        );
        assert_eq!(restored.state, NativeFileOperationStatus::Completed);
        assert_eq!(restored.successes.len(), 100);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn permanent_delete_generated_tree_is_explicit_and_bounded() {
        let root = fixture();
        let tree = root.join("generated-tree");
        fs::create_dir(&tree).unwrap();
        for index in 0..100 {
            fs::write(tree.join(format!("item-{index:03}.txt")), b"nammu").unwrap();
        }
        let state = NativeRecycleBinState::default();
        let delete_started = Instant::now();
        let started = state
            .start_permanent_delete(vec![path_string(&tree)], true)
            .unwrap();
        let deleted = wait_for(&state, &started);
        println!(
            "F2B generated-tree permanent delete: {:.2} ms",
            delete_started.elapsed().as_secs_f64() * 1_000.0
        );
        assert_eq!(deleted.state, NativeFileOperationStatus::Completed);
        assert!(!tree.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn locked_file_failure_is_structured_and_does_not_force_unlock() {
        use std::{fs::OpenOptions, os::windows::fs::OpenOptionsExt};

        let root = fixture();
        let source = root.join("locked.txt");
        fs::write(&source, b"locked").unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&source)
            .unwrap();
        let state = NativeRecycleBinState::default();
        let started = state.start_trash(vec![path_string(&source)]).unwrap();
        let completed = wait_for(&state, &started);
        assert_eq!(completed.state, NativeFileOperationStatus::Failed);
        assert!(
            matches!(
                completed.failures[0].error.code,
                NativeFilesystemErrorCode::FileInUse | NativeFilesystemErrorCode::AccessDenied
            ),
            "locked-file error: {:?}",
            completed.failures[0].error
        );
        assert!(source.exists());
        drop(lock);
        fs::remove_dir_all(root).unwrap();
    }
}
