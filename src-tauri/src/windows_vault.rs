use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    ptr,
};

use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    },
};
use zeroize::Zeroize;

const MASTER_KEY_BYTES: usize = 32;
const FILE_HEADER: &[u8] = b"NAMMU-DPAPI-V1\0";

pub fn load_or_create_master_key(data_directory: &Path) -> Result<Vec<u8>, String> {
    let vault_directory = data_directory.join("vault");
    fs::create_dir_all(&vault_directory)
        .map_err(|error| format!("The credential vault directory could not be created: {error}"))?;
    let key_path = vault_directory.join("master-key.dpapi");

    if key_path.exists() {
        return read_master_key(&key_path);
    }

    let mut master_key = vec![0_u8; MASTER_KEY_BYTES];
    getrandom::fill(&mut master_key)
        .map_err(|error| format!("Credential vault entropy is unavailable: {error}"))?;
    let protected = match protect(&master_key) {
        Ok(protected) => protected,
        Err(error) => {
            master_key.zeroize();
            return Err(error);
        }
    };
    if let Err(error) = write_new_key_file(&key_path, &protected) {
        master_key.zeroize();
        return Err(error);
    }
    Ok(master_key)
}

fn read_master_key(path: &Path) -> Result<Vec<u8>, String> {
    let stored = fs::read(path)
        .map_err(|error| format!("The credential vault master key could not be read: {error}"))?;
    let protected = stored
        .strip_prefix(FILE_HEADER)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The credential vault master key has an unknown format.".to_string())?;
    let mut key = unprotect(protected)?;
    if key.len() != MASTER_KEY_BYTES {
        key.zeroize();
        return Err("The credential vault master key has an invalid size.".to_string());
    }
    Ok(key)
}

fn write_new_key_file(path: &Path, protected: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            format!("The credential vault master key could not be created: {error}")
        })?;
    file.write_all(FILE_HEADER)
        .and_then(|_| file.write_all(protected))
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("The credential vault master key could not be stored: {error}"))
}

fn protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    copy_and_free(succeeded, output, "protect")
}

fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: ciphertext.len() as u32,
        pbData: ciphertext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    copy_and_free(succeeded, output, "unprotect")
}

fn copy_and_free(
    succeeded: i32,
    output: CRYPT_INTEGER_BLOB,
    operation: &str,
) -> Result<Vec<u8>, String> {
    if succeeded == 0 {
        if !output.pbData.is_null() {
            unsafe {
                LocalFree(output.pbData.cast());
            }
        }
        return Err(format!(
            "Windows could not {operation} the credential vault key: {}",
            std::io::Error::last_os_error()
        ));
    }
    if output.pbData.is_null() || output.cbData == 0 {
        if !output.pbData.is_null() {
            unsafe {
                LocalFree(output.pbData.cast());
            }
        }
        return Err(format!(
            "Windows returned an empty result while trying to {operation} the credential vault key."
        ));
    }

    let value =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_directory(label: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the test clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "nammu-vault-{label}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn dpapi_round_trip_is_bound_to_the_current_windows_user() {
        let mut plaintext = vec![0x2a; MASTER_KEY_BYTES];
        let protected = protect(&plaintext).expect("DPAPI should protect the test value");
        assert_ne!(protected, plaintext);
        let mut restored = unprotect(&protected).expect("DPAPI should restore the test value");
        assert_eq!(restored, plaintext);
        plaintext.zeroize();
        restored.zeroize();
    }

    #[test]
    fn master_key_is_reused_without_being_stored_as_plaintext() {
        let directory = temporary_directory("persist");
        let mut first = load_or_create_master_key(&directory).expect("the key should be created");
        let stored = fs::read(directory.join("vault").join("master-key.dpapi"))
            .expect("the protected key should exist");
        assert!(stored.starts_with(FILE_HEADER));
        assert!(!stored.windows(first.len()).any(|window| window == first));

        let mut second = load_or_create_master_key(&directory).expect("the key should be reopened");
        assert_eq!(first, second);
        first.zeroize();
        second.zeroize();
        fs::remove_dir_all(directory).expect("the test vault should be removable");
    }
}
