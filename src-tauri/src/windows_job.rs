use std::{
    io,
    mem::size_of,
    os::windows::io::AsRawHandle,
    process::Child,
    ptr::{null, null_mut},
};

use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};

pub struct KillOnCloseJob {
    handle: HANDLE,
}

// The handle is uniquely owned by this value. Windows kernel handles may be
// transferred between threads, and all access remains serialized by the
// LocalServerState mutex.
unsafe impl Send for KillOnCloseJob {}

impl KillOnCloseJob {
    pub fn assign(child: &Child) -> io::Result<Self> {
        // SAFETY: the job is unnamed and receives a null security descriptor.
        let handle = unsafe { CreateJobObjectW(null(), null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        // SAFETY: `limits` is alive for the call and the length matches its type.
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            let error = io::Error::last_os_error();
            // SAFETY: `handle` was returned by CreateJobObjectW above.
            unsafe { CloseHandle(handle) };
            return Err(error);
        }

        let process_handle = child.as_raw_handle() as HANDLE;
        // SAFETY: both handles are valid for the duration of this call.
        let assigned = unsafe { AssignProcessToJobObject(handle, process_handle) };
        if assigned == 0 {
            let error = io::Error::last_os_error();
            // SAFETY: `handle` was returned by CreateJobObjectW above.
            unsafe { CloseHandle(handle) };
            return Err(error);
        }

        Ok(Self { handle })
    }
}

impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            // Closing a KILL_ON_JOB_CLOSE job terminates any surviving descendants.
            // SAFETY: this type owns the handle and closes it exactly once.
            unsafe { CloseHandle(self.handle) };
            self.handle = null_mut();
        }
    }
}
