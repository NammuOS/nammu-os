use crate::native_filesystem::{
    path_string, require_trusted_caller, validate_path, NativeFilesystemError,
    NativeFilesystemErrorCode, NativeFilesystemResponse,
};
use crate::native_pdf_preview::{self, PdfPreviewError};
use crate::native_video_preview::{self, VideoPreviewError};
use getrandom::fill as random_fill;
use image::{
    imageops::FilterType, metadata::Orientation, DynamicImage, ImageDecoder, ImageFormat,
    ImageReader, Limits,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufReader, Cursor, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, UNIX_EPOCH},
};
use tauri::{ipc::Response, State, Webview};

const MAX_ACTIVE_JOBS: usize = 4;
const MAX_JOB_RECORDS: usize = 64;
const TERMINAL_JOB_TTL: Duration = Duration::from_secs(60);
const MAX_IMAGE_INPUT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_IMAGE_DIMENSION: u32 = 20_000;
const MAX_IMAGE_ALLOC_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ENCODED_RESULT_BYTES: usize = 8 * 1024 * 1024;
const TEXT_PREVIEW_BYTES: usize = 512 * 1024;
const CACHE_MAX_ENTRIES: usize = 256;
const CACHE_MAX_BYTES: usize = 32 * 1024 * 1024;
const CACHE_MAX_ITEM_BYTES: usize = 4 * 1024 * 1024;
const DECODER_VERSION: u8 = 3;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFilePreviewMode {
    Thumbnail,
    ImagePreview,
    TextPreview,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFilePreviewRequest {
    pub path: String,
    pub mode: NativeFilePreviewMode,
    pub requested_width: u32,
    pub requested_height: u32,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFilePreviewStatus {
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFilePreviewKind {
    Image,
    Text,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFilePreviewDescriptor {
    pub kind: NativeFilePreviewKind,
    pub mime_type: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub source_width: Option<u32>,
    pub source_height: Option<u32>,
    pub page_count: Option<u32>,
    pub duration_ms: Option<u64>,
    pub byte_length: usize,
    pub text: Option<String>,
    pub truncated: bool,
    pub cache_hit: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFilePreviewSnapshot {
    pub id: String,
    pub request: NativeFilePreviewRequest,
    pub state: NativeFilePreviewStatus,
    pub duration_ms: f64,
    pub result: Option<NativeFilePreviewDescriptor>,
    pub error: Option<NativeFilesystemError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFilePreviewRelease {
    pub released: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFilePreviewDiagnostics {
    pub active_jobs: usize,
    pub retained_jobs: usize,
    pub retained_result_bytes: usize,
    pub cache_entries: usize,
    pub cache_bytes: usize,
    pub max_active_jobs: usize,
    pub cache_max_entries: usize,
    pub cache_max_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct FileIdentity {
    path: String,
    size: u64,
    modified_nanos: u128,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CacheKey {
    identity: FileIdentity,
    mode: NativeFilePreviewMode,
    width: u32,
    height: u32,
    decoder_version: u8,
}

#[derive(Clone)]
struct ImageResult {
    bytes: Arc<Vec<u8>>,
    width: u32,
    height: u32,
    source_width: u32,
    source_height: u32,
    page_count: Option<u32>,
    duration_ms: Option<u64>,
    cache_hit: bool,
}

#[derive(Clone)]
enum PreviewResult {
    Image(ImageResult),
    Text { text: String, truncated: bool },
}

impl PreviewResult {
    fn descriptor(&self) -> NativeFilePreviewDescriptor {
        match self {
            Self::Image(image) => NativeFilePreviewDescriptor {
                kind: NativeFilePreviewKind::Image,
                mime_type: "image/png".to_string(),
                width: Some(image.width),
                height: Some(image.height),
                source_width: Some(image.source_width),
                source_height: Some(image.source_height),
                page_count: image.page_count,
                duration_ms: image.duration_ms,
                byte_length: image.bytes.len(),
                text: None,
                truncated: false,
                cache_hit: image.cache_hit,
            },
            Self::Text { text, truncated } => NativeFilePreviewDescriptor {
                kind: NativeFilePreviewKind::Text,
                mime_type: "text/plain; charset=utf-8".to_string(),
                width: None,
                height: None,
                source_width: None,
                source_height: None,
                page_count: None,
                duration_ms: None,
                byte_length: text.len(),
                text: Some(text.clone()),
                truncated: *truncated,
                cache_hit: false,
            },
        }
    }

    fn retained_bytes(&self) -> usize {
        match self {
            Self::Image(image) => image.bytes.len(),
            Self::Text { text, .. } => text.len(),
        }
    }
}

struct PreviewProgress {
    state: NativeFilePreviewStatus,
    result: Option<PreviewResult>,
    error: Option<NativeFilesystemError>,
    finished_at: Option<Instant>,
}

struct PreviewJob {
    id: String,
    request: NativeFilePreviewRequest,
    started_at: Instant,
    cancelled: AtomicBool,
    released: AtomicBool,
    progress: Mutex<PreviewProgress>,
}

struct CacheEntry {
    image: ImageResult,
    last_used: u64,
}

#[derive(Default)]
struct ThumbnailCache {
    entries: HashMap<CacheKey, CacheEntry>,
    bytes: usize,
    clock: u64,
}

impl ThumbnailCache {
    fn get(&mut self, key: &CacheKey) -> Option<ImageResult> {
        self.clock = self.clock.saturating_add(1);
        let entry = self.entries.get_mut(key)?;
        entry.last_used = self.clock;
        let mut result = entry.image.clone();
        result.cache_hit = true;
        Some(result)
    }

    fn insert(&mut self, key: CacheKey, mut image: ImageResult) {
        let stale = self
            .entries
            .keys()
            .filter(|existing| {
                existing.identity.path == key.identity.path
                    && !(existing.identity == key.identity
                        && existing.mode == key.mode
                        && existing.width == key.width
                        && existing.height == key.height)
            })
            .cloned()
            .collect::<Vec<_>>();
        for stale_key in stale {
            if let Some(entry) = self.entries.remove(&stale_key) {
                self.bytes = self.bytes.saturating_sub(entry.image.bytes.len());
            }
        }
        if image.bytes.len() > CACHE_MAX_ITEM_BYTES {
            return;
        }
        self.clock = self.clock.saturating_add(1);
        image.cache_hit = false;
        if let Some(previous) = self.entries.remove(&key) {
            self.bytes = self.bytes.saturating_sub(previous.image.bytes.len());
        }
        self.bytes = self.bytes.saturating_add(image.bytes.len());
        self.entries.insert(
            key,
            CacheEntry {
                image,
                last_used: self.clock,
            },
        );
        while self.entries.len() > CACHE_MAX_ENTRIES || self.bytes > CACHE_MAX_BYTES {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.bytes = self.bytes.saturating_sub(removed.image.bytes.len());
            }
        }
    }
}

#[derive(Clone, Default)]
pub struct NativeFilePreviewState {
    jobs: Arc<Mutex<HashMap<String, Arc<PreviewJob>>>>,
    cache: Arc<Mutex<ThumbnailCache>>,
}

fn preview_error(code: NativeFilesystemErrorCode, message: &'static str) -> NativeFilesystemError {
    NativeFilesystemError::new(code, message)
}

fn random_id() -> Result<String, NativeFilesystemError> {
    let mut bytes = [0_u8; 16];
    random_fill(&mut bytes).map_err(|_| {
        preview_error(
            NativeFilesystemErrorCode::IoError,
            "Windows could not initialize the native file preview.",
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

fn terminal(state: NativeFilePreviewStatus) -> bool {
    matches!(
        state,
        NativeFilePreviewStatus::Completed
            | NativeFilePreviewStatus::Cancelled
            | NativeFilePreviewStatus::Failed
    )
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

fn extension(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension.is_empty() && path.file_name().and_then(|value| value.to_str()) == Some(".env") {
        "env".to_string()
    } else {
        extension
    }
}

fn supported_image_extension(value: &str) -> bool {
    matches!(value, "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp")
}

fn supported_pdf_extension(value: &str) -> bool {
    value == "pdf"
}

fn supported_video_extension(value: &str) -> bool {
    matches!(
        value,
        "avi" | "m4v" | "mkv" | "mov" | "mp4" | "webm" | "wmv"
    )
}

fn supported_text_extension(value: &str) -> bool {
    matches!(
        value,
        "txt"
            | "md"
            | "json"
            | "yaml"
            | "yml"
            | "xml"
            | "csv"
            | "log"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "css"
            | "scss"
            | "html"
            | "htm"
            | "rs"
            | "py"
            | "java"
            | "c"
            | "h"
            | "cpp"
            | "hpp"
            | "go"
            | "sql"
            | "toml"
            | "ini"
            | "conf"
            | "env"
            | "sh"
            | "ps1"
            | "bat"
            | "cmd"
    )
}

fn size_bucket(mode: NativeFilePreviewMode, width: u32, height: u32) -> Option<(u32, u32)> {
    let requested = width.max(height);
    let buckets: &[u32] = match mode {
        NativeFilePreviewMode::Thumbnail => &[64, 96, 128, 256],
        NativeFilePreviewMode::ImagePreview => &[256, 512, 768, 1024],
        NativeFilePreviewMode::TextPreview => return Some((0, 0)),
    };
    if requested == 0 || requested > *buckets.last()? {
        return None;
    }
    let bucket = buckets
        .iter()
        .copied()
        .find(|bucket| requested <= *bucket)?;
    Some((bucket, bucket))
}

fn file_identity(path: &Path, metadata: &fs::Metadata) -> FileIdentity {
    let modified_nanos = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_nanos());
    FileIdentity {
        path: path_string(path),
        size: metadata.len(),
        modified_nanos,
    }
}

fn validate_request(
    mut request: NativeFilePreviewRequest,
) -> Result<(NativeFilePreviewRequest, PathBuf, FileIdentity), NativeFilesystemError> {
    let public_path = validate_path(&request.path)?;
    let path = backend_path(&public_path);
    let metadata = fs::metadata(&path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The selected file could not be inspected.")
    })?;
    if !metadata.is_file() {
        return Err(preview_error(
            NativeFilesystemErrorCode::PreviewUnsupported,
            "Preview is available only for supported files.",
        ));
    }
    let file_extension = extension(&public_path);
    match request.mode {
        NativeFilePreviewMode::Thumbnail | NativeFilePreviewMode::ImagePreview => {
            if !supported_image_extension(&file_extension)
                && !supported_pdf_extension(&file_extension)
                && !supported_video_extension(&file_extension)
            {
                return Err(preview_error(
                    NativeFilesystemErrorCode::PreviewUnsupported,
                    "This file format is not supported by the safe preview decoder.",
                ));
            }
            let maximum = if supported_pdf_extension(&file_extension) {
                Some(native_pdf_preview::max_source_bytes())
            } else if supported_image_extension(&file_extension) {
                Some(MAX_IMAGE_INPUT_BYTES)
            } else {
                None
            };
            if maximum.is_some_and(|maximum| metadata.len() > maximum) {
                return Err(preview_error(
                    NativeFilesystemErrorCode::PreviewUnsupported,
                    "This file is too large for an automatic safe preview.",
                ));
            }
        }
        NativeFilePreviewMode::TextPreview => {
            if !supported_text_extension(&file_extension) {
                return Err(preview_error(
                    NativeFilesystemErrorCode::PreviewUnsupported,
                    "This file type does not have a safe text preview.",
                ));
            }
        }
    }
    let (width, height) = size_bucket(
        request.mode,
        request.requested_width,
        request.requested_height,
    )
    .ok_or_else(|| {
        preview_error(
            NativeFilesystemErrorCode::InvalidPath,
            "The requested preview dimensions are outside the supported size buckets.",
        )
    })?;
    request.path = path_string(&public_path);
    request.requested_width = width;
    request.requested_height = height;
    let identity = file_identity(&public_path, &metadata);
    Ok((request, path, identity))
}

fn check_cancelled(job: &PreviewJob) -> Result<(), NativeFilesystemError> {
    if job.cancelled.load(Ordering::Acquire) || job.released.load(Ordering::Acquire) {
        Err(preview_error(
            NativeFilesystemErrorCode::OperationCancelled,
            "The file preview was cancelled.",
        ))
    } else {
        Ok(())
    }
}

fn decode_image(
    job: &PreviewJob,
    path: &Path,
    identity: &FileIdentity,
    cache: &Arc<Mutex<ThumbnailCache>>,
) -> Result<PreviewResult, NativeFilesystemError> {
    let key = CacheKey {
        identity: identity.clone(),
        mode: job.request.mode,
        width: job.request.requested_width,
        height: job.request.requested_height,
        decoder_version: DECODER_VERSION,
    };
    if let Ok(mut cache) = cache.lock() {
        if let Some(image) = cache.get(&key) {
            return Ok(PreviewResult::Image(image));
        }
    }
    check_cancelled(job)?;
    let file = File::open(path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The selected image could not be opened.")
    })?;
    let mut reader = ImageReader::new(BufReader::new(file))
        .with_guessed_format()
        .map_err(|_| {
            preview_error(
                NativeFilesystemErrorCode::DecodeFailed,
                "The image could not be decoded safely.",
            )
        })?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_IMAGE_ALLOC_BYTES);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| {
        preview_error(
            NativeFilesystemErrorCode::DecodeFailed,
            "The image could not be decoded safely.",
        )
    })?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| {
        preview_error(
            NativeFilesystemErrorCode::DecodeFailed,
            "The image could not be decoded safely.",
        )
    })?;
    check_cancelled(job)?;
    image.apply_orientation(orientation);
    let source_width = image.width();
    let source_height = image.height();
    let filter = match job.request.mode {
        NativeFilePreviewMode::Thumbnail => FilterType::Triangle,
        NativeFilePreviewMode::ImagePreview => FilterType::Lanczos3,
        NativeFilePreviewMode::TextPreview => unreachable!(),
    };
    let resized = image.resize(
        job.request.requested_width,
        job.request.requested_height,
        filter,
    );
    drop(image);
    check_cancelled(job)?;
    let mut encoded = Cursor::new(Vec::new());
    resized
        .write_to(&mut encoded, ImageFormat::Png)
        .map_err(|_| {
            preview_error(
                NativeFilesystemErrorCode::DecodeFailed,
                "The image preview could not be encoded safely.",
            )
        })?;
    let bytes = encoded.into_inner();
    if bytes.len() > MAX_ENCODED_RESULT_BYTES {
        return Err(preview_error(
            NativeFilesystemErrorCode::PreviewUnsupported,
            "The generated image preview exceeded the safe output limit.",
        ));
    }
    let current = fs::metadata(path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The selected image changed during preview.")
    })?;
    let public_path = validate_path(&job.request.path)?;
    if file_identity(&public_path, &current) != *identity {
        return Err(preview_error(
            NativeFilesystemErrorCode::FileChanged,
            "The selected image changed while its preview was being generated.",
        ));
    }
    let result = ImageResult {
        bytes: Arc::new(bytes),
        width: resized.width(),
        height: resized.height(),
        source_width,
        source_height,
        page_count: None,
        duration_ms: None,
        cache_hit: false,
    };
    if let Ok(mut cache) = cache.lock() {
        cache.insert(key, result.clone());
    }
    Ok(PreviewResult::Image(result))
}

fn decode_pdf(
    job: &PreviewJob,
    path: &Path,
    identity: &FileIdentity,
    cache: &Arc<Mutex<ThumbnailCache>>,
) -> Result<PreviewResult, NativeFilesystemError> {
    let key = CacheKey {
        identity: identity.clone(),
        mode: job.request.mode,
        width: job.request.requested_width,
        height: job.request.requested_height,
        decoder_version: DECODER_VERSION,
    };
    if let Ok(mut cache) = cache.lock() {
        if let Some(image) = cache.get(&key) {
            return Ok(PreviewResult::Image(image));
        }
    }
    check_cancelled(job)?;
    let rendered = native_pdf_preview::render_first_page(
        path,
        identity.size,
        job.request.requested_width,
        job.request.requested_height,
        || job.cancelled.load(Ordering::Acquire) || job.released.load(Ordering::Acquire),
    )
    .map_err(|error| match error {
        PdfPreviewError::Cancelled => preview_error(
            NativeFilesystemErrorCode::OperationCancelled,
            "The PDF preview was cancelled.",
        ),
        PdfPreviewError::Encrypted => preview_error(
            NativeFilesystemErrorCode::PdfEncrypted,
            "Password-protected PDFs are not previewed in Files.",
        ),
        PdfPreviewError::Unsupported => preview_error(
            NativeFilesystemErrorCode::PreviewUnsupported,
            "This PDF cannot be rendered within the safe preview limits.",
        ),
        PdfPreviewError::TimedOut => preview_error(
            NativeFilesystemErrorCode::PreviewUnsupported,
            "This PDF took too long to render safely.",
        ),
        PdfPreviewError::Invalid => preview_error(
            NativeFilesystemErrorCode::DecodeFailed,
            "The PDF could not be decoded safely.",
        ),
    })?;
    check_cancelled(job)?;
    if rendered.bytes.len() > MAX_ENCODED_RESULT_BYTES {
        return Err(preview_error(
            NativeFilesystemErrorCode::PreviewUnsupported,
            "The generated PDF preview exceeded the safe output limit.",
        ));
    }
    let current = fs::metadata(path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The selected PDF changed during preview.")
    })?;
    let public_path = validate_path(&job.request.path)?;
    if file_identity(&public_path, &current) != *identity {
        return Err(preview_error(
            NativeFilesystemErrorCode::FileChanged,
            "The selected PDF changed while its preview was being generated.",
        ));
    }
    let result = ImageResult {
        bytes: Arc::new(rendered.bytes),
        width: rendered.width,
        height: rendered.height,
        source_width: rendered.source_width,
        source_height: rendered.source_height,
        page_count: Some(rendered.page_count),
        duration_ms: None,
        cache_hit: false,
    };
    if let Ok(mut cache) = cache.lock() {
        cache.insert(key, result.clone());
    }
    Ok(PreviewResult::Image(result))
}

fn decode_video(
    job: &PreviewJob,
    path: &Path,
    identity: &FileIdentity,
    cache: &Arc<Mutex<ThumbnailCache>>,
) -> Result<PreviewResult, NativeFilesystemError> {
    let key = CacheKey {
        identity: identity.clone(),
        mode: job.request.mode,
        width: job.request.requested_width,
        height: job.request.requested_height,
        decoder_version: DECODER_VERSION,
    };
    if let Ok(mut cache) = cache.lock() {
        if let Some(image) = cache.get(&key) {
            return Ok(PreviewResult::Image(image));
        }
    }
    check_cancelled(job)?;
    let rendered = native_video_preview::render_poster(
        path,
        identity.size,
        job.request.requested_width,
        job.request.requested_height,
        || job.cancelled.load(Ordering::Acquire) || job.released.load(Ordering::Acquire),
    )
    .map_err(|error| match error {
        VideoPreviewError::Cancelled => preview_error(
            NativeFilesystemErrorCode::OperationCancelled,
            "The video preview was cancelled.",
        ),
        VideoPreviewError::Unsupported => preview_error(
            NativeFilesystemErrorCode::PreviewUnsupported,
            "This video cannot be decoded by the available Windows codecs.",
        ),
        VideoPreviewError::TimedOut => preview_error(
            NativeFilesystemErrorCode::PreviewUnsupported,
            "This video took too long to decode safely.",
        ),
        VideoPreviewError::Invalid => preview_error(
            NativeFilesystemErrorCode::DecodeFailed,
            "The video could not be decoded safely.",
        ),
    })?;
    check_cancelled(job)?;
    if rendered.bytes.len() > MAX_ENCODED_RESULT_BYTES {
        return Err(preview_error(
            NativeFilesystemErrorCode::PreviewUnsupported,
            "The generated video poster exceeded the safe output limit.",
        ));
    }
    let current = fs::metadata(path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The selected video changed during preview.")
    })?;
    let public_path = validate_path(&job.request.path)?;
    if file_identity(&public_path, &current) != *identity {
        return Err(preview_error(
            NativeFilesystemErrorCode::FileChanged,
            "The selected video changed while its preview was being generated.",
        ));
    }
    let result = ImageResult {
        bytes: Arc::new(rendered.bytes),
        width: rendered.width,
        height: rendered.height,
        source_width: rendered.source_width,
        source_height: rendered.source_height,
        page_count: None,
        duration_ms: Some(rendered.duration_ms),
        cache_hit: false,
    };
    if let Ok(mut cache) = cache.lock() {
        cache.insert(key, result.clone());
    }
    Ok(PreviewResult::Image(result))
}

fn looks_binary(bytes: &[u8]) -> bool {
    if bytes.iter().any(|byte| *byte == 0) {
        return true;
    }
    let controls = bytes
        .iter()
        .filter(|byte| **byte < 0x20 && !matches!(**byte, b'\t' | b'\n' | b'\r' | 0x0c))
        .count();
    controls.saturating_mul(100) > bytes.len().max(1)
}

fn decode_text(
    job: &PreviewJob,
    path: &Path,
    identity: &FileIdentity,
) -> Result<PreviewResult, NativeFilesystemError> {
    check_cancelled(job)?;
    let file = File::open(path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The selected text file could not be opened.")
    })?;
    let mut bytes = Vec::with_capacity(TEXT_PREVIEW_BYTES + 1);
    file.take((TEXT_PREVIEW_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            NativeFilesystemError::from_io(&error, "The selected text file could not be read.")
        })?;
    check_cancelled(job)?;
    let truncated = bytes.len() > TEXT_PREVIEW_BYTES || identity.size > TEXT_PREVIEW_BYTES as u64;
    bytes.truncate(TEXT_PREVIEW_BYTES);
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        bytes.drain(..3);
    }
    if looks_binary(&bytes) {
        return Err(preview_error(
            NativeFilesystemErrorCode::PreviewUnsupported,
            "This file appears to contain binary data and was not shown as text.",
        ));
    }
    let text = String::from_utf8(bytes).map_err(|_| {
        preview_error(
            NativeFilesystemErrorCode::PreviewUnsupported,
            "This file is not valid UTF-8 text and was not shown as text.",
        )
    })?;
    let current = fs::metadata(path).map_err(|error| {
        NativeFilesystemError::from_io(&error, "The selected text file changed during preview.")
    })?;
    let public_path = validate_path(&job.request.path)?;
    if file_identity(&public_path, &current) != *identity {
        return Err(preview_error(
            NativeFilesystemErrorCode::FileChanged,
            "The selected text file changed while its preview was being generated.",
        ));
    }
    Ok(PreviewResult::Text { text, truncated })
}

fn run_job(
    job: &PreviewJob,
    path: &Path,
    identity: &FileIdentity,
    cache: &Arc<Mutex<ThumbnailCache>>,
) -> Result<PreviewResult, NativeFilesystemError> {
    check_cancelled(job)?;
    match job.request.mode {
        NativeFilePreviewMode::Thumbnail | NativeFilePreviewMode::ImagePreview => {
            if supported_pdf_extension(&extension(path)) {
                decode_pdf(job, path, identity, cache)
            } else if supported_video_extension(&extension(path)) {
                decode_video(job, path, identity, cache)
            } else {
                decode_image(job, path, identity, cache)
            }
        }
        NativeFilePreviewMode::TextPreview => decode_text(job, path, identity),
    }
}

fn finish_job(job: &PreviewJob, result: Result<PreviewResult, NativeFilesystemError>) {
    let Ok(mut progress) = job.progress.lock() else {
        return;
    };
    if job.cancelled.load(Ordering::Acquire) || job.released.load(Ordering::Acquire) {
        progress.state = NativeFilePreviewStatus::Cancelled;
        progress.result = None;
        progress.error = None;
    } else {
        match result {
            Ok(result) => {
                progress.state = NativeFilePreviewStatus::Completed;
                progress.result = Some(result);
                progress.error = None;
            }
            Err(error) if error.code == NativeFilesystemErrorCode::OperationCancelled => {
                progress.state = NativeFilePreviewStatus::Cancelled;
                progress.result = None;
                progress.error = None;
            }
            Err(error) => {
                progress.state = NativeFilePreviewStatus::Failed;
                progress.result = None;
                progress.error = Some(error);
            }
        }
    }
    progress.finished_at = Some(Instant::now());
}

impl PreviewJob {
    fn snapshot(&self) -> Result<NativeFilePreviewSnapshot, NativeFilesystemError> {
        let progress = self.progress.lock().map_err(|_| {
            preview_error(
                NativeFilesystemErrorCode::IoError,
                "The native preview state is unavailable.",
            )
        })?;
        Ok(NativeFilePreviewSnapshot {
            id: self.id.clone(),
            request: self.request.clone(),
            state: progress.state,
            duration_ms: self.started_at.elapsed().as_secs_f64() * 1_000.0,
            result: progress.result.as_ref().map(PreviewResult::descriptor),
            error: progress.error.clone(),
        })
    }
}

impl NativeFilePreviewState {
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
                .is_none_or(|finished| finished.elapsed() < TERMINAL_JOB_TTL)
        });
        if jobs.len() <= MAX_JOB_RECORDS {
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
        let remove_count = jobs.len().saturating_sub(MAX_JOB_RECORDS);
        for (id, _) in terminal_jobs.into_iter().take(remove_count) {
            jobs.remove(&id);
        }
    }

    fn start(
        &self,
        request: NativeFilePreviewRequest,
    ) -> Result<NativeFilePreviewSnapshot, NativeFilesystemError> {
        let (request, path, identity) = validate_request(request)?;
        self.prune();
        let mut jobs = self.jobs.lock().map_err(|_| {
            preview_error(
                NativeFilesystemErrorCode::IoError,
                "The native preview service is unavailable.",
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
        if active >= MAX_ACTIVE_JOBS {
            return Err(preview_error(
                NativeFilesystemErrorCode::IoError,
                "The native preview worker limit has been reached.",
            ));
        }
        let id = random_id()?;
        let job = Arc::new(PreviewJob {
            id: id.clone(),
            request,
            started_at: Instant::now(),
            cancelled: AtomicBool::new(false),
            released: AtomicBool::new(false),
            progress: Mutex::new(PreviewProgress {
                state: NativeFilePreviewStatus::Queued,
                result: None,
                error: None,
                finished_at: None,
            }),
        });
        let initial = job.snapshot()?;
        jobs.insert(id.clone(), Arc::clone(&job));
        drop(jobs);
        let state = self.clone();
        let cache = Arc::clone(&self.cache);
        tauri::async_runtime::spawn_blocking(move || {
            if let Ok(mut progress) = job.progress.lock() {
                progress.state = NativeFilePreviewStatus::Running;
            }
            let result = run_job(&job, &path, &identity, &cache);
            finish_job(&job, result);
            if job.released.load(Ordering::Acquire) {
                if let Ok(mut jobs) = state.jobs.lock() {
                    jobs.remove(&id);
                }
            }
        });
        Ok(initial)
    }

    fn job(&self, id: &str) -> Result<Arc<PreviewJob>, NativeFilesystemError> {
        validate_id(id)?;
        self.prune();
        self.jobs
            .lock()
            .map_err(|_| {
                preview_error(
                    NativeFilesystemErrorCode::IoError,
                    "The native preview service is unavailable.",
                )
            })?
            .get(id)
            .cloned()
            .ok_or_else(|| {
                preview_error(
                    NativeFilesystemErrorCode::NotFound,
                    "The native preview is no longer available.",
                )
            })
    }

    fn get(&self, id: &str) -> Result<NativeFilePreviewSnapshot, NativeFilesystemError> {
        self.job(id)?.snapshot()
    }

    fn bytes(&self, id: &str) -> Result<Arc<Vec<u8>>, NativeFilesystemError> {
        let job = self.job(id)?;
        let progress = job.progress.lock().map_err(|_| {
            preview_error(
                NativeFilesystemErrorCode::IoError,
                "The native preview state is unavailable.",
            )
        })?;
        match progress.result.as_ref() {
            Some(PreviewResult::Image(image))
                if progress.state == NativeFilePreviewStatus::Completed =>
            {
                Ok(Arc::clone(&image.bytes))
            }
            _ => Err(preview_error(
                NativeFilesystemErrorCode::PreviewUnsupported,
                "The native preview does not contain image bytes.",
            )),
        }
    }

    fn cancel(&self, id: &str) -> Result<NativeFilePreviewSnapshot, NativeFilesystemError> {
        let job = self.job(id)?;
        job.cancelled.store(true, Ordering::Release);
        job.snapshot()
    }

    fn release(&self, id: &str) -> Result<NativeFilePreviewRelease, NativeFilesystemError> {
        validate_id(id)?;
        let mut jobs = self.jobs.lock().map_err(|_| {
            preview_error(
                NativeFilesystemErrorCode::IoError,
                "The native preview service is unavailable.",
            )
        })?;
        let job = jobs.get(id).cloned().ok_or_else(|| {
            preview_error(
                NativeFilesystemErrorCode::NotFound,
                "The native preview is no longer available.",
            )
        })?;
        job.cancelled.store(true, Ordering::Release);
        job.released.store(true, Ordering::Release);
        let finished = job.progress.lock().is_ok_and(|mut progress| {
            progress.result = None;
            terminal(progress.state)
        });
        if finished {
            jobs.remove(id);
        }
        Ok(NativeFilePreviewRelease { released: true })
    }

    fn diagnostics(&self) -> NativeFilePreviewDiagnostics {
        self.prune();
        let (active_jobs, retained_jobs, retained_result_bytes) = self
            .jobs
            .lock()
            .map(|jobs| {
                let mut active = 0;
                let mut retained = 0;
                for job in jobs.values() {
                    if let Ok(progress) = job.progress.lock() {
                        if !terminal(progress.state) {
                            active += 1;
                        }
                        retained += progress
                            .result
                            .as_ref()
                            .map_or(0, PreviewResult::retained_bytes);
                    }
                }
                (active, jobs.len(), retained)
            })
            .unwrap_or_default();
        let (cache_entries, cache_bytes) = self
            .cache
            .lock()
            .map(|cache| (cache.entries.len(), cache.bytes))
            .unwrap_or_default();
        NativeFilePreviewDiagnostics {
            active_jobs,
            retained_jobs,
            retained_result_bytes,
            cache_entries,
            cache_bytes,
            max_active_jobs: MAX_ACTIVE_JOBS,
            cache_max_entries: CACHE_MAX_ENTRIES,
            cache_max_bytes: CACHE_MAX_BYTES,
        }
    }
}

impl Drop for NativeFilePreviewState {
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
pub fn start_native_file_preview(
    request: NativeFilePreviewRequest,
    state: State<'_, NativeFilePreviewState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFilePreviewSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.start(request)))
}

#[tauri::command]
pub fn get_native_file_preview(
    id: String,
    state: State<'_, NativeFilePreviewState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFilePreviewSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.get(&id)))
}

#[tauri::command]
pub fn take_native_file_preview_bytes(
    id: String,
    state: State<'_, NativeFilePreviewState>,
    caller: Webview,
) -> Result<Response, String> {
    require_trusted_caller(&caller)?;
    state
        .bytes(&id)
        .map(|bytes| Response::new(bytes.as_ref().clone()))
        .map_err(|error| error.message)
}

#[tauri::command]
pub fn cancel_native_file_preview(
    id: String,
    state: State<'_, NativeFilePreviewState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFilePreviewSnapshot>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.cancel(&id)))
}

#[tauri::command]
pub fn release_native_file_preview(
    id: String,
    state: State<'_, NativeFilePreviewState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFilePreviewRelease>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(state.release(&id)))
}

#[tauri::command]
pub fn get_native_file_preview_diagnostics(
    state: State<'_, NativeFilePreviewState>,
    caller: Webview,
) -> Result<NativeFilesystemResponse<NativeFilePreviewDiagnostics>, String> {
    require_trusted_caller(&caller)?;
    Ok(NativeFilesystemResponse::from_result(Ok(
        state.diagnostics()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};
    use std::{thread, time::SystemTime};

    fn fixture(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("NammuFilesF4ATest-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn request(path: &Path, mode: NativeFilePreviewMode, size: u32) -> NativeFilePreviewRequest {
        NativeFilePreviewRequest {
            path: path_string(path),
            mode,
            requested_width: size,
            requested_height: size,
        }
    }

    fn wait(state: &NativeFilePreviewState, id: &str) -> NativeFilePreviewSnapshot {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let snapshot = state.get(id).unwrap();
            if terminal(snapshot.state) {
                return snapshot;
            }
            assert!(Instant::now() < deadline, "preview timed out");
            thread::sleep(Duration::from_millis(2));
        }
    }

    fn write_png(path: &Path, width: u32, height: u32, color: [u8; 4]) {
        let image = ImageBuffer::from_pixel(width, height, Rgba(color));
        DynamicImage::ImageRgba8(image).save(path).unwrap();
    }

    #[test]
    fn decodes_bounded_images_and_uses_metadata_cache_identity() {
        let root = fixture("image-cache");
        let path = root.join("sample image.png");
        write_png(&path, 320, 180, [20, 100, 220, 255]);
        let state = NativeFilePreviewState::default();
        let first = state
            .start(request(&path, NativeFilePreviewMode::Thumbnail, 96))
            .unwrap();
        let first = wait(&state, &first.id);
        let descriptor = first.result.unwrap();
        assert_eq!(descriptor.kind, NativeFilePreviewKind::Image);
        assert_eq!((descriptor.width, descriptor.height), (Some(96), Some(54)));
        assert_eq!(
            (descriptor.source_width, descriptor.source_height),
            (Some(320), Some(180))
        );
        assert!(!descriptor.cache_hit);
        assert!(state.bytes(&first.id).unwrap().starts_with(b"\x89PNG"));
        state.release(&first.id).unwrap();

        let warm = state
            .start(request(&path, NativeFilePreviewMode::Thumbnail, 96))
            .unwrap();
        let warm = wait(&state, &warm.id);
        assert!(warm.result.unwrap().cache_hit);
        state.release(&warm.id).unwrap();

        thread::sleep(Duration::from_millis(5));
        write_png(&path, 200, 200, [220, 40, 60, 255]);
        let changed = state
            .start(request(&path, NativeFilePreviewMode::Thumbnail, 96))
            .unwrap();
        let changed = wait(&state, &changed.id);
        let descriptor = changed.result.unwrap();
        assert!(!descriptor.cache_hit);
        assert_eq!(
            (descriptor.source_width, descriptor.source_height),
            (Some(200), Some(200))
        );
        state.release(&changed.id).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn previews_utf8_text_with_bom_and_truncates_large_files() {
        let root = fixture("text");
        let text = root.join("notes.md");
        fs::write(&text, b"\xef\xbb\xbfHello, Nammu").unwrap();
        let state = NativeFilePreviewState::default();
        let started = state
            .start(request(&text, NativeFilePreviewMode::TextPreview, 0))
            .unwrap();
        let result = wait(&state, &started.id).result.unwrap();
        assert_eq!(result.text.as_deref(), Some("Hello, Nammu"));
        assert!(!result.truncated);
        state.release(&started.id).unwrap();

        let large = root.join("large.log");
        fs::write(&large, vec![b'a'; TEXT_PREVIEW_BYTES + 64]).unwrap();
        let started = state
            .start(request(&large, NativeFilePreviewMode::TextPreview, 0))
            .unwrap();
        let result = wait(&state, &started.id).result.unwrap();
        assert!(result.truncated);
        assert_eq!(result.text.unwrap().len(), TEXT_PREVIEW_BYTES);
        state.release(&started.id).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_binary_text_corrupt_images_and_unsafe_dimensions() {
        let root = fixture("hostile");
        let binary = root.join("binary.txt");
        fs::write(&binary, [0_u8, 1, 2, 3, 4]).unwrap();
        let corrupt = root.join("corrupt.png");
        fs::write(&corrupt, b"not a png").unwrap();
        let state = NativeFilePreviewState::default();
        let binary = state
            .start(request(&binary, NativeFilePreviewMode::TextPreview, 0))
            .unwrap();
        assert_eq!(
            wait(&state, &binary.id).state,
            NativeFilePreviewStatus::Failed
        );
        state.release(&binary.id).unwrap();
        let corrupt = state
            .start(request(&corrupt, NativeFilePreviewMode::Thumbnail, 64))
            .unwrap();
        assert_eq!(
            wait(&state, &corrupt.id).state,
            NativeFilePreviewStatus::Failed
        );
        state.release(&corrupt.id).unwrap();
        assert_eq!(
            state
                .start(request(
                    &root.join("corrupt.png"),
                    NativeFilePreviewMode::Thumbnail,
                    50_000
                ))
                .unwrap_err()
                .code,
            NativeFilesystemErrorCode::InvalidPath
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn supports_unicode_and_long_paths_and_cleans_jobs() {
        let root = fixture("long-path");
        let mut nested = root.join("Unicode à¤¹à¤¿à¤‚à¤¦à¥€ and spaces");
        for index in 0..9 {
            nested = nested.join(format!("segment-{index:02}-nammu-preview-long-path"));
        }
        fs::create_dir_all(backend_path(&nested)).unwrap();
        let image = nested.join("preview image.png");
        write_png(&backend_path(&image), 64, 64, [1, 2, 3, 255]);
        assert!(path_string(&image).encode_utf16().count() > 260);
        let state = NativeFilePreviewState::default();
        let started = state
            .start(request(&image, NativeFilePreviewMode::ImagePreview, 512))
            .unwrap();
        assert_eq!(
            wait(&state, &started.id).state,
            NativeFilePreviewStatus::Completed
        );
        state.release(&started.id).unwrap();
        assert_eq!(state.diagnostics().retained_jobs, 0);
        fs::remove_dir_all(backend_path(&root)).unwrap();
    }
}
