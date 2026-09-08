use crate::{
    native_file_clipboard::{validate_paths, NativeFileClipboardOperation},
    native_filesystem::{
        require_trusted_caller, NativeFilesystemError, NativeFilesystemErrorCode,
        NativeFilesystemResponse,
    },
};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Manager, Webview};

pub(crate) const NATIVE_FILE_DRAG_EVENT: &str = "nammu://native-file-drag-drop";
const TRUSTED_WEBVIEW_LABEL: &str = "main";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileDragOperation {
    Auto,
    Copy,
    Move,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileDragModifiers {
    pub control: bool,
    pub shift: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileDragPhase {
    Enter,
    Over,
    Drop,
    Leave,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileDragEvent {
    pub phase: NativeFileDragPhase,
    pub session: u64,
    pub paths: Vec<String>,
    pub x: f64,
    pub y: f64,
    pub modifiers: NativeFileDragModifiers,
    pub operation: Option<NativeFileClipboardOperation>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileDragResult {
    pub dropped: bool,
    pub operation: Option<NativeFileClipboardOperation>,
    pub item_count: usize,
    pub prepare_duration_ms: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileDragDiagnostics {
    pub registered_targets: usize,
    pub active_inbound_sessions: usize,
    pub active_outbound_sessions: usize,
    pub inbound_enters: u64,
    pub inbound_drops: u64,
    pub inbound_leaves: u64,
    pub outbound_started: u64,
    pub outbound_dropped: u64,
    pub outbound_cancelled: u64,
    pub max_paths: usize,
    pub max_utf16_bytes: usize,
}

#[derive(Default)]
struct DragCounters {
    registered_targets: AtomicUsize,
    active_inbound_sessions: AtomicUsize,
    active_outbound_sessions: AtomicUsize,
    inbound_enters: AtomicU64,
    inbound_drops: AtomicU64,
    inbound_leaves: AtomicU64,
    outbound_started: AtomicU64,
    outbound_dropped: AtomicU64,
    outbound_cancelled: AtomicU64,
}

pub struct NativeFileDragDropState {
    counters: Arc<DragCounters>,
    next_session: AtomicU64,
    desired_session: Arc<AtomicU64>,
    desired_effect: Arc<AtomicU32>,
    subscriptions: AtomicUsize,
    #[cfg(windows)]
    registrations: Mutex<Vec<windows_impl::DropRegistration>>,
}

impl Default for NativeFileDragDropState {
    fn default() -> Self {
        Self {
            counters: Arc::new(DragCounters::default()),
            next_session: AtomicU64::new(1),
            desired_session: Arc::new(AtomicU64::new(0)),
            desired_effect: Arc::new(AtomicU32::new(0)),
            subscriptions: AtomicUsize::new(0),
            #[cfg(windows)]
            registrations: Mutex::new(Vec::new()),
        }
    }
}

impl NativeFileDragDropState {
    #[cfg(windows)]
    pub fn install(
        &self,
        app: AppHandle,
        parent: windows::Win32::Foundation::HWND,
    ) -> Result<(), String> {
        let mut current = self
            .registrations
            .lock()
            .map_err(|_| "The native file drop-target registry is unavailable.".to_string())?;
        let subscriptions = self.subscriptions.load(Ordering::Acquire);
        if subscriptions > 0 && !current.is_empty() {
            self.subscriptions
                .store(subscriptions.saturating_add(1), Ordering::Release);
            return Ok(());
        }
        let registrations = windows_impl::register_targets(
            app,
            parent,
            self.counters.clone(),
            self.next_session.fetch_add(1, Ordering::Relaxed),
            self.desired_session.clone(),
            self.desired_effect.clone(),
        )?;
        self.counters
            .registered_targets
            .store(registrations.len(), Ordering::Release);
        *current = registrations;
        self.subscriptions.store(1, Ordering::Release);
        Ok(())
    }

    #[cfg(windows)]
    pub fn release(&self) -> Result<(), String> {
        let mut current = self
            .registrations
            .lock()
            .map_err(|_| "The native file drop-target registry is unavailable.".to_string())?;
        let subscriptions = self.subscriptions.load(Ordering::Acquire);
        if subscriptions == 0 {
            return Ok(());
        }
        if subscriptions > 1 {
            self.subscriptions
                .store(subscriptions - 1, Ordering::Release);
            return Ok(());
        }
        self.subscriptions.store(0, Ordering::Release);
        current.clear();
        self.counters.registered_targets.store(0, Ordering::Release);
        Ok(())
    }

    #[cfg(not(windows))]
    pub fn release(&self) -> Result<(), String> {
        Ok(())
    }

    #[cfg(not(windows))]
    pub fn install(&self, _app: AppHandle, _parent: ()) -> Result<(), String> {
        Ok(())
    }

    pub fn set_effect(&self, session: u64, operation: Option<NativeFileClipboardOperation>) {
        self.desired_session.store(session, Ordering::Release);
        self.desired_effect.store(
            operation.map_or(3, |value| match value {
                NativeFileClipboardOperation::Copy => 1,
                NativeFileClipboardOperation::Move => 2,
            }),
            Ordering::Release,
        );
    }

    #[cfg(windows)]
    pub fn shutdown(&self) {
        self.subscriptions.store(0, Ordering::Release);
        if let Ok(mut registrations) = self.registrations.lock() {
            registrations.clear();
        }
        self.counters.registered_targets.store(0, Ordering::Release);
        self.counters
            .active_inbound_sessions
            .store(0, Ordering::Release);
    }

    #[cfg(not(windows))]
    pub fn shutdown(&self) {}

    fn diagnostics(&self) -> NativeFileDragDiagnostics {
        NativeFileDragDiagnostics {
            registered_targets: self.counters.registered_targets.load(Ordering::Acquire),
            active_inbound_sessions: self
                .counters
                .active_inbound_sessions
                .load(Ordering::Acquire),
            active_outbound_sessions: self
                .counters
                .active_outbound_sessions
                .load(Ordering::Acquire),
            inbound_enters: self.counters.inbound_enters.load(Ordering::Relaxed),
            inbound_drops: self.counters.inbound_drops.load(Ordering::Relaxed),
            inbound_leaves: self.counters.inbound_leaves.load(Ordering::Relaxed),
            outbound_started: self.counters.outbound_started.load(Ordering::Relaxed),
            outbound_dropped: self.counters.outbound_dropped.load(Ordering::Relaxed),
            outbound_cancelled: self.counters.outbound_cancelled.load(Ordering::Relaxed),
            max_paths: 10_000,
            max_utf16_bytes: 4 * 1024 * 1024,
        }
    }
}

#[cfg(not(windows))]
fn unsupported<T>() -> NativeFilesystemResponse<T> {
    NativeFilesystemResponse::from_result(Err(NativeFilesystemError::new(
        NativeFilesystemErrorCode::IoError,
        "Native file drag and drop is available only on Windows Desktop.",
    )))
}

#[tauri::command]
pub async fn refresh_native_file_drop_targets(
    caller: Webview,
) -> Result<NativeFilesystemResponse<bool>, String> {
    require_trusted_caller(&caller)?;
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;

        let runtime = caller.app_handle().clone();
        let window = caller
            .window()
            .hwnd()
            .map_err(|_| "The trusted Nammu window handle is unavailable.".to_string())?;
        let parent = window.0 as usize;
        let result = tauri::async_runtime::spawn_blocking(move || {
            runtime
                .try_state::<NativeFileDragDropState>()
                .ok_or_else(|| "The native file drop state is unavailable.".to_string())
                .and_then(|state| {
                    state.install(runtime.clone(), HWND(parent as *mut core::ffi::c_void))
                })
        })
        .await
        .map_err(|_| "The native file drop refresh task stopped unexpectedly.".to_string())?;
        return Ok(NativeFilesystemResponse::from_result(
            result.map(|_| true).map_err(|error| {
                NativeFilesystemError::new(
                    NativeFilesystemErrorCode::IoError,
                    format!("Native file drop is unavailable for this window: {error}"),
                )
            }),
        ));
    }
    #[cfg(not(windows))]
    {
        Ok(unsupported())
    }
}

#[tauri::command]
pub async fn release_native_file_drop_targets(
    caller: Webview,
    state: tauri::State<'_, NativeFileDragDropState>,
) -> Result<NativeFilesystemResponse<bool>, String> {
    require_trusted_caller(&caller)?;
    let result = state.release();
    Ok(NativeFilesystemResponse::from_result(
        result.map(|_| true).map_err(|error| {
            NativeFilesystemError::new(
                NativeFilesystemErrorCode::IoError,
                format!("Native file drop cleanup failed: {error}"),
            )
        }),
    ))
}

#[tauri::command]
pub async fn start_native_file_drag(
    operation: NativeFileDragOperation,
    paths: Vec<String>,
    caller: Webview,
    state: tauri::State<'_, NativeFileDragDropState>,
) -> Result<NativeFilesystemResponse<NativeFileDragResult>, String> {
    require_trusted_caller(&caller)?;
    #[cfg(windows)]
    {
        // Drag metadata preparation must not synchronously probe every file or
        // wake an unavailable UNC share. Files owns the trusted native
        // selection; the eventual drop target validates source availability.
        let paths = match validate_paths(&paths, false) {
            Ok(paths) => paths,
            Err(error) => return Ok(NativeFilesystemResponse::from_result(Err(error))),
        };
        let counters = state.counters.clone();
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        caller
            .run_on_main_thread(move || {
                let _ = sender.send(windows_impl::start_outbound_drag(
                    operation, paths, counters,
                ));
            })
            .map_err(|_| {
                "The native drag could not be scheduled on the Windows UI thread.".to_string()
            })?;
        let result = tauri::async_runtime::spawn_blocking(move || receiver.recv())
            .await
            .map_err(|_| "The native drag response task stopped unexpectedly.".to_string())?
            .map_err(|_| "The native drag stopped without returning a result.".to_string())?;
        Ok(NativeFilesystemResponse::from_result(result))
    }
    #[cfg(not(windows))]
    {
        let _ = (operation, paths, state);
        Ok(unsupported())
    }
}

#[tauri::command]
pub fn set_native_file_drop_effect(
    session: u64,
    operation: Option<NativeFileClipboardOperation>,
    caller: Webview,
    state: tauri::State<'_, NativeFileDragDropState>,
) -> Result<NativeFilesystemResponse<bool>, String> {
    require_trusted_caller(&caller)?;
    state.set_effect(session, operation);
    Ok(NativeFilesystemResponse::from_result(Ok(true)))
}

#[tauri::command]
pub fn get_native_file_drag_drop_diagnostics(
    caller: Webview,
    state: tauri::State<'_, NativeFileDragDropState>,
) -> Result<NativeFilesystemResponse<NativeFileDragDiagnostics>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(Ok(
        state.diagnostics()
    )))
}

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use crate::native_file_clipboard::windows_impl::{
        effect_medium, encode_drop_payload, paths_from_data_object, payload_medium,
    };
    use std::{
        cell::UnsafeCell,
        ptr,
        sync::{atomic::AtomicIsize, mpsc, OnceLock},
        thread,
        time::{Duration, Instant},
    };
    use windows::{
        core::{implement, w, Error as WindowsError, BOOL, HRESULT},
        Win32::{
            Foundation::{
                DRAGDROP_E_NOTREGISTERED, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP,
                DRAGDROP_S_USEDEFAULTCURSORS, DV_E_FORMATETC, E_INVALIDARG, E_NOTIMPL, HWND,
                LPARAM, LRESULT, OLE_E_ADVISENOTSUPPORTED, POINT, RECT, WPARAM,
            },
            Graphics::Gdi::{ClientToScreen, ScreenToClient},
            System::{
                Com::{
                    IAdviseSink, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA,
                    DVASPECT_CONTENT, FORMATETC, STGMEDIUM, TYMED_HGLOBAL,
                },
                DataExchange::RegisterClipboardFormatW,
                Memory::{GlobalLock, GlobalSize, GlobalUnlock},
                Ole::{
                    DoDragDrop, IDropSource, IDropSource_Impl, IDropTarget, IDropTarget_Impl,
                    OleInitialize, OleUninitialize, RegisterDragDrop, ReleaseStgMedium,
                    RevokeDragDrop, CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_MOVE,
                    DROPEFFECT_NONE,
                },
                SystemServices::{MK_CONTROL, MK_LBUTTON, MK_SHIFT, MODIFIERKEYS_FLAGS},
            },
            UI::{
                Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
                Shell::{
                    SHCreateStdEnumFmtEtc, CFSTR_LOGICALPERFORMEDDROPEFFECT,
                    CFSTR_PERFORMEDDROPEFFECT, CFSTR_PREFERREDDROPEFFECT,
                },
                WindowsAndMessaging::{
                    CallNextHookEx, CreateWindowExW, DefWindowProcW, DestroyWindow,
                    DispatchMessageW, GetAncestor, GetClientRect, GetMessageW, PostMessageW,
                    PostQuitMessage, RegisterClassW, SetTimer, SetWindowPos, SetWindowsHookExW,
                    TranslateMessage, UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, HTCLIENT,
                    HTTRANSPARENT, HWND_TOP, MSG, MSLLHOOKSTRUCT, SWP_NOACTIVATE, SWP_SHOWWINDOW,
                    WH_MOUSE_LL, WM_CLOSE, WM_DESTROY, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_NCHITTEST,
                    WM_TIMER, WNDCLASSW, WS_EX_TOOLWINDOW, WS_POPUP, WS_VISIBLE,
                },
            },
        },
    };

    fn failure(message: &'static str) -> NativeFilesystemError {
        NativeFilesystemError::new(NativeFilesystemErrorCode::IoError, message)
    }

    pub fn initialize_ole() -> Result<(), String> {
        unsafe { OleInitialize(None) }
            .map(|_| ())
            .map_err(|_| "Windows OLE drag and drop could not be initialized.".to_string())
    }

    pub fn uninitialize_ole() {
        unsafe { OleUninitialize() };
    }

    fn operation_from_effect(effect: DROPEFFECT) -> Option<NativeFileClipboardOperation> {
        if effect.0 & DROPEFFECT_MOVE.0 != 0 {
            Some(NativeFileClipboardOperation::Move)
        } else if effect.0 & DROPEFFECT_COPY.0 != 0 {
            Some(NativeFileClipboardOperation::Copy)
        } else {
            None
        }
    }

    fn modifiers(keys: MODIFIERKEYS_FLAGS) -> NativeFileDragModifiers {
        NativeFileDragModifiers {
            control: keys.0 & MK_CONTROL.0 != 0,
            shift: keys.0 & MK_SHIFT.0 != 0,
        }
    }

    fn choose_effect(
        allowed: DROPEFFECT,
        keys: MODIFIERKEYS_FLAGS,
        desired: DROPEFFECT,
    ) -> DROPEFFECT {
        if desired == DROPEFFECT_NONE {
            return DROPEFFECT_NONE;
        }
        let selected = if keys.0 & MK_CONTROL.0 != 0 {
            DROPEFFECT_COPY
        } else if keys.0 & MK_SHIFT.0 != 0 {
            DROPEFFECT_MOVE
        } else {
            desired
        };
        if selected.0 & allowed.0 != 0 {
            selected
        } else if allowed.0 & DROPEFFECT_COPY.0 != 0 {
            DROPEFFECT_COPY
        } else if allowed.0 & DROPEFFECT_MOVE.0 != 0 {
            DROPEFFECT_MOVE
        } else {
            DROPEFFECT_NONE
        }
    }

    fn clipboard_format(name: windows::core::PCWSTR) -> windows::core::Result<u16> {
        let id = unsafe { RegisterClipboardFormatW(name) };
        if id == 0 {
            Err(WindowsError::from_win32())
        } else {
            Ok(id as u16)
        }
    }

    #[implement(IDataObject)]
    struct FileDragDataObject {
        drop_payload: Vec<u8>,
        preferred: Option<u32>,
        performed: Arc<AtomicU32>,
    }

    impl FileDragDataObject {
        fn new(
            paths: Vec<String>,
            preferred: Option<DROPEFFECT>,
            performed: Arc<AtomicU32>,
        ) -> Result<Self, NativeFilesystemError> {
            Ok(Self {
                drop_payload: encode_drop_payload(&paths)?,
                preferred: preferred.map(|effect| effect.0),
                performed,
            })
        }

        fn formats(&self) -> windows::core::Result<Vec<FORMATETC>> {
            let mut formats = vec![FORMATETC {
                cfFormat: CF_HDROP.0,
                ptd: ptr::null_mut(),
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
            }];
            if self.preferred.is_some() {
                formats.push(FORMATETC {
                    cfFormat: clipboard_format(CFSTR_PREFERREDDROPEFFECT)?,
                    ptd: ptr::null_mut(),
                    dwAspect: DVASPECT_CONTENT.0,
                    lindex: -1,
                    tymed: TYMED_HGLOBAL.0 as u32,
                });
            }
            Ok(formats)
        }

        fn supports(format: &FORMATETC, expected: u16) -> bool {
            format.cfFormat == expected
                && format.dwAspect == DVASPECT_CONTENT.0
                && format.lindex == -1
                && format.tymed & TYMED_HGLOBAL.0 as u32 != 0
        }
    }

    impl IDataObject_Impl for FileDragDataObject_Impl {
        fn GetData(&self, format: *const FORMATETC) -> windows::core::Result<STGMEDIUM> {
            if format.is_null() {
                return Err(WindowsError::from_hresult(E_INVALIDARG));
            }
            let format = unsafe { &*format };
            if FileDragDataObject::supports(format, CF_HDROP.0) {
                return payload_medium(&self.drop_payload)
                    .map_err(|_| WindowsError::from_hresult(E_NOTIMPL));
            }
            let preferred = clipboard_format(CFSTR_PREFERREDDROPEFFECT)?;
            if FileDragDataObject::supports(format, preferred) && self.preferred.is_some() {
                return effect_medium(self.preferred.unwrap_or_default())
                    .map_err(|_| WindowsError::from_hresult(E_NOTIMPL));
            }
            Err(WindowsError::from_hresult(DV_E_FORMATETC))
        }

        fn GetDataHere(
            &self,
            _format: *const FORMATETC,
            _medium: *mut STGMEDIUM,
        ) -> windows::core::Result<()> {
            Err(WindowsError::from_hresult(E_NOTIMPL))
        }

        fn QueryGetData(&self, format: *const FORMATETC) -> HRESULT {
            if format.is_null() {
                return E_INVALIDARG;
            }
            let format = unsafe { &*format };
            match self.formats() {
                Ok(formats)
                    if formats.iter().any(|candidate| {
                        FileDragDataObject::supports(format, candidate.cfFormat)
                    }) =>
                {
                    HRESULT(0)
                }
                _ => DV_E_FORMATETC,
            }
        }

        fn GetCanonicalFormatEtc(
            &self,
            _input: *const FORMATETC,
            output: *mut FORMATETC,
        ) -> HRESULT {
            if !output.is_null() {
                unsafe { (*output).ptd = ptr::null_mut() };
            }
            E_NOTIMPL
        }

        fn SetData(
            &self,
            format: *const FORMATETC,
            medium: *const STGMEDIUM,
            release: BOOL,
        ) -> windows::core::Result<()> {
            if format.is_null() || medium.is_null() {
                return Err(WindowsError::from_hresult(E_INVALIDARG));
            }
            let result = (|| {
                let format = unsafe { &*format };
                let performed = clipboard_format(CFSTR_PERFORMEDDROPEFFECT)?;
                let logical = clipboard_format(CFSTR_LOGICALPERFORMEDDROPEFFECT)?;
                if format.cfFormat != performed && format.cfFormat != logical {
                    return Err(WindowsError::from_hresult(DV_E_FORMATETC));
                }
                let medium_ref = unsafe { &*medium };
                if medium_ref.tymed != TYMED_HGLOBAL.0 as u32 {
                    return Err(WindowsError::from_hresult(DV_E_FORMATETC));
                }
                let handle = unsafe { medium_ref.u.hGlobal };
                if unsafe { GlobalSize(handle) } < size_of::<u32>() {
                    return Err(WindowsError::from_hresult(DV_E_FORMATETC));
                }
                let pointer = unsafe { GlobalLock(handle) };
                if pointer.is_null() {
                    return Err(WindowsError::from_win32());
                }
                let effect = unsafe { pointer.cast::<u32>().read_unaligned() };
                let _ = unsafe { GlobalUnlock(handle) };
                self.performed.store(effect, Ordering::Release);
                Ok(())
            })();
            if release.as_bool() {
                unsafe { ReleaseStgMedium(medium.cast_mut()) };
            }
            result
        }

        fn EnumFormatEtc(&self, direction: u32) -> windows::core::Result<IEnumFORMATETC> {
            if direction != 1 {
                return Err(WindowsError::from_hresult(E_NOTIMPL));
            }
            unsafe { SHCreateStdEnumFmtEtc(&self.formats()?) }
        }

        fn DAdvise(
            &self,
            _format: *const FORMATETC,
            _flags: u32,
            _sink: windows_core::Ref<'_, IAdviseSink>,
        ) -> windows::core::Result<u32> {
            Err(WindowsError::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }

        fn DUnadvise(&self, _connection: u32) -> windows::core::Result<()> {
            Err(WindowsError::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }

        fn EnumDAdvise(&self) -> windows::core::Result<IEnumSTATDATA> {
            Err(WindowsError::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }
    }

    #[implement(IDropSource)]
    struct FileDragSource {
        started: Instant,
        saw_button: AtomicBool,
    }

    impl IDropSource_Impl for FileDragSource_Impl {
        fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
            if escape.as_bool() {
                DRAGDROP_S_CANCEL
            } else {
                let button_down = keys.0 & MK_LBUTTON.0 != 0
                    || unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0;
                if button_down {
                    self.saw_button.store(true, Ordering::Release);
                    HRESULT(0)
                } else if self.saw_button.load(Ordering::Acquire) {
                    DRAGDROP_S_DROP
                } else if self.started.elapsed() < std::time::Duration::from_secs(2) {
                    // Windows can sample QueryContinueDrag once before the
                    // initiating pointer transition reaches the OLE loop.
                    HRESULT(0)
                } else {
                    DRAGDROP_S_CANCEL
                }
            }
        }

        fn GiveFeedback(&self, _effect: DROPEFFECT) -> HRESULT {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    #[derive(Default)]
    struct InboundDrag {
        session: u64,
        paths: Vec<String>,
        allowed: DROPEFFECT,
    }

    #[implement(IDropTarget)]
    struct FileDropTarget {
        hwnd: HWND,
        app: AppHandle,
        counters: Arc<DragCounters>,
        session_seed: u64,
        desired_session: Arc<AtomicU64>,
        desired_effect: Arc<AtomicU32>,
        current: UnsafeCell<InboundDrag>,
    }

    impl FileDropTarget {
        fn emit(
            &self,
            phase: NativeFileDragPhase,
            position: Option<&windows::Win32::Foundation::POINTL>,
            keys: MODIFIERKEYS_FLAGS,
            operation: Option<NativeFileClipboardOperation>,
        ) {
            let current = unsafe { &*self.current.get() };
            let mut point = POINT::default();
            if let Some(position) = position {
                point.x = position.x;
                point.y = position.y;
                let _ = unsafe { ScreenToClient(self.hwnd, &mut point) };
            }
            let payload = NativeFileDragEvent {
                phase,
                session: current.session,
                paths: current.paths.clone(),
                x: point.x as f64,
                y: point.y as f64,
                modifiers: modifiers(keys),
                operation,
            };
            let _ = self
                .app
                .emit_to(TRUSTED_WEBVIEW_LABEL, NATIVE_FILE_DRAG_EVENT, payload);
        }

        fn desired(&self, session: u64) -> Option<DROPEFFECT> {
            if self.desired_session.load(Ordering::Acquire) != session {
                return None;
            }
            Some(match self.desired_effect.load(Ordering::Acquire) {
                1 => DROPEFFECT_COPY,
                2 => DROPEFFECT_MOVE,
                _ => DROPEFFECT_NONE,
            })
        }

        fn desired_or_source_default(
            &self,
            session: u64,
            allowed: DROPEFFECT,
            keys: MODIFIERKEYS_FLAGS,
        ) -> DROPEFFECT {
            self.desired(session).unwrap_or_else(|| {
                if keys.0 & MK_SHIFT.0 != 0 && allowed.0 & DROPEFFECT_MOVE.0 != 0 {
                    DROPEFFECT_MOVE
                } else if allowed.0 & DROPEFFECT_COPY.0 != 0 {
                    DROPEFFECT_COPY
                } else if allowed.0 & DROPEFFECT_MOVE.0 != 0 {
                    DROPEFFECT_MOVE
                } else {
                    DROPEFFECT_NONE
                }
            })
        }
    }

    impl IDropTarget_Impl for FileDropTarget_Impl {
        fn DragEnter(
            &self,
            data: windows_core::Ref<'_, IDataObject>,
            keys: MODIFIERKEYS_FLAGS,
            point: &windows::Win32::Foundation::POINTL,
            effect: *mut DROPEFFECT,
        ) -> windows::core::Result<()> {
            let enter_index = self.counters.inbound_enters.fetch_add(1, Ordering::Relaxed) + 1;
            let allowed = if effect.is_null() {
                DROPEFFECT_NONE
            } else {
                unsafe { *effect }
            };
            let paths = match data
                .as_ref()
                .and_then(|data| paths_from_data_object(data).ok())
            {
                Some(paths) => paths,
                None => {
                    if !effect.is_null() {
                        unsafe { *effect = DROPEFFECT_NONE };
                    }
                    return Ok(());
                }
            };
            let current = unsafe { &mut *self.current.get() };
            current.session = self.session_seed.wrapping_add(enter_index);
            current.paths = paths;
            current.allowed = DROPEFFECT(allowed.0 & (DROPEFFECT_COPY.0 | DROPEFFECT_MOVE.0));
            ACTIVE_INBOUND_DRAG.store(true, Ordering::Release);
            self.counters
                .active_inbound_sessions
                .fetch_add(1, Ordering::AcqRel);
            let desired = self.desired_or_source_default(current.session, current.allowed, keys);
            let selected = choose_effect(current.allowed, keys, desired);
            if !effect.is_null() {
                unsafe { *effect = selected };
            }
            self.emit(
                NativeFileDragPhase::Enter,
                Some(point),
                keys,
                operation_from_effect(selected),
            );
            Ok(())
        }

        fn DragOver(
            &self,
            keys: MODIFIERKEYS_FLAGS,
            point: &windows::Win32::Foundation::POINTL,
            effect: *mut DROPEFFECT,
        ) -> windows::core::Result<()> {
            let current = unsafe { &*self.current.get() };
            let desired = self.desired_or_source_default(current.session, current.allowed, keys);
            let selected = choose_effect(current.allowed, keys, desired);
            if !effect.is_null() {
                unsafe { *effect = selected };
            }
            self.emit(
                NativeFileDragPhase::Over,
                Some(point),
                keys,
                operation_from_effect(selected),
            );
            Ok(())
        }

        fn DragLeave(&self) -> windows::core::Result<()> {
            let current = unsafe { &mut *self.current.get() };
            if !current.paths.is_empty() {
                self.emit(
                    NativeFileDragPhase::Leave,
                    None,
                    MODIFIERKEYS_FLAGS(0),
                    None,
                );
                self.counters.inbound_leaves.fetch_add(1, Ordering::Relaxed);
                self.counters
                    .active_inbound_sessions
                    .fetch_sub(1, Ordering::AcqRel);
                current.paths.clear();
                current.allowed = DROPEFFECT_NONE;
            }
            let _ = expand_overlay(self.hwnd, false);
            ACTIVE_INBOUND_DRAG.store(false, Ordering::Release);
            Ok(())
        }

        fn Drop(
            &self,
            data: windows_core::Ref<'_, IDataObject>,
            keys: MODIFIERKEYS_FLAGS,
            point: &windows::Win32::Foundation::POINTL,
            effect: *mut DROPEFFECT,
        ) -> windows::core::Result<()> {
            let current = unsafe { &mut *self.current.get() };
            if let Some(paths) = data
                .as_ref()
                .and_then(|data| paths_from_data_object(data).ok())
            {
                current.paths = paths;
            }
            let desired = self.desired_or_source_default(current.session, current.allowed, keys);
            let selected = choose_effect(current.allowed, keys, desired);
            if !effect.is_null() {
                unsafe { *effect = selected };
            }
            self.emit(
                NativeFileDragPhase::Drop,
                Some(point),
                keys,
                operation_from_effect(selected),
            );
            self.counters.inbound_drops.fetch_add(1, Ordering::Relaxed);
            if !current.paths.is_empty() {
                self.counters
                    .active_inbound_sessions
                    .fetch_sub(1, Ordering::AcqRel);
            }
            current.paths.clear();
            current.allowed = DROPEFFECT_NONE;
            let _ = expand_overlay(self.hwnd, false);
            ACTIVE_INBOUND_DRAG.store(false, Ordering::Release);
            Ok(())
        }
    }

    static DROP_SHIELD_CLASS: OnceLock<bool> = OnceLock::new();
    static ACTIVE_DROP_SHIELD: AtomicIsize = AtomicIsize::new(0);
    static ACTIVE_DROP_OWNER: AtomicIsize = AtomicIsize::new(0);
    static ACTIVE_DROP_SHIELD_EXPANDED: AtomicBool = AtomicBool::new(false);
    static ACTIVE_INBOUND_DRAG: AtomicBool = AtomicBool::new(false);
    static OUTBOUND_DRAG_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

    unsafe extern "system" fn drop_shield_mouse_hook(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code >= 0 {
            let shield = HWND(ACTIVE_DROP_SHIELD.load(Ordering::Acquire) as *mut _);
            let owner = HWND(ACTIVE_DROP_OWNER.load(Ordering::Acquire) as *mut _);
            if !shield.0.is_null() && !owner.0.is_null() {
                let message = wparam.0 as u32;
                if message == WM_LBUTTONDOWN && !OUTBOUND_DRAG_IN_PROGRESS.load(Ordering::Acquire) {
                    let _ = windows::Win32::UI::WindowsAndMessaging::KillTimer(Some(shield), 1);
                    let hook = &*(lparam.0 as *const MSLLHOOKSTRUCT);
                    let at_pointer = WindowFromPoint(hook.pt);
                    let root = GetAncestor(at_pointer, GA_ROOT);
                    if at_pointer != owner && root != owner {
                        // Arm before the source calls DoDragDrop. As an owned popup the shield
                        // stays behind the foreground Explorer/source window, then becomes the
                        // first OLE target as the pointer crosses onto Nammu.
                        let _ = expand_overlay(shield, true);
                    }
                } else if message == WM_LBUTTONUP && !ACTIVE_INBOUND_DRAG.load(Ordering::Acquire) {
                    // OLE dispatches Drop after the low-level input hook returns. A short timer
                    // handles ordinary external clicks/cancelled drags without racing Drop.
                    let _ = SetTimer(Some(shield), 1, 150, None);
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    unsafe extern "system" fn drop_shield_window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_DESTROY {
            PostQuitMessage(0);
            return LRESULT(0);
        }
        if message == WM_TIMER && wparam.0 == 1 {
            let _ = windows::Win32::UI::WindowsAndMessaging::KillTimer(Some(hwnd), 1);
            let _ = expand_overlay(hwnd, false);
            return LRESULT(0);
        }
        if message == WM_NCHITTEST {
            return if ACTIVE_DROP_SHIELD_EXPANDED.load(Ordering::Acquire) {
                LRESULT(HTCLIENT as isize)
            } else {
                LRESULT(HTTRANSPARENT as isize)
            };
        }
        DefWindowProcW(hwnd, message, wparam, lparam)
    }

    fn ensure_drop_shield_class() -> Result<(), String> {
        let registered = *DROP_SHIELD_CLASS.get_or_init(|| {
            let class = WNDCLASSW {
                lpfnWndProc: Some(drop_shield_window_proc),
                lpszClassName: w!("NammuNativeFileDropShield"),
                ..Default::default()
            };
            (unsafe { RegisterClassW(&class) }) != 0
        });
        if registered {
            Ok(())
        } else {
            Err("The native file drop shield class could not be registered.".to_string())
        }
    }

    fn resize_overlay(hwnd: HWND) -> Result<RECT, String> {
        let parent = HWND(ACTIVE_DROP_OWNER.load(Ordering::Acquire) as *mut _);
        if parent.0.is_null() {
            return Err("The native file drop shield lost its parent window.".to_string());
        }
        let mut rect = RECT::default();
        unsafe { GetClientRect(parent, &mut rect) }
            .map_err(|_| "The Nammu window bounds are unavailable for file drop.".to_string())?;
        let width = (rect.right - rect.left).max(1);
        let height = (rect.bottom - rect.top).max(1);
        let mut origin = POINT::default();
        if !unsafe { ClientToScreen(parent, &mut origin) }.as_bool() {
            return Err("The Nammu window position is unavailable for file drop.".to_string());
        }
        unsafe {
            SetWindowPos(
                hwnd,
                Some(HWND_TOP),
                origin.x,
                origin.y,
                width,
                height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
        }
        .map_err(|_| "The native file drop shield could not be resized.".to_string())?;
        Ok(RECT {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
        })
    }

    fn expand_overlay(hwnd: HWND, expanded: bool) -> Result<(), String> {
        if ACTIVE_DROP_SHIELD.load(Ordering::Acquire) == hwnd.0 as isize {
            ACTIVE_DROP_SHIELD_EXPANDED.store(expanded, Ordering::Release);
        }
        resize_overlay(hwnd)?;
        Ok(())
    }

    fn create_drop_target(
        hwnd: HWND,
        app: AppHandle,
        counters: Arc<DragCounters>,
        seed: u64,
        desired_session: Arc<AtomicU64>,
        desired_effect: Arc<AtomicU32>,
    ) -> IDropTarget {
        FileDropTarget {
            hwnd,
            app,
            counters,
            session_seed: seed,
            desired_session,
            desired_effect,
            current: UnsafeCell::new(InboundDrag::default()),
        }
        .into()
    }

    pub struct DropRegistration {
        hwnd: HWND,
        thread: Option<thread::JoinHandle<()>>,
    }

    unsafe impl Send for DropRegistration {}

    impl Drop for DropRegistration {
        fn drop(&mut self) {
            let _ = unsafe { PostMessageW(Some(self.hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) };
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    pub fn register_targets(
        app: AppHandle,
        parent: HWND,
        counters: Arc<DragCounters>,
        seed: u64,
        desired_session: Arc<AtomicU64>,
        desired_effect: Arc<AtomicU32>,
    ) -> Result<Vec<DropRegistration>, String> {
        let parent_value = parent.0 as usize;
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let worker = thread::Builder::new()
            .name("nammu-file-drop-target".to_string())
            .spawn(move || {
                if let Err(error) = initialize_ole() {
                    let _ = ready_tx.send(Err(error));
                    return;
                }
                let prepared = (|| {
                    ensure_drop_shield_class()?;
                    let parent = HWND(parent_value as *mut _);
                    ACTIVE_DROP_OWNER.store(parent.0 as isize, Ordering::Release);
                    let hwnd = unsafe {
                        CreateWindowExW(
                            WS_EX_TOOLWINDOW,
                            w!("NammuNativeFileDropShield"),
                            w!(""),
                            WS_POPUP | WS_VISIBLE,
                            0,
                            0,
                            1,
                            1,
                            Some(parent),
                            None,
                            None,
                            None,
                        )
                    }
                    .map_err(|_| "The native file drop shield could not be created.".to_string())?;
                    if let Err(error) = expand_overlay(hwnd, false) {
                        let _ = unsafe { DestroyWindow(hwnd) };
                        return Err(error);
                    }
                    let target = create_drop_target(
                        hwnd,
                        app,
                        counters,
                        seed,
                        desired_session,
                        desired_effect,
                    );
                    let revoked = unsafe { RevokeDragDrop(hwnd) };
                    if revoked.is_err() && revoked != Err(DRAGDROP_E_NOTREGISTERED.into()) {
                        let _ = unsafe { DestroyWindow(hwnd) };
                        return Err(
                            "The native file drop shield could not be initialized.".to_string()
                        );
                    }
                    if unsafe { RegisterDragDrop(hwnd, &target) }.is_err() {
                        let _ = unsafe { DestroyWindow(hwnd) };
                        return Err(
                            "The native file drop shield could not accept Shell data.".to_string()
                        );
                    }
                    ACTIVE_DROP_SHIELD.store(hwnd.0 as isize, Ordering::Release);
                    ACTIVE_DROP_SHIELD_EXPANDED.store(false, Ordering::Release);
                    let mouse_hook = unsafe {
                        SetWindowsHookExW(WH_MOUSE_LL, Some(drop_shield_mouse_hook), None, 0)
                    }
                    .map_err(|_| {
                        "The native file drop shield could not observe pointer transitions."
                            .to_string()
                    })?;
                    Ok((hwnd, target, mouse_hook))
                })();
                let (hwnd, target, mouse_hook) = match prepared {
                    Ok(value) => value,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                        uninitialize_ole();
                        return;
                    }
                };
                if ready_tx.send(Ok(hwnd.0 as usize)).is_err() {
                    let _ = unsafe { UnhookWindowsHookEx(mouse_hook) };
                    let _ = unsafe { RevokeDragDrop(hwnd) };
                    let _ = unsafe { DestroyWindow(hwnd) };
                    uninitialize_ole();
                    return;
                }
                let mut message = MSG::default();
                while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
                    unsafe {
                        let _ = TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }
                let _target = target;
                let _ = unsafe { UnhookWindowsHookEx(mouse_hook) };
                if ACTIVE_DROP_SHIELD.load(Ordering::Acquire) == hwnd.0 as isize {
                    ACTIVE_DROP_SHIELD.store(0, Ordering::Release);
                    ACTIVE_DROP_OWNER.store(0, Ordering::Release);
                    ACTIVE_DROP_SHIELD_EXPANDED.store(false, Ordering::Release);
                }
                let _ = unsafe { RevokeDragDrop(hwnd) };
                let _ = unsafe { DestroyWindow(hwnd) };
                uninitialize_ole();
            })
            .map_err(|_| "The native file drop target thread could not start.".to_string())?;
        let hwnd = match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(hwnd)) => HWND(hwnd as *mut _),
            Ok(Err(error)) => {
                let _ = worker.join();
                return Err(error);
            }
            Err(_) => return Err("The native file drop target did not become ready.".to_string()),
        };
        Ok(vec![DropRegistration {
            hwnd,
            thread: Some(worker),
        }])
    }

    pub fn start_outbound_drag(
        operation: NativeFileDragOperation,
        paths: Vec<String>,
        counters: Arc<DragCounters>,
    ) -> Result<NativeFileDragResult, NativeFilesystemError> {
        counters.outbound_started.fetch_add(1, Ordering::Relaxed);
        counters
            .active_outbound_sessions
            .fetch_add(1, Ordering::AcqRel);
        struct ActiveGuard(Arc<DragCounters>);
        impl Drop for ActiveGuard {
            fn drop(&mut self) {
                self.0
                    .active_outbound_sessions
                    .fetch_sub(1, Ordering::AcqRel);
            }
        }
        let _guard = ActiveGuard(counters.clone());
        unsafe { OleInitialize(None) }
            .map_err(|_| failure("Windows OLE drag and drop could not be initialized."))?;
        struct OleGuard;
        impl Drop for OleGuard {
            fn drop(&mut self) {
                unsafe { OleUninitialize() };
            }
        }
        let _ole = OleGuard;
        OUTBOUND_DRAG_IN_PROGRESS.store(true, Ordering::Release);
        let shield = HWND(ACTIVE_DROP_SHIELD.load(Ordering::Acquire) as *mut _);
        if !shield.0.is_null() {
            let _ = expand_overlay(shield, true);
        }
        struct OutboundPlatformGuard;
        impl Drop for OutboundPlatformGuard {
            fn drop(&mut self) {
                OUTBOUND_DRAG_IN_PROGRESS.store(false, Ordering::Release);
                let shield = HWND(ACTIVE_DROP_SHIELD.load(Ordering::Acquire) as *mut _);
                if !shield.0.is_null() {
                    let _ = expand_overlay(shield, false);
                }
            }
        }
        let _platform_guard = OutboundPlatformGuard;
        let started = Instant::now();
        let preferred = match operation {
            NativeFileDragOperation::Move => Some(DROPEFFECT_MOVE),
            NativeFileDragOperation::Copy => Some(DROPEFFECT_COPY),
            NativeFileDragOperation::Auto => None,
        };
        // The initiating modifier is a preference, not a permanent lock. OLE
        // targets must still be able to apply live Ctrl/Shift and same-volume
        // versus cross-volume Shell semantics throughout the drag.
        let allowed = DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_MOVE.0);
        let performed = Arc::new(AtomicU32::new(0));
        let data: IDataObject =
            FileDragDataObject::new(paths.clone(), preferred, performed.clone())?.into();
        let source: IDropSource = FileDragSource {
            started: Instant::now(),
            saw_button: AtomicBool::new(false),
        }
        .into();
        let prepare_duration_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let mut effect = DROPEFFECT_NONE;
        let status = unsafe { DoDragDrop(&data, &source, allowed, &mut effect) };
        let dropped = status == DRAGDROP_S_DROP && effect != DROPEFFECT_NONE;
        if dropped {
            counters.outbound_dropped.fetch_add(1, Ordering::Relaxed);
        } else {
            counters.outbound_cancelled.fetch_add(1, Ordering::Relaxed);
        }
        let performed = DROPEFFECT(performed.load(Ordering::Acquire));
        Ok(NativeFileDragResult {
            dropped,
            operation: operation_from_effect(if performed != DROPEFFECT_NONE {
                performed
            } else {
                effect
            }),
            item_count: paths.len(),
            prepare_duration_ms,
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn resolves_modifiers_and_ambiguous_effect_safely() {
            let both = DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_MOVE.0);
            assert_eq!(
                choose_effect(both, MK_CONTROL, DROPEFFECT_MOVE),
                DROPEFFECT_COPY
            );
            assert_eq!(
                choose_effect(both, MK_SHIFT, DROPEFFECT_COPY),
                DROPEFFECT_MOVE
            );
            assert_eq!(
                choose_effect(both, MODIFIERKEYS_FLAGS(0), DROPEFFECT_COPY),
                DROPEFFECT_COPY
            );
            assert_eq!(
                choose_effect(both, MODIFIERKEYS_FLAGS(0), DROPEFFECT_NONE),
                DROPEFFECT_NONE
            );
        }

        #[test]
        fn creates_bounded_unicode_hdrop_without_touching_clipboard() {
            let paths = (0..1_000)
                .map(|index| format!("C:\\fixture\\资料 {index} 🚀.txt"))
                .collect::<Vec<_>>();
            let performed = Arc::new(AtomicU32::new(0));
            let object: IDataObject =
                FileDragDataObject::new(paths.clone(), Some(DROPEFFECT_COPY), performed)
                    .unwrap()
                    .into();
            assert_eq!(paths_from_data_object(&object).unwrap(), paths);
        }
    }
}
