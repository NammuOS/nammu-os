#![cfg(windows)]

use serde::{Deserialize, Serialize};
use std::{
    io::{self, BufRead, Write},
    mem::size_of,
    ptr,
    sync::atomic::{AtomicIsize, Ordering},
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::{w, BOOL},
    Win32::{
        Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND, POINT},
        System::{
            DataExchange::{
                CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
                GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
                RegisterClipboardFormatW, SetClipboardData,
            },
            Memory::{
                GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
            },
            Ole::{DROPEFFECT_COPY, DROPEFFECT_MOVE},
        },
        UI::{
            Shell::{DragQueryFileW, DROPFILES, HDROP},
            WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, HWND_MESSAGE, WINDOW_EX_STYLE, WINDOW_STYLE,
            },
        },
    },
};

const CF_HDROP: u32 = 15;
const CF_UNICODETEXT: u32 = 13;
static CLIPBOARD_OWNER: AtomicIsize = AtomicIsize::new(0);

struct OwnerWindow(HWND);

impl Drop for OwnerWindow {
    fn drop(&mut self) {
        CLIPBOARD_OWNER.store(0, Ordering::Release);
        let _ = unsafe { DestroyWindow(self.0) };
    }
}

fn clipboard_owner() -> Result<HWND, String> {
    let value = CLIPBOARD_OWNER.load(Ordering::Acquire);
    if value == 0 {
        Err("The clipboard helper owner window is unavailable".to_string())
    } else {
        Ok(HWND(value as *mut core::ffi::c_void))
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "kebab-case")]
enum Command {
    Read,
    Publish {
        operation: Operation,
        paths: Vec<String>,
    },
    ReplaceText {
        text: String,
    },
    PublishMalformed {
        kind: String,
    },
    Hold {
        milliseconds: u64,
    },
    Restore,
    Exit,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Operation {
    Copy,
    Move,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    paths: Vec<String>,
    operation: Option<Operation>,
    performed_operation: Option<Operation>,
    sequence: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreservedFormat {
    format: u32,
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Response<T: Serialize> {
    ok: bool,
    value: Option<T>,
    error: Option<String>,
}

impl<T: Serialize> Response<T> {
    fn success(value: T) -> Self {
        Self {
            ok: true,
            value: Some(value),
            error: None,
        }
    }

    fn failure(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            value: None,
            error: Some(error.into()),
        }
    }
}

struct ClipboardGuard;

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}

struct OwnedGlobal(Option<HGLOBAL>);

impl OwnedGlobal {
    fn allocate(bytes: usize) -> Result<Self, String> {
        let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes) }
            .map_err(|_| "GlobalAlloc failed".to_string())?;
        Ok(Self(Some(handle)))
    }

    fn handle(&self) -> HGLOBAL {
        self.0.expect("owned global memory")
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

fn open_clipboard(owner: Option<HWND>) -> Result<ClipboardGuard, String> {
    for attempt in 0..20 {
        if unsafe { OpenClipboard(owner) }.is_ok() {
            return Ok(ClipboardGuard);
        }
        if attempt < 19 {
            thread::sleep(Duration::from_millis(10));
        }
    }
    Err("OpenClipboard remained busy".to_string())
}

fn format(name: windows::core::PCWSTR) -> Result<u32, String> {
    let value = unsafe { RegisterClipboardFormatW(name) };
    (value != 0)
        .then_some(value)
        .ok_or_else(|| "RegisterClipboardFormatW failed".to_string())
}

fn effect(operation: Operation) -> u32 {
    match operation {
        Operation::Copy => DROPEFFECT_COPY.0,
        Operation::Move => DROPEFFECT_MOVE.0,
    }
}

fn effect_operation(value: u32) -> Option<Operation> {
    if value & DROPEFFECT_MOVE.0 != 0 {
        Some(Operation::Move)
    } else if value & DROPEFFECT_COPY.0 != 0 {
        Some(Operation::Copy)
    } else {
        None
    }
}

fn global_u32(value: u32) -> Result<OwnedGlobal, String> {
    let memory = OwnedGlobal::allocate(size_of::<u32>())?;
    let pointer = unsafe { GlobalLock(memory.handle()) };
    if pointer.is_null() {
        return Err("GlobalLock failed".to_string());
    }
    unsafe {
        pointer.cast::<u32>().write_unaligned(value);
        let _ = GlobalUnlock(memory.handle());
    }
    Ok(memory)
}

fn drop_payload_bytes(paths: &[String]) -> Result<Vec<u8>, String> {
    let mut names = Vec::<u16>::new();
    for path in paths {
        if path.is_empty() || path.chars().any(char::is_control) {
            return Err("invalid path".to_string());
        }
        names.extend(path.encode_utf16());
        names.push(0);
    }
    names.push(0);
    let header_bytes = size_of::<DROPFILES>();
    let names_bytes = names.len().checked_mul(2).ok_or("payload overflow")?;
    let mut payload = vec![0u8; header_bytes + names_bytes];
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

fn drop_payload(paths: &[String]) -> Result<OwnedGlobal, String> {
    let payload = drop_payload_bytes(paths)?;
    let memory = OwnedGlobal::allocate(payload.len())?;
    let pointer = unsafe { GlobalLock(memory.handle()) };
    if pointer.is_null() {
        return Err("GlobalLock failed".to_string());
    }
    unsafe {
        ptr::copy_nonoverlapping(payload.as_ptr(), pointer.cast::<u8>(), payload.len());
        let _ = GlobalUnlock(memory.handle());
    }
    Ok(memory)
}

fn publish(operation: Operation, paths: Vec<String>) -> Result<u32, String> {
    let mut drop_memory = drop_payload(&paths)?;
    let mut effect_memory = global_u32(effect(operation))?;
    let preferred = format(w!("Preferred DropEffect"))?;
    let owner = clipboard_owner()?;
    let guard = open_clipboard(Some(owner))?;
    unsafe { EmptyClipboard() }.map_err(|_| "EmptyClipboard failed".to_string())?;
    unsafe { SetClipboardData(CF_HDROP, Some(HANDLE(drop_memory.handle().0))) }
        .map_err(|_| "CF_HDROP publish failed".to_string())?;
    drop_memory.transfer();
    unsafe { SetClipboardData(preferred, Some(HANDLE(effect_memory.handle().0))) }
        .map_err(|_| "Preferred DropEffect publish failed".to_string())?;
    effect_memory.transfer();
    drop(guard);
    Ok(unsafe { GetClipboardSequenceNumber() })
}

fn publish_drop_bytes(payload: &[u8]) -> Result<u32, String> {
    let mut memory = OwnedGlobal::allocate(payload.len())?;
    let pointer = unsafe { GlobalLock(memory.handle()) };
    if pointer.is_null() {
        return Err("GlobalLock failed".to_string());
    }
    unsafe {
        ptr::copy_nonoverlapping(payload.as_ptr(), pointer.cast::<u8>(), payload.len());
        let _ = GlobalUnlock(memory.handle());
    }
    let owner = clipboard_owner()?;
    let guard = open_clipboard(Some(owner))?;
    unsafe { EmptyClipboard() }.map_err(|_| "EmptyClipboard failed".to_string())?;
    unsafe { SetClipboardData(CF_HDROP, Some(HANDLE(memory.handle().0))) }
        .map_err(|_| "Malformed CF_HDROP publish failed".to_string())?;
    memory.transfer();
    drop(guard);
    Ok(unsafe { GetClipboardSequenceNumber() })
}

fn malformed_payload(kind: &str) -> Result<Vec<u8>, String> {
    let mut payload = drop_payload_bytes(&["C:\\fixture\\valid.txt".to_string()])?;
    match kind {
        "invalid-offset" => unsafe {
            let mut header = payload.as_ptr().cast::<DROPFILES>().read_unaligned();
            header.pFiles = 1;
            payload
                .as_mut_ptr()
                .cast::<DROPFILES>()
                .write_unaligned(header);
        },
        "ansi" => unsafe {
            let mut header = payload.as_ptr().cast::<DROPFILES>().read_unaligned();
            header.fWide = BOOL(0);
            payload
                .as_mut_ptr()
                .cast::<DROPFILES>()
                .write_unaligned(header);
        },
        "missing-terminator" => *payload.last_mut().ok_or("empty payload")? = 1,
        "empty" => {
            payload.truncate(size_of::<DROPFILES>() + 4);
            payload[size_of::<DROPFILES>()..].fill(0);
        }
        "control" => {
            let header = unsafe { payload.as_ptr().cast::<DROPFILES>().read_unaligned() };
            let start = header.pFiles as usize;
            let character = "C:\\fixture\\".encode_utf16().count();
            payload[start + character * 2..start + character * 2 + 2]
                .copy_from_slice(&10u16.to_ne_bytes());
        }
        "oversized" => payload.resize(size_of::<DROPFILES>() + 4 * 1024 * 1024 + 2, 0),
        "too-many" => {
            let paths = (0..=10_000)
                .map(|index| format!("C:\\fixture\\{index}.txt"))
                .collect::<Vec<_>>();
            payload = drop_payload_bytes(&paths)?;
        }
        _ => return Err("unknown malformed payload kind".to_string()),
    }
    Ok(payload)
}

fn replace_text(text: String) -> Result<u32, String> {
    let mut encoded = text.encode_utf16().collect::<Vec<_>>();
    encoded.push(0);
    let bytes = encoded.len().checked_mul(2).ok_or("text overflow")?;
    let mut memory = OwnedGlobal::allocate(bytes)?;
    let pointer = unsafe { GlobalLock(memory.handle()) };
    if pointer.is_null() {
        return Err("GlobalLock failed".to_string());
    }
    unsafe {
        ptr::copy_nonoverlapping(encoded.as_ptr().cast::<u8>(), pointer.cast::<u8>(), bytes);
        let _ = GlobalUnlock(memory.handle());
    }
    let owner = clipboard_owner()?;
    let guard = open_clipboard(Some(owner))?;
    unsafe { EmptyClipboard() }.map_err(|_| "EmptyClipboard failed".to_string())?;
    unsafe { SetClipboardData(CF_UNICODETEXT, Some(HANDLE(memory.handle().0))) }
        .map_err(|_| "CF_UNICODETEXT publish failed".to_string())?;
    memory.transfer();
    drop(guard);
    Ok(unsafe { GetClipboardSequenceNumber() })
}

fn read_dword(format: u32) -> Option<u32> {
    if unsafe { IsClipboardFormatAvailable(format) }.is_err() {
        return None;
    }
    let handle = unsafe { GetClipboardData(format) }.ok()?;
    let memory = HGLOBAL(handle.0);
    let pointer = unsafe { GlobalLock(memory) };
    if pointer.is_null() {
        return None;
    }
    let value = unsafe { pointer.cast::<u32>().read_unaligned() };
    let _ = unsafe { GlobalUnlock(memory) };
    Some(value)
}

fn read_snapshot() -> Result<Snapshot, String> {
    let sequence = unsafe { GetClipboardSequenceNumber() };
    let preferred = format(w!("Preferred DropEffect"))?;
    let performed = format(w!("Performed DropEffect"))?;
    let _guard = open_clipboard(None)?;
    if unsafe { IsClipboardFormatAvailable(CF_HDROP) }.is_err() {
        return Ok(Snapshot {
            paths: Vec::new(),
            operation: None,
            performed_operation: read_dword(performed).and_then(effect_operation),
            sequence,
        });
    }
    let handle = unsafe { GetClipboardData(CF_HDROP) }
        .map_err(|_| "GetClipboardData(CF_HDROP) failed".to_string())?;
    let drop = HDROP(handle.0);
    let count = unsafe { DragQueryFileW(drop, u32::MAX, None) } as usize;
    let mut paths = Vec::with_capacity(count);
    for index in 0..count {
        let length = unsafe { DragQueryFileW(drop, index as u32, None) } as usize;
        let mut buffer = vec![0u16; length + 1];
        let copied = unsafe { DragQueryFileW(drop, index as u32, Some(&mut buffer)) } as usize;
        paths.push(String::from_utf16(&buffer[..copied]).map_err(|_| "invalid UTF-16")?);
    }
    Ok(Snapshot {
        paths,
        operation: read_dword(preferred).and_then(effect_operation),
        performed_operation: read_dword(performed).and_then(effect_operation),
        sequence,
    })
}

fn capture_clipboard() -> Result<Vec<PreservedFormat>, String> {
    let _guard = open_clipboard(None)?;
    let mut values = Vec::new();
    let mut current = 0u32;
    loop {
        current = unsafe { EnumClipboardFormats(current) };
        if current == 0 {
            break;
        }
        if matches!(current, 2 | 3 | 9 | 14 | 0x0080..=0x008f) {
            return Err(format!(
                "Clipboard format {current} is handle-based rather than self-contained HGLOBAL data; acceptance refused to mutate the clipboard."
            ));
        }
        let handle = unsafe { GetClipboardData(current) }
            .map_err(|_| format!("Clipboard format {current} became unreadable"))?;
        let memory = HGLOBAL(handle.0);
        let size = unsafe { GlobalSize(memory) };
        if size == 0 {
            return Err(format!(
                "Clipboard format {current} cannot be duplicated as self-contained global memory; acceptance refused to mutate the clipboard."
            ));
        }
        let pointer = unsafe { GlobalLock(memory) };
        if pointer.is_null() {
            return Err(format!("Clipboard format {current} could not be locked"));
        }
        let bytes = unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), size) };
        let copy = bytes.to_vec();
        let _ = unsafe { GlobalUnlock(memory) };
        values.push(PreservedFormat {
            format: current,
            bytes: copy,
        });
    }
    Ok(values)
}

fn respond<T: Serialize>(response: Response<T>) {
    println!(
        "{}",
        serde_json::to_string(&response).expect("serialize helper response")
    );
    io::stdout().flush().expect("flush helper response");
}

fn restore(original: &[PreservedFormat]) -> Result<bool, String> {
    let mut allocations = Vec::with_capacity(original.len());
    for item in original {
        let memory = OwnedGlobal::allocate(item.bytes.len())?;
        let pointer = unsafe { GlobalLock(memory.handle()) };
        if pointer.is_null() {
            return Err("A restoration allocation could not be locked".to_string());
        }
        unsafe {
            ptr::copy_nonoverlapping(item.bytes.as_ptr(), pointer.cast::<u8>(), item.bytes.len());
            let _ = GlobalUnlock(memory.handle());
        }
        allocations.push((item.format, memory));
    }
    let owner = clipboard_owner()?;
    {
        let _guard = open_clipboard(Some(owner))?;
        unsafe { EmptyClipboard() }.map_err(|_| "EmptyClipboard restore failed".to_string())?;
        for (format, memory) in &mut allocations {
            unsafe { SetClipboardData(*format, Some(HANDLE(memory.handle().0))) }
                .map_err(|_| format!("Clipboard format {format} could not be restored"))?;
            memory.transfer();
        }
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if capture_clipboard()? == original {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn main() {
    let owner = match unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("STATIC"),
            w!("Nammu F5C Clipboard Helper"),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            None,
            None,
        )
    } {
        Ok(value) => value,
        Err(_) => {
            respond::<serde_json::Value>(Response::failure(
                "The helper could not create its private clipboard owner window.",
            ));
            return;
        }
    };
    CLIPBOARD_OWNER.store(owner.0 as isize, Ordering::Release);
    let _owner_window = OwnerWindow(owner);
    if let Some(milliseconds) = std::env::args()
        .nth(1)
        .and_then(|value| value.strip_prefix("--hold-clipboard=").map(str::to_owned))
        .and_then(|value| value.parse::<u64>().ok())
    {
        match open_clipboard(Some(owner)) {
            Ok(guard) => {
                respond(Response::success(serde_json::json!({
                    "holding": true,
                    "milliseconds": milliseconds.min(10_000),
                })));
                thread::sleep(Duration::from_millis(milliseconds.min(10_000)));
                drop(guard);
            }
            Err(error) => respond::<serde_json::Value>(Response::failure(error)),
        }
        return;
    }
    let original = match capture_clipboard() {
        Ok(value) => value,
        Err(error) => {
            respond::<serde_json::Value>(Response::failure(error));
            return;
        }
    };
    respond(Response::success(serde_json::json!({
        "ready": true,
        "originalFormatCount": original.len(),
        "snapshotKind": "all-self-contained-hglobal-formats",
        "byteExactVerification": true,
    })));

    let stdin = io::stdin();
    let mut restored = false;
    for line in stdin.lock().lines() {
        let command = match line.map_err(|error| error.to_string()).and_then(|line| {
            serde_json::from_str::<Command>(&line).map_err(|error| error.to_string())
        }) {
            Ok(value) => value,
            Err(error) => {
                respond::<serde_json::Value>(Response::failure(error));
                continue;
            }
        };
        match command {
            Command::Read => match read_snapshot() {
                Ok(value) => respond(Response::success(value)),
                Err(error) => respond::<Snapshot>(Response::failure(error)),
            },
            Command::Publish { operation, paths } => match publish(operation, paths) {
                Ok(sequence) => respond(Response::success(serde_json::json!({ "sequence": sequence }))),
                Err(error) => respond::<serde_json::Value>(Response::failure(error)),
            },
            Command::ReplaceText { text } => match replace_text(text) {
                Ok(sequence) => respond(Response::success(serde_json::json!({ "sequence": sequence }))),
                Err(error) => respond::<serde_json::Value>(Response::failure(error)),
            },
            Command::PublishMalformed { kind } => match malformed_payload(&kind)
                .and_then(|payload| publish_drop_bytes(&payload))
            {
                Ok(sequence) => {
                    respond(Response::success(serde_json::json!({ "sequence": sequence })))
                }
                Err(error) => respond::<serde_json::Value>(Response::failure(error)),
            },
            Command::Hold { milliseconds } => {
                let result = open_clipboard(None).map(|guard| {
                    thread::sleep(Duration::from_millis(milliseconds.min(5_000)));
                    drop(guard);
                    serde_json::json!({ "heldMilliseconds": milliseconds.min(5_000) })
                });
                match result {
                    Ok(value) => respond(Response::success(value)),
                    Err(error) => respond::<serde_json::Value>(Response::failure(error)),
                }
            }
            Command::Restore => match restore(&original) {
                Ok(true) => {
                    restored = true;
                    respond(Response::success(serde_json::json!({
                        "restored": true,
                        "formatCount": original.len(),
                        "byteExactVerification": true,
                    })));
                }
                Ok(false) => respond::<serde_json::Value>(Response::failure(
                    "Restored clipboard format inventory did not match the retained original object.",
                )),
                Err(error) => respond::<serde_json::Value>(Response::failure(error)),
            },
            Command::Exit => {
                respond(Response::success(serde_json::json!({ "restored": restored })));
                break;
            }
        }
    }
    if !restored {
        let _ = restore(&original);
    }
}
