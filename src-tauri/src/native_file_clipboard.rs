use crate::native_filesystem::{
    require_trusted_caller, validate_path, NativeFilesystemError, NativeFilesystemErrorCode,
    NativeFilesystemResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use tauri::Webview;

const MAX_CLIPBOARD_PATHS: usize = 10_000;
const MAX_CLIPBOARD_UTF16_BYTES: usize = 4 * 1024 * 1024;
const MAX_CLIPBOARD_PATH_UNITS: usize = 32_767;

static OPEN_CLIPBOARD_GUARDS: AtomicUsize = AtomicUsize::new(0);
static READS: AtomicU64 = AtomicU64::new(0);
static WRITES: AtomicU64 = AtomicU64::new(0);
static COMPLETIONS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileClipboardOperation {
    Copy,
    Move,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileClipboardSnapshot {
    pub available: bool,
    pub operation: Option<NativeFileClipboardOperation>,
    pub paths: Vec<String>,
    pub sequence: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileClipboardCompletion {
    pub reported: bool,
    pub sequence: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileClipboardDiagnostics {
    pub open_clipboard_guards: usize,
    pub reads: u64,
    pub writes: u64,
    pub completions: u64,
    pub max_paths: usize,
    pub max_utf16_bytes: usize,
}

fn error(code: NativeFilesystemErrorCode, message: &'static str) -> NativeFilesystemError {
    NativeFilesystemError::new(code, message)
}

#[cfg(not(windows))]
fn unsupported<T>() -> NativeFilesystemResponse<T> {
    NativeFilesystemResponse::from_result(Err(error(
        NativeFilesystemErrorCode::ClipboardUnavailable,
        "Native file clipboard integration is available only on Windows Desktop.",
    )))
}

pub(crate) fn validate_paths(
    paths: &[String],
    require_existing: bool,
) -> Result<Vec<String>, NativeFilesystemError> {
    if paths.is_empty() {
        return Err(error(
            NativeFilesystemErrorCode::InvalidClipboardData,
            "At least one native filesystem item is required.",
        ));
    }
    if paths.len() > MAX_CLIPBOARD_PATHS {
        return Err(error(
            NativeFilesystemErrorCode::ClipboardTooLarge,
            "The file selection contains too many clipboard items.",
        ));
    }
    let mut total_units = 1usize;
    let mut output = Vec::with_capacity(paths.len());
    let mut seen = std::collections::HashSet::new();
    for raw in paths {
        let path = validate_path(raw)?;
        let units = raw.encode_utf16().count();
        if units == 0 || units > MAX_CLIPBOARD_PATH_UNITS || raw.chars().any(char::is_control) {
            return Err(error(
                NativeFilesystemErrorCode::InvalidClipboardData,
                "A Windows file clipboard path is malformed.",
            ));
        }
        total_units = total_units.saturating_add(units.saturating_add(1));
        if total_units.saturating_mul(2) > MAX_CLIPBOARD_UTF16_BYTES {
            return Err(error(
                NativeFilesystemErrorCode::ClipboardTooLarge,
                "The file clipboard path payload exceeds the safety limit.",
            ));
        }
        if require_existing && !path.exists() {
            return Err(error(
                NativeFilesystemErrorCode::NotFound,
                "A selected clipboard item no longer exists.",
            ));
        }
        let key = raw.to_lowercase();
        if seen.insert(key) {
            output.push(raw.clone());
        }
    }
    Ok(output)
}

#[cfg(windows)]
pub(crate) mod windows_impl {
    use super::*;
    use std::{
        mem::{size_of, ManuallyDrop},
        ptr, slice, thread,
        time::Duration,
    };
    use windows::{
        core::{w, BOOL},
        Win32::{
            Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND, POINT},
            System::{
                Com::{DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL},
                DataExchange::{
                    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber,
                    IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
                    SetClipboardData,
                },
                Memory::{
                    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
                },
                Ole::{
                    OleGetClipboard, OleInitialize, OleUninitialize, DROPEFFECT_COPY,
                    DROPEFFECT_MOVE,
                },
            },
            UI::Shell::{DragQueryFileW, DROPFILES, HDROP},
        },
    };

    const CF_HDROP_ID: u32 = 15;
    const CLIPBOARD_RETRIES: usize = 8;

    struct ClipboardGuard;

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            let _ = unsafe { CloseClipboard() };
            OPEN_CLIPBOARD_GUARDS.fetch_sub(1, Ordering::AcqRel);
        }
    }

    struct OwnedGlobal(Option<HGLOBAL>);

    struct LockedGlobal {
        handle: HGLOBAL,
        pointer: *mut core::ffi::c_void,
    }

    impl LockedGlobal {
        fn new(handle: HGLOBAL) -> Result<Self, NativeFilesystemError> {
            let pointer = unsafe { GlobalLock(handle) };
            if pointer.is_null() {
                return Err(error(
                    NativeFilesystemErrorCode::InvalidClipboardData,
                    "Windows could not lock the clipboard payload.",
                ));
            }
            Ok(Self { handle, pointer })
        }
    }

    impl Drop for LockedGlobal {
        fn drop(&mut self) {
            let _ = unsafe { GlobalUnlock(self.handle) };
        }
    }

    impl OwnedGlobal {
        fn allocate(bytes: usize) -> Result<Self, NativeFilesystemError> {
            let handle =
                unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes) }.map_err(|_| {
                    error(
                        NativeFilesystemErrorCode::ClipboardUnavailable,
                        "Windows could not allocate the file clipboard payload.",
                    )
                })?;
            Ok(Self(Some(handle)))
        }

        fn handle(&self) -> HGLOBAL {
            self.0.expect("owned global memory must have a handle")
        }

        fn transfer(&mut self) {
            self.0 = None;
        }
    }

    impl Drop for OwnedGlobal {
        fn drop(&mut self) {
            if let Some(handle) = self.0.take() {
                let _ = unsafe { GlobalFree(Some(handle)) };
            }
        }
    }

    fn open_clipboard(owner: Option<HWND>) -> Result<ClipboardGuard, NativeFilesystemError> {
        for attempt in 0..CLIPBOARD_RETRIES {
            if unsafe { OpenClipboard(owner) }.is_ok() {
                OPEN_CLIPBOARD_GUARDS.fetch_add(1, Ordering::AcqRel);
                return Ok(ClipboardGuard);
            }
            if attempt + 1 < CLIPBOARD_RETRIES {
                thread::sleep(Duration::from_millis(5));
            }
        }
        Err(error(
            NativeFilesystemErrorCode::ClipboardBusy,
            "Another application is currently using the Windows clipboard.",
        ))
    }

    fn preferred_format() -> Result<u32, NativeFilesystemError> {
        let format = unsafe { RegisterClipboardFormatW(w!("Preferred DropEffect")) };
        if format == 0 {
            return Err(error(
                NativeFilesystemErrorCode::ClipboardUnavailable,
                "Windows could not register the Shell clipboard format.",
            ));
        }
        Ok(format)
    }

    fn performed_format() -> Result<u32, NativeFilesystemError> {
        let format = unsafe { RegisterClipboardFormatW(w!("Performed DropEffect")) };
        if format == 0 {
            return Err(error(
                NativeFilesystemErrorCode::ClipboardUnavailable,
                "Windows could not register the Shell completion format.",
            ));
        }
        Ok(format)
    }

    fn global_u32(value: u32) -> Result<OwnedGlobal, NativeFilesystemError> {
        let memory = OwnedGlobal::allocate(size_of::<u32>())?;
        let pointer = unsafe { GlobalLock(memory.handle()) };
        if pointer.is_null() {
            return Err(error(
                NativeFilesystemErrorCode::ClipboardUnavailable,
                "Windows could not lock the clipboard payload.",
            ));
        }
        unsafe {
            pointer.cast::<u32>().write_unaligned(value);
            let _ = GlobalUnlock(memory.handle());
        }
        Ok(memory)
    }

    fn drop_effect(operation: NativeFileClipboardOperation) -> u32 {
        match operation {
            NativeFileClipboardOperation::Copy => DROPEFFECT_COPY.0,
            NativeFileClipboardOperation::Move => DROPEFFECT_MOVE.0,
        }
    }

    fn operation_from_effect(effect: u32) -> NativeFileClipboardOperation {
        if effect & DROPEFFECT_MOVE.0 != 0 {
            NativeFileClipboardOperation::Move
        } else {
            NativeFileClipboardOperation::Copy
        }
    }

    pub(crate) fn encode_drop_payload(paths: &[String]) -> Result<Vec<u8>, NativeFilesystemError> {
        let mut names = Vec::<u16>::new();
        for path in paths {
            names.extend(path.encode_utf16());
            names.push(0);
        }
        names.push(0);
        let header_bytes = size_of::<DROPFILES>();
        let names_bytes = names.len().checked_mul(2).ok_or_else(|| {
            error(
                NativeFilesystemErrorCode::ClipboardTooLarge,
                "The file clipboard payload is too large.",
            )
        })?;
        let total = header_bytes.checked_add(names_bytes).ok_or_else(|| {
            error(
                NativeFilesystemErrorCode::ClipboardTooLarge,
                "The file clipboard payload is too large.",
            )
        })?;
        let mut payload = vec![0u8; total];
        unsafe {
            payload
                .as_mut_ptr()
                .cast::<DROPFILES>()
                .write_unaligned(DROPFILES {
                    pFiles: header_bytes as u32,
                    pt: POINT::default(),
                    fNC: BOOL(0),
                    fWide: BOOL(1),
                });
            ptr::copy_nonoverlapping(
                names.as_ptr().cast::<u8>(),
                payload.as_mut_ptr().add(header_bytes),
                names_bytes,
            );
        }
        Ok(payload)
    }

    fn build_drop_payload(paths: &[String]) -> Result<OwnedGlobal, NativeFilesystemError> {
        let payload = encode_drop_payload(paths)?;
        let memory = OwnedGlobal::allocate(payload.len())?;
        let locked = LockedGlobal::new(memory.handle())?;
        unsafe {
            ptr::copy_nonoverlapping(payload.as_ptr(), locked.pointer.cast::<u8>(), payload.len());
        }
        drop(locked);
        Ok(memory)
    }

    fn read_effect(format: u32) -> NativeFileClipboardOperation {
        let handle = match unsafe { GetClipboardData(format) } {
            Ok(value) => HGLOBAL(value.0),
            Err(_) => return NativeFileClipboardOperation::Copy,
        };
        if unsafe { GlobalSize(handle) } < size_of::<u32>() {
            return NativeFileClipboardOperation::Copy;
        }
        let memory = match LockedGlobal::new(handle) {
            Ok(value) => value,
            Err(_) => return NativeFileClipboardOperation::Copy,
        };
        let effect = unsafe { memory.pointer.cast::<u32>().read_unaligned() };
        operation_from_effect(effect)
    }

    pub(crate) fn parse_drop_payload(payload: &[u8]) -> Result<Vec<String>, NativeFilesystemError> {
        if payload.len() < size_of::<DROPFILES>() + 4 {
            return Err(error(
                NativeFilesystemErrorCode::InvalidClipboardData,
                "The Windows file clipboard header is truncated.",
            ));
        }
        if payload.len() > size_of::<DROPFILES>() + MAX_CLIPBOARD_UTF16_BYTES {
            return Err(error(
                NativeFilesystemErrorCode::ClipboardTooLarge,
                "The Windows file clipboard payload exceeds the safety limit.",
            ));
        }
        let header = unsafe { payload.as_ptr().cast::<DROPFILES>().read_unaligned() };
        if !header.fWide.as_bool() {
            return Err(error(
                NativeFilesystemErrorCode::ClipboardFormatUnsupported,
                "ANSI file clipboard payloads are not accepted.",
            ));
        }
        let offset = header.pFiles as usize;
        if offset < size_of::<DROPFILES>()
            || offset > payload.len().saturating_sub(4)
            || (payload.len() - offset) % 2 != 0
        {
            return Err(error(
                NativeFilesystemErrorCode::InvalidClipboardData,
                "The Windows file clipboard path offset is invalid.",
            ));
        }
        let units = payload[offset..]
            .chunks_exact(2)
            .map(|bytes| u16::from_ne_bytes([bytes[0], bytes[1]]))
            .collect::<Vec<_>>();
        if units.len() < 2 || units[units.len() - 2..] != [0, 0] {
            return Err(error(
                NativeFilesystemErrorCode::InvalidClipboardData,
                "The Windows file clipboard path list is not terminated.",
            ));
        }
        let mut paths = Vec::new();
        let mut start = 0usize;
        let mut terminated = false;
        for (index, unit) in units.iter().copied().enumerate() {
            if unit != 0 {
                continue;
            }
            if index == start {
                if units[index..].iter().any(|remaining| *remaining != 0) {
                    return Err(error(
                        NativeFilesystemErrorCode::InvalidClipboardData,
                        "The Windows file clipboard has data after its terminator.",
                    ));
                }
                terminated = true;
                break;
            }
            if paths.len() >= MAX_CLIPBOARD_PATHS {
                return Err(error(
                    NativeFilesystemErrorCode::ClipboardTooLarge,
                    "The Windows file clipboard contains too many items.",
                ));
            }
            let path = String::from_utf16(&units[start..index]).map_err(|_| {
                error(
                    NativeFilesystemErrorCode::InvalidClipboardData,
                    "The Windows file clipboard path is not valid UTF-16.",
                )
            })?;
            paths.push(path);
            start = index + 1;
        }
        if !terminated || paths.is_empty() {
            return Err(error(
                NativeFilesystemErrorCode::InvalidClipboardData,
                "The Windows file clipboard contains no terminated paths.",
            ));
        }
        validate_paths(&paths, false).map_err(|failure| {
            if failure.code == NativeFilesystemErrorCode::ClipboardTooLarge {
                failure
            } else {
                error(
                    NativeFilesystemErrorCode::InvalidClipboardData,
                    "The Windows file clipboard contains an invalid absolute path.",
                )
            }
        })
    }

    fn read_drop_paths(handle: HGLOBAL) -> Result<Vec<String>, NativeFilesystemError> {
        let allocation_bytes = unsafe { GlobalSize(handle) };
        if allocation_bytes > size_of::<DROPFILES>() + MAX_CLIPBOARD_UTF16_BYTES {
            return Err(error(
                NativeFilesystemErrorCode::ClipboardTooLarge,
                "The Windows file clipboard payload exceeds the safety limit.",
            ));
        }
        let memory = LockedGlobal::new(handle)?;
        let payload =
            unsafe { slice::from_raw_parts(memory.pointer.cast::<u8>(), allocation_bytes) };
        parse_drop_payload(payload)
    }

    pub(crate) fn payload_medium(payload: &[u8]) -> Result<STGMEDIUM, NativeFilesystemError> {
        let mut memory = OwnedGlobal::allocate(payload.len())?;
        let locked = LockedGlobal::new(memory.handle())?;
        unsafe {
            ptr::copy_nonoverlapping(payload.as_ptr(), locked.pointer.cast::<u8>(), payload.len());
        }
        drop(locked);
        let medium = STGMEDIUM {
            tymed: TYMED_HGLOBAL.0 as u32,
            u: STGMEDIUM_0 {
                hGlobal: memory.handle(),
            },
            pUnkForRelease: ManuallyDrop::new(None),
        };
        memory.transfer();
        Ok(medium)
    }

    pub(crate) fn effect_medium(effect: u32) -> Result<STGMEDIUM, NativeFilesystemError> {
        let mut memory = global_u32(effect)?;
        let medium = STGMEDIUM {
            tymed: TYMED_HGLOBAL.0 as u32,
            u: STGMEDIUM_0 {
                hGlobal: memory.handle(),
            },
            pUnkForRelease: ManuallyDrop::new(None),
        };
        memory.transfer();
        Ok(medium)
    }

    pub(crate) fn paths_from_data_object(
        object: &windows::Win32::System::Com::IDataObject,
    ) -> Result<Vec<String>, NativeFilesystemError> {
        let format = FORMATETC {
            cfFormat: CF_HDROP_ID as u16,
            ptd: ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };
        let mut medium = unsafe { object.GetData(&format) }.map_err(|_| {
            error(
                NativeFilesystemErrorCode::ClipboardFormatUnsupported,
                "The Windows drag does not contain native files.",
            )
        })?;
        let result = if medium.tymed == TYMED_HGLOBAL.0 as u32 {
            let drop = HDROP(unsafe { medium.u.hGlobal }.0 as _);
            let count = unsafe { DragQueryFileW(drop, u32::MAX, None) } as usize;
            if count == 0 {
                Err(error(
                    NativeFilesystemErrorCode::InvalidClipboardData,
                    "The Windows drag contains no native files.",
                ))
            } else if count > MAX_CLIPBOARD_PATHS {
                Err(error(
                    NativeFilesystemErrorCode::ClipboardTooLarge,
                    "The Windows drag contains too many items.",
                ))
            } else {
                let mut encoded_bytes = 2usize;
                let mut paths = Vec::with_capacity(count);
                for index in 0..count {
                    let length = unsafe { DragQueryFileW(drop, index as u32, None) } as usize;
                    encoded_bytes = encoded_bytes.saturating_add((length + 1).saturating_mul(2));
                    if length == 0 || encoded_bytes > MAX_CLIPBOARD_UTF16_BYTES {
                        paths.clear();
                        break;
                    }
                    let mut units = vec![0u16; length + 1];
                    let copied = unsafe { DragQueryFileW(drop, index as u32, Some(&mut units)) };
                    if copied as usize != length {
                        paths.clear();
                        break;
                    }
                    match String::from_utf16(&units[..length]) {
                        Ok(path) => paths.push(path),
                        Err(_) => {
                            paths.clear();
                            break;
                        }
                    }
                }
                if paths.len() != count {
                    Err(error(
                        NativeFilesystemErrorCode::InvalidClipboardData,
                        "The Windows drag contains invalid or oversized paths.",
                    ))
                } else {
                    validate_paths(&paths, false).map_err(|_| {
                        error(
                            NativeFilesystemErrorCode::InvalidClipboardData,
                            "The Windows drag contains an invalid absolute path.",
                        )
                    })
                }
            }
        } else {
            Err(error(
                NativeFilesystemErrorCode::ClipboardFormatUnsupported,
                "The Windows drag uses an unsupported storage medium.",
            ))
        };
        unsafe { windows::Win32::System::Ole::ReleaseStgMedium(&mut medium) };
        result
    }

    pub(super) fn read() -> Result<NativeFileClipboardSnapshot, NativeFilesystemError> {
        READS.fetch_add(1, Ordering::Relaxed);
        let _guard = open_clipboard(None)?;
        let sequence = unsafe { GetClipboardSequenceNumber() };
        if unsafe { IsClipboardFormatAvailable(CF_HDROP_ID) }.is_err() {
            return Ok(NativeFileClipboardSnapshot {
                available: false,
                operation: None,
                paths: Vec::new(),
                sequence,
            });
        }
        let handle = unsafe { GetClipboardData(CF_HDROP_ID) }.map_err(|_| {
            error(
                NativeFilesystemErrorCode::InvalidClipboardData,
                "The Windows file clipboard payload could not be opened.",
            )
        })?;
        let paths = read_drop_paths(HGLOBAL(handle.0))?;
        let operation = read_effect(preferred_format()?);
        Ok(NativeFileClipboardSnapshot {
            available: true,
            operation: Some(operation),
            paths,
            sequence,
        })
    }

    pub(super) fn write(
        owner: HWND,
        operation: NativeFileClipboardOperation,
        paths: Vec<String>,
    ) -> Result<NativeFileClipboardSnapshot, NativeFilesystemError> {
        // Publishing Shell metadata must not turn into synchronous filesystem I/O
        // (especially for large selections or transient network paths). Files owns
        // these trusted selections; the eventual recipient validates availability.
        let paths = validate_paths(&paths, false)?;
        let mut drop_memory = build_drop_payload(&paths)?;
        let format = preferred_format()?;
        let mut effect_memory = global_u32(drop_effect(operation))?;
        let guard = open_clipboard(Some(owner))?;
        unsafe { EmptyClipboard() }.map_err(|_| {
            error(
                NativeFilesystemErrorCode::ClipboardUnavailable,
                "Windows could not replace the current clipboard contents.",
            )
        })?;
        if unsafe { SetClipboardData(CF_HDROP_ID, Some(HANDLE(drop_memory.handle().0))) }.is_err() {
            let _ = unsafe { EmptyClipboard() };
            return Err(error(
                NativeFilesystemErrorCode::ClipboardUnavailable,
                "Windows rejected the file clipboard payload.",
            ));
        }
        drop_memory.transfer();
        if unsafe { SetClipboardData(format, Some(HANDLE(effect_memory.handle().0))) }.is_err() {
            let _ = unsafe { EmptyClipboard() };
            return Err(error(
                NativeFilesystemErrorCode::ClipboardUnavailable,
                "Windows rejected the preferred file operation.",
            ));
        }
        effect_memory.transfer();
        drop(guard);
        WRITES.fetch_add(1, Ordering::Relaxed);
        Ok(NativeFileClipboardSnapshot {
            available: true,
            operation: Some(operation),
            paths,
            sequence: unsafe { GetClipboardSequenceNumber() },
        })
    }

    pub(super) fn complete(
        expected_sequence: u32,
        operation: NativeFileClipboardOperation,
    ) -> Result<NativeFileClipboardCompletion, NativeFilesystemError> {
        let current = unsafe { GetClipboardSequenceNumber() };
        if current != expected_sequence {
            return Ok(NativeFileClipboardCompletion {
                reported: false,
                sequence: current,
            });
        }
        let reported = thread::spawn(move || -> Result<bool, NativeFilesystemError> {
            unsafe { OleInitialize(None) }.map_err(|_| {
                error(
                    NativeFilesystemErrorCode::ClipboardUnavailable,
                    "Windows OLE clipboard integration could not be initialized.",
                )
            })?;
            let result = (|| {
                if unsafe { GetClipboardSequenceNumber() } != expected_sequence {
                    return Ok(false);
                }
                let data = unsafe { OleGetClipboard() }.map_err(|_| {
                    error(
                        NativeFilesystemErrorCode::ClipboardUnavailable,
                        "The Windows Shell clipboard object is unavailable.",
                    )
                })?;
                let format_id = performed_format()?;
                let mut memory = global_u32(drop_effect(operation))?;
                let format = FORMATETC {
                    cfFormat: format_id as u16,
                    ptd: ptr::null_mut(),
                    dwAspect: DVASPECT_CONTENT.0,
                    lindex: -1,
                    tymed: TYMED_HGLOBAL.0 as u32,
                };
                let medium = STGMEDIUM {
                    tymed: TYMED_HGLOBAL.0 as u32,
                    u: STGMEDIUM_0 {
                        hGlobal: memory.handle(),
                    },
                    pUnkForRelease: ManuallyDrop::new(None),
                };
                if unsafe { data.SetData(&format, &medium, true) }.is_err() {
                    // Static/raw CF_HDROP owners do not necessarily implement the
                    // IDataObject feedback contract. The move already completed, so
                    // conservatively leave their clipboard untouched and report that
                    // no Shell acknowledgement was published.
                    return Ok(false);
                }
                memory.transfer();
                Ok(true)
            })();
            unsafe { OleUninitialize() };
            result
        })
        .join()
        .map_err(|_| {
            error(
                NativeFilesystemErrorCode::ClipboardUnavailable,
                "The Windows Shell clipboard worker stopped unexpectedly.",
            )
        })??;
        if reported {
            COMPLETIONS.fetch_add(1, Ordering::Relaxed);
        }
        Ok(NativeFileClipboardCompletion {
            reported,
            sequence: unsafe { GetClipboardSequenceNumber() },
        })
    }
}

#[tauri::command]
pub fn read_native_file_clipboard(
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileClipboardSnapshot>, String> {
    require_trusted_caller(&caller)?;
    #[cfg(windows)]
    {
        Ok(NativeFilesystemResponse::from_result(windows_impl::read()))
    }
    #[cfg(not(windows))]
    {
        Ok(unsupported())
    }
}

#[tauri::command]
pub fn write_native_file_clipboard(
    operation: NativeFileClipboardOperation,
    paths: Vec<String>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileClipboardSnapshot>, String> {
    require_trusted_caller(&caller)?;
    #[cfg(windows)]
    {
        let owner = caller
            .window()
            .hwnd()
            .map_err(|_| "The trusted Nammu window handle is unavailable.".to_string())?;
        let owner = windows::Win32::Foundation::HWND(owner.0);
        Ok(NativeFilesystemResponse::from_result(windows_impl::write(
            owner, operation, paths,
        )))
    }
    #[cfg(not(windows))]
    {
        let _ = (operation, paths);
        Ok(unsupported())
    }
}

#[tauri::command]
pub fn complete_native_file_clipboard(
    sequence: u32,
    operation: NativeFileClipboardOperation,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileClipboardCompletion>, String> {
    require_trusted_caller(&caller)?;
    #[cfg(windows)]
    {
        Ok(NativeFilesystemResponse::from_result(
            windows_impl::complete(sequence, operation),
        ))
    }
    #[cfg(not(windows))]
    {
        let _ = (sequence, operation);
        Ok(unsupported())
    }
}

#[tauri::command]
pub fn get_native_file_clipboard_diagnostics(
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFileClipboardDiagnostics>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(Ok(
        NativeFileClipboardDiagnostics {
            open_clipboard_guards: OPEN_CLIPBOARD_GUARDS.load(Ordering::Acquire),
            reads: READS.load(Ordering::Relaxed),
            writes: WRITES.load(Ordering::Relaxed),
            completions: COMPLETIONS.load(Ordering::Relaxed),
            max_paths: MAX_CLIPBOARD_PATHS,
            max_utf16_bytes: MAX_CLIPBOARD_UTF16_BYTES,
        },
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_unicode_spaces_unc_and_long_absolute_paths_without_probing() {
        let long = format!("C:\\\\{}\\file.txt", "segment\\".repeat(1_000));
        let paths = validate_paths(
            &[
                "C:\\Users\\Name\\hello world 😀.txt".to_string(),
                "\\\\server\\share\\資料.txt".to_string(),
                long,
            ],
            false,
        )
        .unwrap();
        assert_eq!(paths.len(), 3);
    }

    #[test]
    fn rejects_relative_control_empty_and_oversized_payloads() {
        for value in ["", "relative.txt", "C:\\bad\nname.txt"] {
            assert!(validate_paths(&[value.to_string()], false).is_err());
        }
        let paths = (0..=MAX_CLIPBOARD_PATHS)
            .map(|index| format!("C:\\fixture\\{index}.txt"))
            .collect::<Vec<_>>();
        assert_eq!(
            validate_paths(&paths, false).unwrap_err().code,
            NativeFilesystemErrorCode::ClipboardTooLarge
        );
    }

    #[test]
    fn deduplicates_paths_case_insensitively_without_changing_spelling() {
        let paths = validate_paths(
            &[
                "C:\\Users\\Name\\File.txt".to_string(),
                "c:\\users\\name\\file.txt".to_string(),
            ],
            false,
        )
        .unwrap();
        assert_eq!(paths, vec!["C:\\Users\\Name\\File.txt"]);
    }

    #[cfg(windows)]
    #[test]
    fn encodes_wide_dropfiles_with_an_extra_final_nul() {
        use std::mem::size_of;
        use windows::Win32::UI::Shell::DROPFILES;

        let payload = windows_impl::encode_drop_payload(&[
            "C:\\one file.txt".to_string(),
            "\\\\server\\share\\資料.txt".to_string(),
        ])
        .unwrap();
        let header = unsafe { payload.as_ptr().cast::<DROPFILES>().read_unaligned() };
        assert_eq!(header.pFiles as usize, size_of::<DROPFILES>());
        assert!(header.fWide.as_bool());
        assert_eq!(&payload[payload.len() - 4..], &[0, 0, 0, 0]);
        assert_eq!(
            windows_impl::parse_drop_payload(&payload).unwrap(),
            vec!["C:\\one file.txt", "\\\\server\\share\\資料.txt"]
        );
    }

    #[cfg(windows)]
    #[test]
    fn rejects_malformed_dropfiles_without_unbounded_allocation() {
        use std::mem::size_of;
        use windows::{core::BOOL, Win32::UI::Shell::DROPFILES};

        let valid = windows_impl::encode_drop_payload(&["C:\\one.txt".to_string()]).unwrap();

        let mut offset = valid.clone();
        unsafe {
            let mut header = offset.as_ptr().cast::<DROPFILES>().read_unaligned();
            header.pFiles = 1;
            offset
                .as_mut_ptr()
                .cast::<DROPFILES>()
                .write_unaligned(header);
        }
        assert_eq!(
            windows_impl::parse_drop_payload(&offset).unwrap_err().code,
            NativeFilesystemErrorCode::InvalidClipboardData
        );

        let mut ansi = valid.clone();
        unsafe {
            let mut header = ansi.as_ptr().cast::<DROPFILES>().read_unaligned();
            header.fWide = BOOL(0);
            ansi.as_mut_ptr()
                .cast::<DROPFILES>()
                .write_unaligned(header);
        }
        assert_eq!(
            windows_impl::parse_drop_payload(&ansi).unwrap_err().code,
            NativeFilesystemErrorCode::ClipboardFormatUnsupported
        );

        let mut unterminated = valid.clone();
        *unterminated.last_mut().unwrap() = 1;
        assert_eq!(
            windows_impl::parse_drop_payload(&unterminated)
                .unwrap_err()
                .code,
            NativeFilesystemErrorCode::InvalidClipboardData
        );

        let mut empty = vec![0u8; size_of::<DROPFILES>() + 4];
        unsafe {
            empty
                .as_mut_ptr()
                .cast::<DROPFILES>()
                .write_unaligned(DROPFILES {
                    pFiles: size_of::<DROPFILES>() as u32,
                    ..Default::default()
                });
            let mut header = empty.as_ptr().cast::<DROPFILES>().read_unaligned();
            header.fWide = BOOL(1);
            empty
                .as_mut_ptr()
                .cast::<DROPFILES>()
                .write_unaligned(header);
        }
        assert_eq!(
            windows_impl::parse_drop_payload(&empty).unwrap_err().code,
            NativeFilesystemErrorCode::InvalidClipboardData
        );

        let oversized = vec![0u8; size_of::<DROPFILES>() + MAX_CLIPBOARD_UTF16_BYTES + 1];
        assert_eq!(
            windows_impl::parse_drop_payload(&oversized)
                .unwrap_err()
                .code,
            NativeFilesystemErrorCode::ClipboardTooLarge
        );
    }
}
