#![cfg(windows)]

use serde::{Deserialize, Serialize};
use std::{
    cell::UnsafeCell,
    io::{self, Read, Write},
    mem::{size_of, ManuallyDrop},
    ptr,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::{implement, w, Error, BOOL, HRESULT},
    Win32::{
        Foundation::{
            GlobalFree, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS,
            DV_E_FORMATETC, E_INVALIDARG, E_NOTIMPL, HWND, LPARAM, LRESULT,
            OLE_E_ADVISENOTSUPPORTED, POINT, RECT, WPARAM,
        },
        Graphics::Gdi::{ClientToScreen, UpdateWindow},
        System::{
            Com::{
                IAdviseSink, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA,
                DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL,
            },
            DataExchange::{GetClipboardSequenceNumber, RegisterClipboardFormatW},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT},
            Ole::{
                DoDragDrop, IDropSource, IDropSource_Impl, IDropTarget, IDropTarget_Impl,
                OleInitialize, OleUninitialize, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop,
                CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_MOVE, DROPEFFECT_NONE,
            },
            SystemServices::{MK_CONTROL, MK_SHIFT, MODIFIERKEYS_FLAGS},
        },
        UI::{
            HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
            Input::KeyboardAndMouse::{
                mouse_event, GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD,
                KEYBDINPUT, KEYEVENTF_KEYUP, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
                MOUSEEVENTF_MOVE, VIRTUAL_KEY, VK_CONTROL, VK_LBUTTON, VK_SHIFT,
            },
            Shell::{
                DragQueryFileW, SHCreateStdEnumFmtEtc, CFSTR_PREFERREDDROPEFFECT, DROPFILES, HDROP,
            },
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, EnumChildWindows,
                EnumWindows, GetAncestor, GetClassNameW, GetClientRect, GetCursorPos, GetMessageW,
                GetParent, GetPropW, GetSystemMetrics, GetWindowRect, GetWindowThreadProcessId,
                PostMessageW, PostQuitMessage, RegisterClassW, SetCursorPos, SetForegroundWindow,
                SetWindowPos, ShowWindow, TranslateMessage, WindowFromPoint, CS_HREDRAW,
                CS_VREDRAW, GA_ROOT, HWND_NOTOPMOST, HWND_TOPMOST, MSG, SM_CXSCREEN,
                SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOW, WM_CLOSE,
                WM_DESTROY, WM_LBUTTONUP, WNDCLASSW, WS_EX_TOPMOST, WS_OVERLAPPEDWINDOW,
            },
        },
    },
};

const MAX_PATHS: usize = 10_000;
const MAX_PAYLOAD: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum Operation {
    Copy,
    Move,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case")]
enum Request {
    ClipboardSequence,
    Target {
        operation: Operation,
        process_id: Option<u32>,
        client_x: Option<i32>,
        client_y: Option<i32>,
        scale: Option<f64>,
    },
    Source {
        process_id: u32,
        client_x: i32,
        client_y: i32,
        scale: f64,
        operation: Operation,
        paths: Vec<String>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    ok: bool,
    phase: String,
    paths: Vec<String>,
    operation: Option<Operation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    clipboard_sequence: Option<u32>,
    error: Option<String>,
}

struct OleGuard;

impl OleGuard {
    fn initialize() -> Result<Self, String> {
        unsafe { OleInitialize(None) }.map_err(|error| error.to_string())?;
        Ok(Self)
    }
}

impl Drop for OleGuard {
    fn drop(&mut self) {
        unsafe { OleUninitialize() };
    }
}

fn output(response: &Response) {
    println!("{}", serde_json::to_string(response).unwrap());
    io::stdout().flush().unwrap();
}

struct OwnedGlobal(Option<windows::Win32::Foundation::HGLOBAL>);

impl OwnedGlobal {
    fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes.len()) }
            .map_err(|error| format!("GlobalAlloc failed: {error}"))?;
        let pointer = unsafe { GlobalLock(handle) };
        if pointer.is_null() {
            let _ = unsafe { GlobalFree(Some(handle)) };
            return Err("GlobalLock failed".to_string());
        }
        unsafe { ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast(), bytes.len()) };
        let _ = unsafe { GlobalUnlock(handle) };
        Ok(Self(Some(handle)))
    }

    fn into_medium(mut self) -> STGMEDIUM {
        let handle = self.0.take().unwrap();
        STGMEDIUM {
            tymed: TYMED_HGLOBAL.0 as u32,
            u: STGMEDIUM_0 { hGlobal: handle },
            pUnkForRelease: ManuallyDrop::new(None),
        }
    }
}

impl Drop for OwnedGlobal {
    fn drop(&mut self) {
        if let Some(handle) = self.0.take() {
            let _ = unsafe { GlobalFree(Some(handle)) };
        }
    }
}

fn encode_hdrop(paths: &[String]) -> Result<Vec<u8>, String> {
    if paths.is_empty() || paths.len() > MAX_PATHS {
        return Err("invalid path count".to_string());
    }
    let mut names = Vec::<u16>::new();
    for path in paths {
        if path.is_empty() || path.chars().any(char::is_control) {
            return Err("invalid path".to_string());
        }
        names.extend(path.encode_utf16());
        names.push(0);
    }
    names.push(0);
    let header_size = size_of::<DROPFILES>();
    let mut bytes = vec![0u8; header_size + names.len() * 2];
    if bytes.len() > header_size + MAX_PAYLOAD {
        return Err("payload too large".to_string());
    }
    unsafe {
        bytes
            .as_mut_ptr()
            .cast::<DROPFILES>()
            .write_unaligned(DROPFILES {
                pFiles: header_size as u32,
                pt: POINT::default(),
                fNC: BOOL(0),
                fWide: BOOL(1),
            });
        ptr::copy_nonoverlapping(
            names.as_ptr().cast::<u8>(),
            bytes.as_mut_ptr().add(header_size),
            names.len() * 2,
        );
    }
    Ok(bytes)
}

fn effect_medium(operation: Operation) -> Result<STGMEDIUM, String> {
    let value = match operation {
        Operation::Copy => DROPEFFECT_COPY.0,
        Operation::Move => DROPEFFECT_MOVE.0,
    };
    Ok(OwnedGlobal::from_bytes(&value.to_ne_bytes())?.into_medium())
}

fn preferred_format() -> Result<u16, Error> {
    let format = unsafe { RegisterClipboardFormatW(CFSTR_PREFERREDDROPEFFECT) };
    if format == 0 {
        Err(Error::from_win32())
    } else {
        Ok(format as u16)
    }
}

fn format(id: u16) -> FORMATETC {
    FORMATETC {
        cfFormat: id,
        ptd: ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    }
}

#[implement(IDataObject)]
struct HelperDataObject {
    payload: Vec<u8>,
    operation: Operation,
}

impl IDataObject_Impl for HelperDataObject_Impl {
    fn GetData(&self, requested: *const FORMATETC) -> windows::core::Result<STGMEDIUM> {
        if requested.is_null() {
            return Err(Error::from_hresult(E_INVALIDARG));
        }
        let requested = unsafe { &*requested };
        if requested.cfFormat == CF_HDROP.0 && requested.tymed & TYMED_HGLOBAL.0 as u32 != 0 {
            return OwnedGlobal::from_bytes(&self.payload)
                .map(OwnedGlobal::into_medium)
                .map_err(|_| Error::from_hresult(E_NOTIMPL));
        }
        if requested.cfFormat == preferred_format()?
            && requested.tymed & TYMED_HGLOBAL.0 as u32 != 0
        {
            return effect_medium(self.operation).map_err(|_| Error::from_hresult(E_NOTIMPL));
        }
        Err(Error::from_hresult(DV_E_FORMATETC))
    }

    fn GetDataHere(&self, _: *const FORMATETC, _: *mut STGMEDIUM) -> windows::core::Result<()> {
        Err(Error::from_hresult(E_NOTIMPL))
    }

    fn QueryGetData(&self, requested: *const FORMATETC) -> HRESULT {
        if requested.is_null() {
            return E_INVALIDARG;
        }
        let requested = unsafe { &*requested };
        if requested.tymed & TYMED_HGLOBAL.0 as u32 != 0
            && (requested.cfFormat == CF_HDROP.0
                || preferred_format().is_ok_and(|id| requested.cfFormat == id))
        {
            HRESULT(0)
        } else {
            DV_E_FORMATETC
        }
    }

    fn GetCanonicalFormatEtc(&self, _: *const FORMATETC, output: *mut FORMATETC) -> HRESULT {
        if !output.is_null() {
            unsafe { (*output).ptd = ptr::null_mut() };
        }
        E_NOTIMPL
    }

    fn SetData(
        &self,
        _: *const FORMATETC,
        medium: *const STGMEDIUM,
        release: BOOL,
    ) -> windows::core::Result<()> {
        if release.as_bool() && !medium.is_null() {
            unsafe { ReleaseStgMedium(medium.cast_mut()) };
        }
        Ok(())
    }

    fn EnumFormatEtc(&self, direction: u32) -> windows::core::Result<IEnumFORMATETC> {
        if direction != 1 {
            return Err(Error::from_hresult(E_NOTIMPL));
        }
        unsafe { SHCreateStdEnumFmtEtc(&[format(CF_HDROP.0), format(preferred_format()?)]) }
    }

    fn DAdvise(
        &self,
        _: *const FORMATETC,
        _: u32,
        _: windows_core::Ref<'_, IAdviseSink>,
    ) -> windows::core::Result<u32> {
        Err(Error::from_hresult(OLE_E_ADVISENOTSUPPORTED))
    }
    fn DUnadvise(&self, _: u32) -> windows::core::Result<()> {
        Err(Error::from_hresult(OLE_E_ADVISENOTSUPPORTED))
    }
    fn EnumDAdvise(&self) -> windows::core::Result<IEnumSTATDATA> {
        Err(Error::from_hresult(OLE_E_ADVISENOTSUPPORTED))
    }
}

#[implement(IDropSource)]
struct HelperDropSource {
    started: Instant,
    saw_button: AtomicBool,
    queries: AtomicU32,
}

impl IDropSource_Impl for HelperDropSource_Impl {
    fn QueryContinueDrag(&self, escape: BOOL, _keys: MODIFIERKEYS_FLAGS) -> HRESULT {
        if escape.as_bool() {
            DRAGDROP_S_CANCEL
        } else {
            let button_down = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0;
            let query = self.queries.fetch_add(1, Ordering::Relaxed);
            if query < 8 {
                eprintln!("queryContinueDrag[{query}] buttonDown={button_down}");
            }
            if button_down {
                self.saw_button.store(true, Ordering::Release);
                HRESULT(0)
            } else if self.saw_button.load(Ordering::Acquire)
                || self.started.elapsed() >= Duration::from_millis(650)
            {
                DRAGDROP_S_DROP
            } else if self.started.elapsed() < Duration::from_secs(2) {
                HRESULT(0)
            } else {
                DRAGDROP_S_CANCEL
            }
        }
    }
    fn GiveFeedback(&self, _: DROPEFFECT) -> HRESULT {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

fn read_paths(data: windows_core::Ref<'_, IDataObject>) -> Option<Vec<String>> {
    let object = data.as_ref()?;
    let mut medium = unsafe { object.GetData(&format(CF_HDROP.0)) }.ok()?;
    if medium.tymed != TYMED_HGLOBAL.0 as u32 {
        unsafe { ReleaseStgMedium(&mut medium) };
        return None;
    }
    let hdrop = HDROP(unsafe { medium.u.hGlobal }.0 as _);
    let count = unsafe { DragQueryFileW(hdrop, u32::MAX, None) } as usize;
    if count == 0 || count > MAX_PATHS {
        unsafe { ReleaseStgMedium(&mut medium) };
        return None;
    }
    let mut paths = Vec::with_capacity(count);
    for index in 0..count {
        let length = unsafe { DragQueryFileW(hdrop, index as u32, None) } as usize;
        let mut units = vec![0u16; length + 1];
        unsafe { DragQueryFileW(hdrop, index as u32, Some(&mut units)) };
        paths.push(String::from_utf16(&units[..length]).ok()?);
    }
    unsafe { ReleaseStgMedium(&mut medium) };
    Some(paths)
}

#[derive(Default)]
struct TargetResult {
    paths: Vec<String>,
    operation: Option<Operation>,
    enters: usize,
    cursor_owned: bool,
}

#[implement(IDropTarget)]
struct HelperDropTarget {
    operation: Operation,
    result: Arc<Mutex<TargetResult>>,
    valid: UnsafeCell<bool>,
}

impl IDropTarget_Impl for HelperDropTarget_Impl {
    fn DragEnter(
        &self,
        data: windows_core::Ref<'_, IDataObject>,
        _: MODIFIERKEYS_FLAGS,
        _: &windows::Win32::Foundation::POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let valid = read_paths(data).is_some();
        self.result.lock().unwrap().enters += 1;
        unsafe { *self.valid.get() = valid };
        if !effect.is_null() {
            unsafe {
                *effect = if valid {
                    match self.operation {
                        Operation::Copy => DROPEFFECT_COPY,
                        Operation::Move => DROPEFFECT_MOVE,
                    }
                } else {
                    DROPEFFECT_NONE
                }
            };
        }
        Ok(())
    }
    fn DragOver(
        &self,
        _: MODIFIERKEYS_FLAGS,
        _: &windows::Win32::Foundation::POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        if !effect.is_null() {
            unsafe {
                *effect = if *self.valid.get() {
                    match self.operation {
                        Operation::Copy => DROPEFFECT_COPY,
                        Operation::Move => DROPEFFECT_MOVE,
                    }
                } else {
                    DROPEFFECT_NONE
                }
            };
        }
        Ok(())
    }
    fn DragLeave(&self) -> windows::core::Result<()> {
        unsafe { *self.valid.get() = false };
        Ok(())
    }
    fn Drop(
        &self,
        data: windows_core::Ref<'_, IDataObject>,
        _: MODIFIERKEYS_FLAGS,
        _: &windows::Win32::Foundation::POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let paths = read_paths(data).unwrap_or_default();
        let operation = (!paths.is_empty()).then_some(self.operation);
        let mut result = self.result.lock().unwrap();
        result.paths = paths;
        result.operation = operation;
        if !effect.is_null() {
            unsafe {
                *effect = match operation {
                    Some(Operation::Copy) => DROPEFFECT_COPY,
                    Some(Operation::Move) => DROPEFFECT_MOVE,
                    None => DROPEFFECT_NONE,
                }
            };
        }
        unsafe { PostQuitMessage(0) };
        Ok(())
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_DESTROY {
        PostQuitMessage(0);
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, message, wparam, lparam)
}

fn key_input(key: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                ..Default::default()
            },
        },
    }
}

fn mouse_button(up: bool) {
    unsafe {
        mouse_event(
            if up {
                MOUSEEVENTF_LEFTUP
            } else {
                MOUSEEVENTF_LEFTDOWN
            },
            0,
            0,
            0,
            0,
        )
    };
}

fn send(inputs: &[INPUT]) -> Result<(), String> {
    let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err("SendInput did not publish the complete input sequence".to_string())
    }
}

fn run_target(
    operation: Operation,
    process_id: Option<u32>,
    client_x: Option<i32>,
    client_y: Option<i32>,
    scale: Option<f64>,
) -> Result<Response, String> {
    let _ole = OleGuard::initialize()?;
    let class = w!("NammuF5DProtocolTarget");
    let window_class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        lpszClassName: class,
        style: CS_HREDRAW | CS_VREDRAW,
        ..Default::default()
    };
    unsafe { RegisterClassW(&window_class) };
    let screen_width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let target_left = (screen_width - 460).max(20);
    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_TOPMOST,
            class,
            w!("Nammu F5D protocol target"),
            WS_OVERLAPPEDWINDOW,
            target_left,
            80,
            420,
            260,
            None,
            None,
            None,
            None,
        )
    }
    .map_err(|error| error.to_string())?;
    let result = Arc::new(Mutex::new(TargetResult::default()));
    let target: IDropTarget = HelperDropTarget {
        operation,
        result: result.clone(),
        valid: UnsafeCell::new(false),
    }
    .into();
    if let Err(error) = unsafe { RegisterDragDrop(hwnd, &target) } {
        let _ = unsafe { DestroyWindow(hwnd) };
        return Err(error.to_string());
    }
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = UpdateWindow(hwnd);
    }
    let target_x = target_left + 210;
    let target_y = 190;
    let source_point = match (process_id, client_x, client_y, scale) {
        (Some(process_id), Some(client_x), Some(client_y), Some(scale)) => {
            let source_hwnd = webview_origin(process_id)?;
            let mut point = POINT {
                x: (f64::from(client_x) * scale).round() as i32,
                y: (f64::from(client_y) * scale).round() as i32,
            };
            if !unsafe { ClientToScreen(source_hwnd, &mut point) }.as_bool() {
                return Err("ClientToScreen failed for outbound source".to_string());
            }
            let source_root = unsafe { GetAncestor(source_hwnd, GA_ROOT) };
            let _ = unsafe { SetForegroundWindow(source_root) };
            point
        }
        _ => POINT {
            x: target_x - 300,
            y: target_y,
        },
    };
    unsafe { SetCursorPos(source_point.x, source_point.y) }.map_err(|error| error.to_string())?;
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            target_left,
            80,
            420,
            260,
            SWP_SHOWWINDOW,
        )
    }
    .map_err(|error| error.to_string())?;
    mouse_button(false);
    eprintln!(
        "sourceButtonPrimed={}",
        unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0
    );
    thread::sleep(Duration::from_millis(100));
    output(&Response {
        ok: true,
        phase: "ready".to_string(),
        paths: Vec::new(),
        operation: Some(operation),
        clipboard_sequence: None,
        error: None,
    });
    let timeout_hwnd = hwnd.0 as usize;
    let gesture_hwnd = hwnd.0 as usize;
    let gesture_result = result.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(200));
        let _ = unsafe { SetCursorPos(target_x, target_y) };
        let window = unsafe {
            WindowFromPoint(POINT {
                x: target_x,
                y: target_y,
            })
        };
        gesture_result.lock().unwrap().cursor_owned = window.0 as usize == gesture_hwnd;
        thread::sleep(Duration::from_millis(200));
        let _ = unsafe { SetCursorPos(target_x + 15, target_y + 15) };
        thread::sleep(Duration::from_millis(300));
        let mut release_point = POINT::default();
        let _ = unsafe { GetCursorPos(&mut release_point) };
        eprintln!(
            "releasePoint={},{} hwnd={:?}",
            release_point.x,
            release_point.y,
            unsafe { WindowFromPoint(release_point) }
        );
        mouse_button(true);
    });
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(15));
        let timeout_hwnd = HWND(timeout_hwnd as *mut _);
        let _ = unsafe { PostMessageW(Some(timeout_hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) };
    });
    let mut message = MSG::default();
    while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
        unsafe {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    let _ = unsafe { RevokeDragDrop(hwnd) };
    let _ = unsafe { DestroyWindow(hwnd) };
    let result = result.lock().unwrap();
    Ok(Response {
        ok: !result.paths.is_empty(),
        phase: "drop".to_string(),
        paths: result.paths.clone(),
        operation: result.operation,
        clipboard_sequence: None,
        error: result.paths.is_empty().then(|| {
            format!(
                "No OLE drop was received (enters={}, cursorOwned={})",
                result.enters, result.cursor_owned
            )
        }),
    })
}

#[derive(Default)]
struct WindowSearch {
    process_id: u32,
    best: Option<(HWND, i64, bool)>,
}

unsafe extern "system" fn enum_child(hwnd: HWND, data: LPARAM) -> BOOL {
    let search = &mut *(data.0 as *mut WindowSearch);
    let mut rect = RECT::default();
    if GetClientRect(hwnd, &mut rect).is_ok() {
        let area = i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top);
        let mut class_name = [0u16; 128];
        let class_length = GetClassNameW(hwnd, &mut class_name);
        let class_name = String::from_utf16_lossy(&class_name[..class_length.max(0) as usize]);
        let is_webview = class_name.starts_with("Chrome_");
        let replace = search.best.is_none_or(|(_, best_area, best_is_webview)| {
            (is_webview && !best_is_webview) || (is_webview == best_is_webview && area > best_area)
        });
        if replace {
            search.best = Some((hwnd, area, is_webview));
        }
    }
    true.into()
}

unsafe extern "system" fn enum_top(hwnd: HWND, data: LPARAM) -> BOOL {
    let search = &mut *(data.0 as *mut WindowSearch);
    let mut process_id = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    if process_id == search.process_id {
        let mut class_name = [0u16; 128];
        let class_length = GetClassNameW(hwnd, &mut class_name);
        let class_name = String::from_utf16_lossy(&class_name[..class_length.max(0) as usize]);
        if class_name == "Tauri Window" {
            let mut rect = RECT::default();
            if GetClientRect(hwnd, &mut rect).is_ok() {
                let area = i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top);
                if search.best.is_none_or(|(_, best_area, _)| area > best_area) {
                    search.best = Some((hwnd, area, true));
                }
            }
        } else {
            let _ = EnumChildWindows(Some(hwnd), Some(enum_child), data);
        }
    }
    true.into()
}

fn webview_origin(process_id: u32) -> Result<HWND, String> {
    let mut search = WindowSearch {
        process_id,
        best: None,
    };
    unsafe {
        EnumWindows(
            Some(enum_top),
            LPARAM((&mut search as *mut WindowSearch) as isize),
        )
    }
    .map_err(|error| error.to_string())?;
    search
        .best
        .map(|value| value.0)
        .ok_or_else(|| "WebView2 HWND not found".to_string())
}

fn run_source(
    process_id: u32,
    client_x: i32,
    client_y: i32,
    scale: f64,
    operation: Operation,
    paths: Vec<String>,
) -> Result<Response, String> {
    let _ole = OleGuard::initialize()?;
    struct TargetZOrderGuard(HWND);
    impl Drop for TargetZOrderGuard {
        fn drop(&mut self) {
            let _ = unsafe {
                SetWindowPos(
                    self.0,
                    Some(HWND_NOTOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                )
            };
        }
    }
    let (point, _target_z_order) = if process_id == 0 {
        let screen_width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
        (
            POINT {
                x: (screen_width - 460).max(20) + 210,
                y: 190,
            },
            None,
        )
    } else {
        let hwnd = webview_origin(process_id)?;
        let target_root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let mut target_rect = RECT::default();
        let _ = unsafe { GetWindowRect(target_root, &mut target_rect) };
        unsafe {
            SetWindowPos(
                target_root,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
        }
        .map_err(|error| format!("Could not stage the acceptance target: {error}"))?;
        let mut point = POINT {
            x: (f64::from(client_x) * scale).round() as i32,
            y: (f64::from(client_y) * scale).round() as i32,
        };
        if !unsafe { ClientToScreen(target_root, &mut point) }.as_bool() {
            return Err("ClientToScreen failed".to_string());
        }
        eprintln!(
            "targetRoot={target_root:?} windowRect={},{},{},{} translatedPoint={},{}",
            target_rect.left,
            target_rect.top,
            target_rect.right,
            target_rect.bottom,
            point.x,
            point.y
        );
        (point, Some(TargetZOrderGuard(target_root)))
    };
    let point_window = unsafe { WindowFromPoint(point) };
    let mut point_process = 0;
    unsafe { GetWindowThreadProcessId(point_window, Some(&mut point_process)) };
    let mut point_class = [0u16; 128];
    let point_class_length = unsafe { GetClassNameW(point_window, &mut point_class) };
    eprintln!(
        "targetPoint={},{} hwnd={:?} pid={} class={} oleTarget={:?}",
        point.x,
        point.y,
        point_window,
        point_process,
        String::from_utf16_lossy(&point_class[..point_class_length.max(0) as usize]),
        unsafe { GetPropW(point_window, w!("OleDropTargetInterface")) }
    );
    let mut ancestor = unsafe { GetParent(point_window) };
    while let Ok(window) = ancestor {
        if window.0.is_null() {
            break;
        }
        let mut class_name = [0u16; 128];
        let class_length = unsafe { GetClassNameW(window, &mut class_name) };
        eprintln!(
            "ancestor={window:?} class={} oleTarget={:?}",
            String::from_utf16_lossy(&class_name[..class_length.max(0) as usize]),
            unsafe { GetPropW(window, w!("OleDropTargetInterface")) }
        );
        ancestor = unsafe { GetParent(window) };
    }
    let source_class = w!("NammuF5DProtocolSource");
    let source_window_class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        lpszClassName: source_class,
        style: CS_HREDRAW | CS_VREDRAW,
        ..Default::default()
    };
    unsafe { RegisterClassW(&source_window_class) };
    let source_window = unsafe {
        CreateWindowExW(
            WS_EX_TOPMOST,
            source_class,
            w!("Nammu F5D protocol source"),
            WS_OVERLAPPEDWINDOW,
            20,
            80,
            220,
            180,
            None,
            None,
            None,
            None,
        )
    }
    .map_err(|error| error.to_string())?;
    unsafe {
        let _ = ShowWindow(source_window, SW_SHOW);
        let _ = UpdateWindow(source_window);
        let _ = SetForegroundWindow(source_window);
        SetCursorPos(120, 160).ok();
    }
    let modifier = match operation {
        Operation::Copy => Some(VK_CONTROL),
        Operation::Move => Some(VK_SHIFT),
    };
    if let Some(key) = modifier {
        send(&[key_input(key, false)])?;
    }
    mouse_button(false);
    eprintln!(
        "sourceButtonPrimed={}",
        unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0
    );
    thread::sleep(Duration::from_millis(50));
    let source_window_value = source_window.0 as usize;
    let gesture = thread::spawn(move || {
        let source_window = HWND(source_window_value as *mut _);
        thread::sleep(Duration::from_millis(200));
        for step in 1..=320 {
            let x = 120 + ((point.x - 120) * step / 320);
            let y = 160 + ((point.y - 160) * step / 320);
            let _ = unsafe { SetCursorPos(x, y) };
            // DoDragDrop's modal message filter consumes the synthetic
            // coordinates as screen coordinates, not as source-window client
            // coordinates. This mirrors the point OLE receives from real
            // pointer input.
            let packed = ((y as u32 & 0xffff) << 16) | (x as u32 & 0xffff);
            let _ = unsafe {
                PostMessageW(
                    Some(source_window),
                    windows::Win32::UI::WindowsAndMessaging::WM_MOUSEMOVE,
                    WPARAM(1),
                    LPARAM(packed as isize),
                )
            };
            thread::sleep(Duration::from_millis(2));
        }
        unsafe { mouse_event(MOUSEEVENTF_MOVE, 1, 0, 0, 0) };
        thread::sleep(Duration::from_millis(300));
        // Give an asynchronous UI-backed target one final DragOver after it
        // has resolved the destination and published its copy/move effect.
        // Explorer naturally produces these pointer updates while a user is
        // positioning a drop; the acceptance helper must do the same.
        for x in [point.x - 1, point.x] {
            let _ = unsafe { SetCursorPos(x, point.y) };
            let packed = ((point.y as u32 & 0xffff) << 16) | (x as u32 & 0xffff);
            let _ = unsafe {
                PostMessageW(
                    Some(source_window),
                    windows::Win32::UI::WindowsAndMessaging::WM_MOUSEMOVE,
                    WPARAM(1),
                    LPARAM(packed as isize),
                )
            };
            thread::sleep(Duration::from_millis(80));
        }
        let mut release_point = POINT::default();
        let _ = unsafe { GetCursorPos(&mut release_point) };
        let release_window = unsafe { WindowFromPoint(release_point) };
        let mut release_process = 0;
        let release_thread =
            unsafe { GetWindowThreadProcessId(release_window, Some(&mut release_process)) };
        let mut release_class = [0u16; 128];
        let release_class_length = unsafe { GetClassNameW(release_window, &mut release_class) };
        eprintln!(
            "sourceReleasePoint={},{} hwnd={:?} pid={} tid={} class={}",
            release_point.x,
            release_point.y,
            release_window,
            release_process,
            release_thread,
            String::from_utf16_lossy(&release_class[..release_class_length.max(0) as usize])
        );
        mouse_button(true);
        let release_lparam =
            ((release_point.y as u32 & 0xffff) << 16) | (release_point.x as u32 & 0xffff);
        let release_keys = match operation {
            Operation::Copy => MK_CONTROL.0,
            Operation::Move => MK_SHIFT.0,
        };
        let _ = unsafe {
            PostMessageW(
                Some(source_window),
                WM_LBUTTONUP,
                WPARAM(release_keys as usize),
                LPARAM(release_lparam as isize),
            )
        };
        thread::sleep(Duration::from_millis(50));
        eprintln!(
            "released leftButtonDown={}",
            unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0
        );
        if let Some(key) = modifier {
            let _ = send(&[key_input(key, true)]);
        }
    });
    let data: IDataObject = HelperDataObject {
        payload: encode_hdrop(&paths)?,
        operation,
    }
    .into();
    let source: IDropSource = HelperDropSource {
        started: Instant::now(),
        saw_button: AtomicBool::new(false),
        queries: AtomicU32::new(0),
    }
    .into();
    let mut effect = DROPEFFECT_NONE;
    let drag_result = unsafe {
        DoDragDrop(
            &data,
            &source,
            DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_MOVE.0),
            &mut effect,
        )
    };
    let _ = gesture.join();
    let accepted = drag_result == DRAGDROP_S_DROP && effect != DROPEFFECT_NONE;
    let _ = unsafe { DestroyWindow(source_window) };
    Ok(Response {
        ok: accepted,
        phase: "drop".to_string(),
        paths,
        operation: if effect.0 & DROPEFFECT_MOVE.0 != 0 {
            Some(Operation::Move)
        } else if effect.0 & DROPEFFECT_COPY.0 != 0 {
            Some(Operation::Copy)
        } else {
            None
        },
        clipboard_sequence: None,
        error: (!accepted).then(|| format!("Shell drag was not accepted: {drag_result:?}")),
    })
}

fn main() {
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    mouse_button(true);
    let _ = send(&[key_input(VK_CONTROL, true), key_input(VK_SHIFT, true)]);
    thread::sleep(Duration::from_millis(100));
    let response = match serde_json::from_str::<Request>(&input) {
        Ok(Request::ClipboardSequence) => Ok(Response {
            ok: true,
            phase: "clipboard-sequence".to_string(),
            paths: Vec::new(),
            operation: None,
            clipboard_sequence: Some(unsafe { GetClipboardSequenceNumber() }),
            error: None,
        }),
        Ok(Request::Target {
            operation,
            process_id,
            client_x,
            client_y,
            scale,
        }) => run_target(operation, process_id, client_x, client_y, scale),
        Ok(Request::Source {
            process_id,
            client_x,
            client_y,
            scale,
            operation,
            paths,
        }) => run_source(process_id, client_x, client_y, scale, operation, paths),
        Err(error) => Err(format!("Invalid request: {error}")),
    };
    match response {
        Ok(response) => output(&response),
        Err(error) => output(&Response {
            ok: false,
            phase: "error".to_string(),
            paths: Vec::new(),
            operation: None,
            clipboard_sequence: None,
            error: Some(error),
        }),
    }
}
