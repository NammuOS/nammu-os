//! Bounded, static poster-frame extraction for the Files preview pipeline.
//!
//! Windows Media Foundation owns container parsing, seeking, decoding and
//! colour conversion. Nammu requests one scaled RGB frame and encodes it to
//! PNG; it does not ship codecs, invoke executables, or implement playback.

use std::{path::Path, time::Duration};

const MAX_SOURCE_DIMENSION: u32 = 32_768;
const MAX_SOURCE_PIXELS: u64 = 268_435_456;
const MAX_OUTPUT_PIXELS: u64 = 1_048_576;
const VIDEO_OPEN_TIMEOUT: Duration = Duration::from_secs(8);
const VIDEO_FRAME_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VideoPreviewError {
    Cancelled,
    Invalid,
    Unsupported,
    TimedOut,
}

#[derive(Debug)]
pub(crate) struct VideoPreviewImage {
    pub(crate) bytes: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) source_width: u32,
    pub(crate) source_height: u32,
    pub(crate) duration_ms: u64,
}

pub(crate) fn representative_timestamp_100ns(duration_100ns: i64) -> i64 {
    const HALF_SECOND: i64 = 5_000_000;
    const ONE_TENTH_SECOND: i64 = 1_000_000;
    const THIRTY_SECONDS: i64 = 300_000_000;
    if duration_100ns <= 10_000_000 {
        return 0;
    }
    let candidate = (duration_100ns / 10).clamp(HALF_SECOND, THIRTY_SECONDS);
    candidate.min(duration_100ns.saturating_sub(ONE_TENTH_SECOND))
}

pub(crate) fn contained_dimensions(
    source_width: u32,
    source_height: u32,
    requested_width: u32,
    requested_height: u32,
) -> Result<(u32, u32), VideoPreviewError> {
    if source_width == 0
        || source_height == 0
        || requested_width == 0
        || requested_height == 0
        || source_width > MAX_SOURCE_DIMENSION
        || source_height > MAX_SOURCE_DIMENSION
        || u64::from(source_width) * u64::from(source_height) > MAX_SOURCE_PIXELS
    {
        return Err(VideoPreviewError::Unsupported);
    }
    let scale = (requested_width as f64 / source_width as f64)
        .min(requested_height as f64 / source_height as f64)
        .min(1.0);
    let width = (source_width as f64 * scale)
        .round()
        .clamp(1.0, requested_width as f64) as u32;
    let height = (source_height as f64 * scale)
        .round()
        .clamp(1.0, requested_height as f64) as u32;
    if u64::from(width) * u64::from(height) > MAX_OUTPUT_PIXELS {
        return Err(VideoPreviewError::Unsupported);
    }
    Ok((width, height))
}

#[cfg(windows)]
mod windows_renderer {
    use super::*;
    use image::{DynamicImage, ImageFormat, RgbaImage};
    use std::{
        io::Cursor,
        os::windows::ffi::OsStrExt,
        sync::{mpsc, Mutex},
        time::Instant,
    };
    use windows::{
        core::{implement, GUID, PCWSTR},
        Storage::{FileAccessMode, Streams::IRandomAccessStream},
        Win32::{
            Media::MediaFoundation::{
                IMFAttributes, IMFMediaEvent, IMFSample, IMFSourceReader, IMFSourceReaderCallback,
                IMFSourceReaderCallback_Impl, MFCreateAttributes, MFCreateMFByteStreamOnStreamEx,
                MFCreateMediaType, MFCreateSourceReaderFromByteStream, MFMediaType_Video,
                MFShutdown, MFStartup, MFVideoFormat_RGB32, MFSTARTUP_FULL, MF_MT_DEFAULT_STRIDE,
                MF_MT_FRAME_SIZE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_PD_DURATION,
                MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED, MF_SOURCE_READERF_ENDOFSTREAM,
                MF_SOURCE_READERF_ERROR, MF_SOURCE_READERF_STREAMTICK,
                MF_SOURCE_READER_ALL_STREAMS, MF_SOURCE_READER_ASYNC_CALLBACK,
                MF_SOURCE_READER_DISCONNECT_MEDIASOURCE_ON_SHUTDOWN,
                MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING,
                MF_SOURCE_READER_FIRST_VIDEO_STREAM, MF_SOURCE_READER_MEDIASOURCE, MF_VERSION,
            },
            System::{
                Com::StructuredStorage::PROPVARIANT,
                WinRT::{
                    CreateRandomAccessStreamOnFile, RoInitialize, RoUninitialize,
                    RO_INIT_MULTITHREADED,
                },
            },
        },
    };
    use windows_core::{Ref, Result as WindowsResult, HRESULT};

    static MEDIA_FOUNDATION_USERS: Mutex<usize> = Mutex::new(0);

    struct WinRtApartment(bool);

    impl WinRtApartment {
        fn initialize() -> Result<Self, VideoPreviewError> {
            match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
                Ok(()) => Ok(Self(true)),
                Err(error) if error.code().0 == 0x8001_0106_u32 as i32 => Ok(Self(false)),
                Err(_) => Err(VideoPreviewError::Unsupported),
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

    struct MediaFoundationSession;

    impl MediaFoundationSession {
        fn acquire() -> Result<Self, VideoPreviewError> {
            let mut users = MEDIA_FOUNDATION_USERS
                .lock()
                .map_err(|_| VideoPreviewError::Unsupported)?;
            if *users == 0 {
                unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) }
                    .map_err(|_| VideoPreviewError::Unsupported)?;
            }
            *users += 1;
            Ok(Self)
        }
    }

    impl Drop for MediaFoundationSession {
        fn drop(&mut self) {
            let Ok(mut users) = MEDIA_FOUNDATION_USERS.lock() else {
                return;
            };
            *users = users.saturating_sub(1);
            if *users == 0 {
                let _ = unsafe { MFShutdown() };
            }
        }
    }

    #[derive(Debug)]
    struct ReadResult {
        status: HRESULT,
        flags: u32,
        sample: Option<IMFSample>,
    }

    #[implement(IMFSourceReaderCallback)]
    struct SourceReaderCallback {
        sender: Mutex<mpsc::Sender<ReadResult>>,
    }

    impl IMFSourceReaderCallback_Impl for SourceReaderCallback_Impl {
        fn OnReadSample(
            &self,
            status: HRESULT,
            _stream: u32,
            flags: u32,
            _timestamp: i64,
            sample: Ref<'_, IMFSample>,
        ) -> WindowsResult<()> {
            let _ = self.sender.lock().map(|sender| {
                let _ = sender.send(ReadResult {
                    status,
                    flags,
                    sample: sample.as_ref().cloned(),
                });
            });
            Ok(())
        }

        fn OnFlush(&self, _stream: u32) -> WindowsResult<()> {
            Ok(())
        }

        fn OnEvent(&self, _stream: u32, _event: Ref<'_, IMFMediaEvent>) -> WindowsResult<()> {
            Ok(())
        }
    }

    fn attributes() -> Result<IMFAttributes, VideoPreviewError> {
        let mut attributes = None;
        unsafe { MFCreateAttributes(&mut attributes, 3) }
            .map_err(|_| VideoPreviewError::Unsupported)?;
        attributes.ok_or(VideoPreviewError::Unsupported)
    }

    fn unpack_pair(value: u64) -> (u32, u32) {
        ((value >> 32) as u32, value as u32)
    }

    fn pack_pair(first: u32, second: u32) -> u64 {
        (u64::from(first) << 32) | u64::from(second)
    }

    fn create_reader(
        path: &Path,
        callback: &IMFSourceReaderCallback,
    ) -> Result<(IMFSourceReader, IRandomAccessStream), VideoPreviewError> {
        let wide_path: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let stream: IRandomAccessStream = unsafe {
            CreateRandomAccessStreamOnFile(
                PCWSTR::from_raw(wide_path.as_ptr()),
                FileAccessMode::Read.0 as u32,
            )
        }
        .map_err(|_| VideoPreviewError::Invalid)?;
        let byte_stream = unsafe { MFCreateMFByteStreamOnStreamEx(&stream) }
            .map_err(|_| VideoPreviewError::Invalid)?;
        let attributes = attributes()?;
        unsafe {
            attributes
                .SetUnknown(&MF_SOURCE_READER_ASYNC_CALLBACK, callback)
                .and_then(|_| {
                    attributes.SetUINT32(&MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, 1)
                })
                .and_then(|_| {
                    attributes.SetUINT32(&MF_SOURCE_READER_DISCONNECT_MEDIASOURCE_ON_SHUTDOWN, 1)
                })
        }
        .map_err(|_| VideoPreviewError::Unsupported)?;
        let reader = unsafe { MFCreateSourceReaderFromByteStream(&byte_stream, &attributes) }
            .map_err(|_| VideoPreviewError::Invalid)?;
        Ok((reader, stream))
    }

    fn duration_100ns(reader: &IMFSourceReader) -> i64 {
        let value = unsafe {
            reader.GetPresentationAttribute(MF_SOURCE_READER_MEDIASOURCE.0 as u32, &MF_PD_DURATION)
        };
        value
            .ok()
            .and_then(|value| i64::try_from(&value).ok())
            .filter(|value| *value > 0)
            .unwrap_or(0)
    }

    fn configure_output(
        reader: &IMFSourceReader,
        requested_width: u32,
        requested_height: u32,
    ) -> Result<(u32, u32, u32, u32), VideoPreviewError> {
        let stream = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
        let native = unsafe { reader.GetNativeMediaType(stream, 0) }
            .map_err(|_| VideoPreviewError::Unsupported)?;
        let (source_width, source_height) = unpack_pair(
            unsafe { native.GetUINT64(&MF_MT_FRAME_SIZE) }
                .map_err(|_| VideoPreviewError::Invalid)?,
        );
        let (width, height) = contained_dimensions(
            source_width,
            source_height,
            requested_width,
            requested_height,
        )?;
        let output = unsafe { MFCreateMediaType() }.map_err(|_| VideoPreviewError::Unsupported)?;
        unsafe {
            output
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .and_then(|_| output.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32))
                .and_then(|_| output.SetUINT64(&MF_MT_FRAME_SIZE, pack_pair(width, height)))
                .and_then(|_| {
                    reader.SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS.0 as u32, false)
                })
                .and_then(|_| reader.SetStreamSelection(stream, true))
                .and_then(|_| reader.SetCurrentMediaType(stream, None, &output))
        }
        .map_err(|_| VideoPreviewError::Unsupported)?;
        Ok((source_width, source_height, width, height))
    }

    fn wait_for_frame(
        reader: &IMFSourceReader,
        receiver: &mpsc::Receiver<ReadResult>,
        cancelled: &impl Fn() -> bool,
    ) -> Result<IMFSample, VideoPreviewError> {
        let deadline = Instant::now() + VIDEO_FRAME_TIMEOUT;
        let stream = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
        unsafe { reader.ReadSample(stream, 0, None, None, None, None) }
            .map_err(|_| VideoPreviewError::Invalid)?;
        loop {
            if cancelled() {
                let _ = unsafe { reader.Flush(stream) };
                return Err(VideoPreviewError::Cancelled);
            }
            if Instant::now() >= deadline {
                let _ = unsafe { reader.Flush(stream) };
                return Err(VideoPreviewError::TimedOut);
            }
            match receiver.recv_timeout(Duration::from_millis(10)) {
                Ok(result) => {
                    if result.status.is_err()
                        || result.flags & MF_SOURCE_READERF_ERROR.0 as u32 != 0
                    {
                        return Err(VideoPreviewError::Invalid);
                    }
                    if result.flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
                        return Err(VideoPreviewError::Invalid);
                    }
                    if result.flags
                        & (MF_SOURCE_READERF_STREAMTICK.0 as u32
                            | MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED.0 as u32)
                        != 0
                        && result.sample.is_none()
                    {
                        unsafe { reader.ReadSample(stream, 0, None, None, None, None) }
                            .map_err(|_| VideoPreviewError::Invalid)?;
                        continue;
                    }
                    return result.sample.ok_or(VideoPreviewError::Invalid);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(VideoPreviewError::Invalid)
                }
            }
        }
    }

    fn extract_rgba(
        sample: &IMFSample,
        reader: &IMFSourceReader,
        width: u32,
        height: u32,
    ) -> Result<RgbaImage, VideoPreviewError> {
        let media_type =
            unsafe { reader.GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32) }
                .map_err(|_| VideoPreviewError::Invalid)?;
        let stride = unsafe { media_type.GetUINT32(&MF_MT_DEFAULT_STRIDE) }
            .map(|value| value as i32)
            .unwrap_or((width * 4) as i32);
        let row_bytes = usize::try_from(width)
            .ok()
            .and_then(|value| value.checked_mul(4))
            .ok_or(VideoPreviewError::Unsupported)?;
        let absolute_stride =
            usize::try_from(stride.unsigned_abs()).map_err(|_| VideoPreviewError::Unsupported)?;
        if absolute_stride < row_bytes {
            return Err(VideoPreviewError::Invalid);
        }
        let expected = absolute_stride
            .checked_mul(height as usize)
            .ok_or(VideoPreviewError::Unsupported)?;
        let buffer = unsafe { sample.ConvertToContiguousBuffer() }
            .map_err(|_| VideoPreviewError::Invalid)?;
        let current_length =
            unsafe { buffer.GetCurrentLength() }.map_err(|_| VideoPreviewError::Invalid)? as usize;
        if current_length < expected || expected > (MAX_OUTPUT_PIXELS as usize * 4) {
            return Err(VideoPreviewError::Invalid);
        }
        let mut pointer = std::ptr::null_mut();
        unsafe { buffer.Lock(&mut pointer, None, None) }.map_err(|_| VideoPreviewError::Invalid)?;
        let result = (|| {
            if pointer.is_null() {
                return Err(VideoPreviewError::Invalid);
            }
            let bytes = unsafe { std::slice::from_raw_parts(pointer, expected) };
            let mut rgba = vec![0_u8; row_bytes * height as usize];
            for output_row in 0..height as usize {
                let source_row = if stride < 0 {
                    height as usize - 1 - output_row
                } else {
                    output_row
                };
                let source =
                    &bytes[source_row * absolute_stride..source_row * absolute_stride + row_bytes];
                let target = &mut rgba[output_row * row_bytes..(output_row + 1) * row_bytes];
                for (source_pixel, target_pixel) in
                    source.chunks_exact(4).zip(target.chunks_exact_mut(4))
                {
                    target_pixel.copy_from_slice(&[
                        source_pixel[2],
                        source_pixel[1],
                        source_pixel[0],
                        255,
                    ]);
                }
            }
            RgbaImage::from_raw(width, height, rgba).ok_or(VideoPreviewError::Invalid)
        })();
        let _ = unsafe { buffer.Unlock() };
        result
    }

    fn render_attempt(
        reader: &IMFSourceReader,
        receiver: &mpsc::Receiver<ReadResult>,
        timestamp: i64,
        cancelled: &impl Fn() -> bool,
    ) -> Result<IMFSample, VideoPreviewError> {
        let position = PROPVARIANT::from(timestamp);
        let time_format = GUID::zeroed();
        unsafe { reader.SetCurrentPosition(&time_format, &position) }
            .map_err(|_| VideoPreviewError::Invalid)?;
        wait_for_frame(reader, receiver, cancelled)
    }

    pub(crate) fn render_poster(
        path: &Path,
        source_bytes: u64,
        requested_width: u32,
        requested_height: u32,
        cancelled: impl Fn() -> bool,
    ) -> Result<VideoPreviewImage, VideoPreviewError> {
        if source_bytes == 0 || cancelled() {
            return Err(if cancelled() {
                VideoPreviewError::Cancelled
            } else {
                VideoPreviewError::Invalid
            });
        }
        let started = Instant::now();
        let _apartment = WinRtApartment::initialize()?;
        let _media_foundation = MediaFoundationSession::acquire()?;
        let (sender, receiver) = mpsc::channel();
        let callback: IMFSourceReaderCallback = SourceReaderCallback {
            sender: Mutex::new(sender),
        }
        .into();
        let (reader, input) = create_reader(path, &callback)?;
        if started.elapsed() > VIDEO_OPEN_TIMEOUT {
            return Err(VideoPreviewError::TimedOut);
        }
        let duration = duration_100ns(&reader);
        let (source_width, source_height, width, height) =
            configure_output(&reader, requested_width, requested_height)?;
        let target = representative_timestamp_100ns(duration);
        let sample = match render_attempt(&reader, &receiver, target, &cancelled) {
            Ok(sample) => sample,
            Err(VideoPreviewError::Invalid) if target != 0 && !cancelled() => {
                let _ = unsafe { reader.Flush(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32) };
                render_attempt(&reader, &receiver, 0, &cancelled)?
            }
            Err(error) => return Err(error),
        };
        if cancelled() {
            return Err(VideoPreviewError::Cancelled);
        }
        let frame = extract_rgba(&sample, &reader, width, height)?;
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(frame)
            .write_to(&mut encoded, ImageFormat::Png)
            .map_err(|_| VideoPreviewError::Invalid)?;
        let _ = input.Close();
        Ok(VideoPreviewImage {
            bytes: encoded.into_inner(),
            width,
            height,
            source_width,
            source_height,
            duration_ms: u64::try_from(duration.max(0) / 10_000).unwrap_or(0),
        })
    }
}

#[cfg(windows)]
pub(crate) use windows_renderer::render_poster;

#[cfg(not(windows))]
pub(crate) fn render_poster(
    _path: &Path,
    _source_bytes: u64,
    _requested_width: u32,
    _requested_height: u32,
    _cancelled: impl Fn() -> bool,
) -> Result<VideoPreviewImage, VideoPreviewError> {
    Err(VideoPreviewError::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    const LANDSCAPE_H264_MP4: &str = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMObW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAfQAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAjl0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAfQAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAAAkAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAH0AAAAAAABAAAAAAGxbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAIABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABXG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAARxzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAJABIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAF2dCwAraEf58BEAAAAMAQAAAAwEDxImoAQAEaM4PyAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAACeQAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAAAgAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAAJ5AAAAAQAAABRzdGNvAAAAAAAAAAEAAAM+AAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2Mi4zLjEwMAAAAAhmcmVlAAACgW1kYXQAAAJVBgX//1HcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIzIDA0ODBjYjAgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MSBkZWJsb2NrPTA6LTM6LTMgYW5hbHlzZT0wOjAgbWU9ZGlhIHN1Ym1lPTAgcHN5PTEgcHN5X3JkPTIuMDA6MC43MCBtaXhlZF9yZWY9MCBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTAgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9MCB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MiBzY2VuZWN1dD0wIGludHJhX3JlZnJlc2g9MCByYz1jcmYgbWJ0cmVlPTAgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MACAAAAAHGWIhDoRigACGPHAAED2OAAIeUnJyddddddddeA=";

    #[test]
    fn representative_seek_is_deterministic_and_bounded() {
        assert_eq!(representative_timestamp_100ns(5_000_000), 0);
        assert_eq!(representative_timestamp_100ns(20_000_000), 5_000_000);
        assert_eq!(representative_timestamp_100ns(200_000_000), 20_000_000);
        assert_eq!(representative_timestamp_100ns(9_000_000_000), 300_000_000);
    }

    #[test]
    fn output_dimensions_preserve_aspect_and_reject_hostile_sources() {
        assert_eq!(contained_dimensions(1920, 1080, 128, 128), Ok((128, 72)));
        assert_eq!(contained_dimensions(1080, 1920, 128, 128), Ok((72, 128)));
        assert_eq!(
            contained_dimensions(40_000, 40_000, 128, 128),
            Err(VideoPreviewError::Unsupported)
        );
    }

    #[cfg(windows)]
    #[test]
    fn media_foundation_extracts_a_bounded_h264_mp4_poster() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use std::{fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("NammuFilesF4CUnit-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("landscape sample.mp4");
        let bytes = STANDARD.decode(LANDSCAPE_H264_MP4).unwrap();
        fs::write(&path, &bytes).unwrap();
        let poster = render_poster(&path, bytes.len() as u64, 128, 128, || false).unwrap();
        assert_eq!((poster.source_width, poster.source_height), (64, 36));
        assert_eq!((poster.width, poster.height), (64, 36));
        assert!(poster.duration_ms >= 400 && poster.duration_ms <= 600);
        assert!(poster.bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        fs::remove_dir_all(root).unwrap();
    }
}
