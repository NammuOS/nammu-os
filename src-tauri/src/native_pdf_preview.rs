//! Bounded, first-page-only PDF rasterization for the Files preview pipeline.
//!
//! Windows owns the PDF decoder and keeps it serviced with the OS. Nammu does
//! not ship a PDF engine, invoke an external process, or expose PDF bytes to a
//! web surface. This module intentionally has no viewer/editor responsibilities.

use std::{
    path::Path,
    thread,
    time::{Duration, Instant},
};

const MAX_PDF_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PDF_PAGE_DIMENSION_DIPS: f32 = 200_000.0;
const MAX_PDF_RENDER_PIXELS: u64 = 1_048_576;
const PDF_OPEN_TIMEOUT: Duration = Duration::from_secs(6);
const PDF_RENDER_TIMEOUT: Duration = Duration::from_secs(8);
const PDF_IO_TIMEOUT: Duration = Duration::from_secs(2);
const POLL_INTERVAL: Duration = Duration::from_millis(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PdfPreviewError {
    Cancelled,
    Encrypted,
    Invalid,
    Unsupported,
    TimedOut,
}

#[derive(Debug)]
pub(crate) struct PdfPreviewImage {
    pub(crate) bytes: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) source_width: u32,
    pub(crate) source_height: u32,
    pub(crate) page_count: u32,
}

pub(crate) fn max_source_bytes() -> u64 {
    MAX_PDF_SOURCE_BYTES
}

#[cfg(windows)]
mod windows_renderer {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Data::Pdf::{PdfDocument, PdfPageRenderOptions},
        Graphics::Imaging::BitmapEncoder,
        Storage::{
            FileAccessMode,
            Streams::{DataReader, IRandomAccessStream, InMemoryRandomAccessStream},
        },
        Win32::System::WinRT::{
            CreateRandomAccessStreamOnFile, RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED,
        },
        UI::Color,
    };
    use windows_core::HRESULT;
    use windows_future::{AsyncStatus, IAsyncAction, IAsyncOperation};

    const ERROR_WRONG_PASSWORD: HRESULT = HRESULT(0x8007_052b_u32 as i32);

    struct WinRtApartment(bool);

    impl WinRtApartment {
        fn initialize() -> Result<Self, PdfPreviewError> {
            // Preview jobs run on Tauri's blocking pool. Each worker initializes
            // WinRT for its own thread and balances successful initialization.
            match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
                Ok(()) => Ok(Self(true)),
                // RPC_E_CHANGED_MODE means the thread was already initialized in
                // another apartment. The PDF WinRT types used here are agile.
                Err(error) if error.code().0 == 0x8001_0106_u32 as i32 => Ok(Self(false)),
                Err(_) => Err(PdfPreviewError::Unsupported),
            }
        }
    }

    impl Drop for WinRtApartment {
        fn drop(&mut self) {
            if self.0 {
                unsafe { RoUninitialize() };
            }
        }
    }

    fn map_pdf_error(error: &windows_core::Error) -> PdfPreviewError {
        if error.code() == ERROR_WRONG_PASSWORD {
            PdfPreviewError::Encrypted
        } else {
            PdfPreviewError::Invalid
        }
    }

    fn wait_operation<T: windows_core::RuntimeType>(
        operation: &IAsyncOperation<T>,
        timeout: Duration,
        cancelled: &impl Fn() -> bool,
    ) -> Result<T, PdfPreviewError> {
        let deadline = Instant::now() + timeout;
        loop {
            if cancelled() {
                let _ = operation.Cancel();
                return Err(PdfPreviewError::Cancelled);
            }
            match operation.Status().map_err(|_| PdfPreviewError::Invalid)? {
                AsyncStatus::Started if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
                AsyncStatus::Started => {
                    let _ = operation.Cancel();
                    return Err(PdfPreviewError::TimedOut);
                }
                AsyncStatus::Completed => {
                    return operation
                        .GetResults()
                        .map_err(|error| map_pdf_error(&error))
                }
                AsyncStatus::Canceled => return Err(PdfPreviewError::Cancelled),
                AsyncStatus::Error => {
                    return operation
                        .GetResults()
                        .map_err(|error| map_pdf_error(&error))
                }
                _ => return Err(PdfPreviewError::Invalid),
            }
        }
    }

    fn wait_action(
        action: &IAsyncAction,
        timeout: Duration,
        cancelled: &impl Fn() -> bool,
    ) -> Result<(), PdfPreviewError> {
        let deadline = Instant::now() + timeout;
        loop {
            if cancelled() {
                let _ = action.Cancel();
                return Err(PdfPreviewError::Cancelled);
            }
            match action.Status().map_err(|_| PdfPreviewError::Invalid)? {
                AsyncStatus::Started if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
                AsyncStatus::Started => {
                    let _ = action.Cancel();
                    return Err(PdfPreviewError::TimedOut);
                }
                AsyncStatus::Completed => {
                    return action.GetResults().map_err(|error| map_pdf_error(&error))
                }
                AsyncStatus::Canceled => return Err(PdfPreviewError::Cancelled),
                AsyncStatus::Error => {
                    return action.GetResults().map_err(|error| map_pdf_error(&error))
                }
                _ => return Err(PdfPreviewError::Invalid),
            }
        }
    }

    pub(super) fn contained_dimensions(
        source_width: f32,
        source_height: f32,
        requested_width: u32,
        requested_height: u32,
    ) -> Result<(u32, u32), PdfPreviewError> {
        if !source_width.is_finite()
            || !source_height.is_finite()
            || source_width <= 0.0
            || source_height <= 0.0
            || source_width > MAX_PDF_PAGE_DIMENSION_DIPS
            || source_height > MAX_PDF_PAGE_DIMENSION_DIPS
        {
            return Err(PdfPreviewError::Unsupported);
        }
        let scale =
            (requested_width as f32 / source_width).min(requested_height as f32 / source_height);
        if !scale.is_finite() || scale <= 0.0 {
            return Err(PdfPreviewError::Unsupported);
        }
        let width = (source_width * scale)
            .round()
            .clamp(1.0, requested_width as f32) as u32;
        let height = (source_height * scale)
            .round()
            .clamp(1.0, requested_height as f32) as u32;
        if u64::from(width) * u64::from(height) > MAX_PDF_RENDER_PIXELS {
            return Err(PdfPreviewError::Unsupported);
        }
        Ok((width, height))
    }

    pub(crate) fn render_first_page(
        path: &Path,
        source_bytes: u64,
        requested_width: u32,
        requested_height: u32,
        cancelled: impl Fn() -> bool,
    ) -> Result<PdfPreviewImage, PdfPreviewError> {
        if source_bytes == 0 || source_bytes > MAX_PDF_SOURCE_BYTES {
            return Err(PdfPreviewError::Unsupported);
        }
        if cancelled() {
            return Err(PdfPreviewError::Cancelled);
        }
        let _apartment = WinRtApartment::initialize()?;
        // StorageFile::GetFileFromPathAsync rejects extended-length (`\\?\`)
        // paths. Opening a random-access stream through the Windows stream
        // bridge preserves long-path support without copying the PDF into RAM.
        let wide_path: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let input: IRandomAccessStream = unsafe {
            CreateRandomAccessStreamOnFile(
                PCWSTR::from_raw(wide_path.as_ptr()),
                FileAccessMode::Read.0 as u32,
            )
        }
        .map_err(|_| PdfPreviewError::Invalid)?;
        let open_operation =
            PdfDocument::LoadFromStreamAsync(&input).map_err(|error| map_pdf_error(&error))?;
        let document = wait_operation(&open_operation, PDF_OPEN_TIMEOUT, &cancelled)?;
        let page_count = document.PageCount().map_err(|_| PdfPreviewError::Invalid)?;
        if page_count == 0 {
            return Err(PdfPreviewError::Invalid);
        }
        let page = document.GetPage(0).map_err(|_| PdfPreviewError::Invalid)?;
        let size = page.Size().map_err(|_| PdfPreviewError::Invalid)?;
        let (width, height) =
            contained_dimensions(size.Width, size.Height, requested_width, requested_height)?;
        let options = PdfPageRenderOptions::new().map_err(|_| PdfPreviewError::Unsupported)?;
        options
            .SetDestinationWidth(width)
            .map_err(|_| PdfPreviewError::Unsupported)?;
        options
            .SetDestinationHeight(height)
            .map_err(|_| PdfPreviewError::Unsupported)?;
        options
            .SetBackgroundColor(Color {
                A: 255,
                R: 255,
                G: 255,
                B: 255,
            })
            .map_err(|_| PdfPreviewError::Unsupported)?;
        options
            .SetIsIgnoringHighContrast(true)
            .map_err(|_| PdfPreviewError::Unsupported)?;
        options
            .SetBitmapEncoderId(
                BitmapEncoder::PngEncoderId().map_err(|_| PdfPreviewError::Unsupported)?,
            )
            .map_err(|_| PdfPreviewError::Unsupported)?;
        let stream = InMemoryRandomAccessStream::new().map_err(|_| PdfPreviewError::Unsupported)?;
        let render_action = page
            .RenderWithOptionsToStreamAsync(&stream, &options)
            .map_err(|error| map_pdf_error(&error))?;
        wait_action(&render_action, PDF_RENDER_TIMEOUT, &cancelled)?;
        if cancelled() {
            return Err(PdfPreviewError::Cancelled);
        }
        let byte_length = stream.Size().map_err(|_| PdfPreviewError::Invalid)?;
        if byte_length == 0 || byte_length > super::MAX_PDF_RENDER_PIXELS * 4 {
            return Err(PdfPreviewError::Unsupported);
        }
        stream.Seek(0).map_err(|_| PdfPreviewError::Invalid)?;
        let reader = DataReader::CreateDataReader(&stream).map_err(|_| PdfPreviewError::Invalid)?;
        let load = reader
            .LoadAsync(byte_length as u32)
            .map_err(|_| PdfPreviewError::Invalid)?;
        let loaded = wait_operation(&load, PDF_IO_TIMEOUT, &cancelled)?;
        if u64::from(loaded) != byte_length {
            return Err(PdfPreviewError::Invalid);
        }
        let mut bytes = vec![0_u8; byte_length as usize];
        reader
            .ReadBytes(&mut bytes)
            .map_err(|_| PdfPreviewError::Invalid)?;
        let _ = reader.Close();
        let _ = stream.Close();
        let _ = page.Close();
        let _ = input.Close();
        Ok(PdfPreviewImage {
            bytes,
            width,
            height,
            source_width: size.Width.round().clamp(1.0, u32::MAX as f32) as u32,
            source_height: size.Height.round().clamp(1.0, u32::MAX as f32) as u32,
            page_count,
        })
    }
}

#[cfg(windows)]
pub(crate) use windows_renderer::render_first_page;

#[cfg(not(windows))]
pub(crate) fn render_first_page(
    _path: &Path,
    _source_bytes: u64,
    _requested_width: u32,
    _requested_height: u32,
    _cancelled: impl Fn() -> bool,
) -> Result<PdfPreviewImage, PdfPreviewError> {
    Err(PdfPreviewError::Unsupported)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn minimal_pdf(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Resources << >> /Contents 4 0 R >>"
            ),
            "<< /Length 0 >>\nstream\n\nendstream".to_string(),
        ];
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(bytes.len());
            bytes.extend_from_slice(format!("{} 0 obj\n{object}\nendobj\n", index + 1).as_bytes());
        }
        let xref = bytes.len();
        bytes.extend_from_slice(b"xref\n0 5\n0000000000 65535 f \n");
        for offset in offsets {
            bytes.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        bytes.extend_from_slice(
            format!("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").as_bytes(),
        );
        bytes
    }

    #[test]
    fn windows_renderer_rasterizes_only_the_first_page_to_bounded_png() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("NammuFilesF4BUnit-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("portrait first page.pdf");
        let bytes = minimal_pdf(612, 792);
        fs::write(&path, &bytes).unwrap();
        let rendered = render_first_page(&path, bytes.len() as u64, 128, 128, || false).unwrap();
        assert_eq!(rendered.page_count, 1);
        assert_eq!((rendered.width, rendered.height), (99, 128));
        assert!(rendered.bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_absurd_page_dimensions_before_rasterization() {
        assert_eq!(
            windows_renderer::contained_dimensions(1_000_000.0, 792.0, 128, 128),
            Err(PdfPreviewError::Unsupported)
        );
    }
}
