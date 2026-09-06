use crate::native_filesystem::{path_string, NativeFilesystemError, NativeFilesystemErrorCode};
use std::{
    fs,
    path::{Path, PathBuf},
};
use unicode_normalization::UnicodeNormalization;

pub(super) const MAX_ARCHIVE_ENTRIES: usize = 100_000;
pub(super) const MAX_LIST_PAGE: usize = 500;
pub(super) const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024 * 1024;
pub(super) const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024 * 1024;
pub(super) const MAX_COMPRESSION_RATIO: u64 = 1_000;
pub(super) const RATIO_CHECK_MIN_BYTES: u64 = 16 * 1024 * 1024;
pub(super) const BUFFER_BYTES: usize = 1024 * 1024;

fn archive_error(
    code: NativeFilesystemErrorCode,
    message: impl Into<String>,
) -> NativeFilesystemError {
    NativeFilesystemError::new(code, message)
}

fn reserved_windows_name(segment: &str) -> bool {
    let device = segment
        .split('.')
        .next()
        .unwrap_or(segment)
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();
    matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$")
        || (device.len() == 4
            && (device.starts_with("COM") || device.starts_with("LPT"))
            && matches!(device.as_bytes()[3], b'1'..=b'9'))
}

pub(super) fn normalize_archive_path(
    raw: &str,
    is_directory: bool,
) -> Result<String, NativeFilesystemError> {
    if raw.is_empty()
        || raw
            .chars()
            .any(|character| character == '\0' || character.is_control())
    {
        return Err(archive_error(
            NativeFilesystemErrorCode::ArchiveEntryUnsafe,
            "The ZIP contains an empty or control-character path.",
        ));
    }
    let normalized_slashes = raw.replace('\\', "/");
    let candidate = normalized_slashes.trim_end_matches('/');
    if candidate.is_empty()
        || normalized_slashes.starts_with('/')
        || normalized_slashes.starts_with("//")
        || candidate.contains(':')
    {
        return Err(archive_error(
            NativeFilesystemErrorCode::ArchiveEntryUnsafe,
            "The ZIP contains an absolute, drive-prefixed, or UNC path.",
        ));
    }

    let mut segments = Vec::new();
    for raw_segment in candidate.split('/') {
        let segment: String = raw_segment.nfc().collect();
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.encode_utf16().count() > 255
            || segment.ends_with([' ', '.'])
            || segment.chars().any(|character| {
                character.is_control()
                    || matches!(
                        character,
                        '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                    )
            })
            || reserved_windows_name(&segment)
        {
            return Err(archive_error(
                NativeFilesystemErrorCode::ArchiveEntryUnsafe,
                "The ZIP contains a path that cannot be represented safely on Windows.",
            ));
        }
        segments.push(segment);
    }
    let path = segments.join("/");
    if path.encode_utf16().count() > 32_000 {
        return Err(archive_error(
            NativeFilesystemErrorCode::ArchiveEntryUnsafe,
            "The ZIP contains an entry path that exceeds the Windows long-path limit.",
        ));
    }
    if is_directory {
        Ok(format!("{path}/"))
    } else {
        Ok(path)
    }
}

pub(super) fn path_key(path: &str) -> String {
    path.trim_end_matches('/')
        .nfc()
        .collect::<String>()
        .to_lowercase()
}

pub(super) fn relative_native_path(path: &str) -> PathBuf {
    path.trim_end_matches('/').split('/').collect()
}

pub(super) fn destination_path(root: &Path, archive_path: &str) -> PathBuf {
    root.join(relative_native_path(archive_path))
}

pub(super) fn ensure_no_reparse_ancestors(
    root: &Path,
    destination: &Path,
) -> Result<(), NativeFilesystemError> {
    let mut current = root.to_path_buf();
    if is_reparse_point(&current)? {
        return Err(archive_error(
            NativeFilesystemErrorCode::ArchiveEntryUnsafe,
            "The extraction destination is a reparse point.",
        ));
    }
    let relative = destination.strip_prefix(root).map_err(|_| {
        archive_error(
            NativeFilesystemErrorCode::ArchiveEntryUnsafe,
            "The ZIP entry escaped the selected extraction destination.",
        )
    })?;
    for component in relative.components() {
        current.push(component.as_os_str());
        if current.exists() && is_reparse_point(&current)? {
            return Err(archive_error(
                NativeFilesystemErrorCode::ArchiveEntryUnsafe,
                "An existing destination path is a reparse point.",
            ));
        }
    }
    Ok(())
}

pub(super) fn is_reparse_point(path: &Path) -> Result<bool, NativeFilesystemError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(NativeFilesystemError::from_io(
                &error,
                "The path could not be inspected safely.",
            ))
        }
    };
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        Ok(metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
    }
    #[cfg(not(windows))]
    {
        Ok(metadata.file_type().is_symlink())
    }
}

pub(super) fn keep_both_path(path: &Path) -> Result<PathBuf, NativeFilesystemError> {
    if !path.exists() {
        return Ok(path.to_path_buf());
    }
    let parent = path
        .parent()
        .ok_or_else(NativeFilesystemError::invalid_path)?;
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(NativeFilesystemError::invalid_path)?;
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 1..=10_000u32 {
        let suffix = if index == 1 {
            " copy".to_string()
        } else {
            format!(" copy {index}")
        };
        let name = match extension {
            Some(extension) => format!("{stem}{suffix}.{extension}"),
            None => format!("{stem}{suffix}"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(archive_error(
        NativeFilesystemErrorCode::AlreadyExists,
        "Nammu could not create a unique Keep Both name.",
    ))
}

pub(super) fn validate_declared_limits(
    compressed: u64,
    uncompressed: u64,
) -> Result<(), NativeFilesystemError> {
    if uncompressed > MAX_ENTRY_BYTES {
        return Err(archive_error(
            NativeFilesystemErrorCode::ArchiveLimitExceeded,
            "A ZIP entry exceeds the per-file extraction limit.",
        ));
    }
    if uncompressed >= RATIO_CHECK_MIN_BYTES
        && uncompressed / compressed.max(1) > MAX_COMPRESSION_RATIO
    {
        return Err(archive_error(
            NativeFilesystemErrorCode::ArchiveLimitExceeded,
            "A ZIP entry exceeds the permitted compression ratio.",
        ));
    }
    Ok(())
}

pub(super) fn ensure_free_space(
    destination: &Path,
    required_bytes: u64,
) -> Result<(), NativeFilesystemError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        // Free space is a volume property. Passing the volume root avoids the legacy
        // Win32 path-length limit for otherwise valid long extraction destinations.
        let volume_root = destination.ancestors().last().unwrap_or(destination);
        let mut wide = volume_root.as_os_str().encode_wide().collect::<Vec<_>>();
        wide.push(0);
        let mut available = 0u64;
        let succeeded = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if succeeded == 0 {
            return Err(NativeFilesystemError::from_io(
                &std::io::Error::last_os_error(),
                "Available extraction space could not be determined.",
            ));
        }
        if required_bytes > available {
            return Err(archive_error(
                NativeFilesystemErrorCode::ArchiveLimitExceeded,
                "The selected destination does not have enough free space for this extraction.",
            ));
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (destination, required_bytes);
    }
    Ok(())
}

pub(super) fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| path_string(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_relative_unicode_paths() {
        assert_eq!(
            normalize_archive_path("चित्र/hello world.txt", false).unwrap(),
            "चित्र/hello world.txt"
        );
    }

    #[test]
    fn rejects_zip_slip_absolute_drive_unc_and_reserved_paths() {
        for path in [
            "../escape.txt",
            "a/../../escape.txt",
            "/root.txt",
            "C:/root.txt",
            "C:\\root.txt",
            "\\\\server\\share\\x.txt",
            "CON.txt",
            "folder/NUL",
        ] {
            assert!(
                normalize_archive_path(path, false).is_err(),
                "accepted {path}"
            );
        }
    }

    #[test]
    fn normalizes_separators_and_unicode_composition() {
        assert_eq!(
            normalize_archive_path("folder\\e\u{301}.txt", false).unwrap(),
            "folder/é.txt"
        );
    }

    #[test]
    fn keep_both_is_deterministic() {
        let root = std::env::temp_dir().join(format!("nammu-archive-name-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("report.pdf"), b"one").unwrap();
        assert_eq!(
            keep_both_path(&root.join("report.pdf"))
                .unwrap()
                .file_name()
                .unwrap(),
            "report copy.pdf"
        );
        fs::write(root.join("report copy.pdf"), b"two").unwrap();
        assert_eq!(
            keep_both_path(&root.join("report.pdf"))
                .unwrap()
                .file_name()
                .unwrap(),
            "report copy 2.pdf"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
