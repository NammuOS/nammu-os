use std::{
    env,
    ffi::OsString,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

#[cfg(windows)]
use crate::windows_job::KillOnCloseJob;
#[cfg(windows)]
use crate::windows_vault::load_or_create_master_key;

const RUNTIME_NAME: &str = "desktop-local";
const CONTROL_PROTOCOL_VERSION: u8 = 1;
const READY_PREFIX: &str = "NAMMU_LOCAL_READY ";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(8);
const REQUEST_TOKEN_LIFETIME: Duration = Duration::from_secs(15);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapMessage {
    protocol_version: u8,
    instance_id: String,
    api_capability: String,
    vault_key: String,
    frontend_origin: String,
    data_directory: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestAuthorizationPayload<'a> {
    protocol_version: u8,
    instance_id: &'a str,
    method: &'a str,
    path_and_query: &'a str,
    expires_at: u64,
    nonce: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalServiceInfo {
    origin: String,
    instance_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRequestAuthorization {
    origin: String,
    token: String,
    expires_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadyMessage {
    protocol_version: u8,
    r#type: String,
    instance_id: String,
    origin: String,
}

struct LaunchPlan {
    node: OsString,
    server_entry: PathBuf,
    project_directory: PathBuf,
    development: bool,
}

pub struct LocalServerSupervisor {
    child: Child,
    control: Option<ChildStdin>,
    origin: String,
    instance_id: String,
    api_capability: String,
    #[cfg(windows)]
    _job: KillOnCloseJob,
}

impl LocalServerSupervisor {
    pub fn start(app: &AppHandle, frontend_origin: &str) -> Result<Self, String> {
        let plan = resolve_launch_plan(app)?;
        let data_directory = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("The Nammu local data directory is unavailable: {error}"))?;
        fs::create_dir_all(&data_directory).map_err(|error| {
            format!("The Nammu local data directory could not be created: {error}")
        })?;

        let instance_id = random_hex(16)?;
        let api_capability = random_hex(32)?;
        #[cfg(windows)]
        let mut vault_key_bytes = load_or_create_master_key(&data_directory)?;
        #[cfg(not(windows))]
        let mut vault_key_bytes = {
            return Err(
                "The credential vault prototype is currently available only on Windows."
                    .to_string(),
            );
        };
        let mut vault_key = encode_hex(&vault_key_bytes)?;
        vault_key_bytes.zeroize();

        let mut bootstrap = BootstrapMessage {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            instance_id: instance_id.clone(),
            api_capability: api_capability.clone(),
            vault_key: vault_key.clone(),
            frontend_origin: frontend_origin.to_string(),
            data_directory: data_directory.to_string_lossy().into_owned(),
        };
        let mut bootstrap_line = serde_json::to_string(&bootstrap)
            .map_err(|error| format!("The local server bootstrap could not be encoded: {error}"))?;
        bootstrap.vault_key.zeroize();

        let mut command = Command::new(&plan.node);
        command
            .arg(&plan.server_entry)
            .current_dir(&plan.project_directory)
            .env("NAMMU_RUNTIME", RUNTIME_NAME)
            .env(
                "NODE_ENV",
                if plan.development {
                    "development"
                } else {
                    "production"
                },
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if plan.development {
            command.arg("--dev");
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("The Nammu local server could not be started: {error}"))?;

        #[cfg(windows)]
        let job = match KillOnCloseJob::assign(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "The Nammu local server could not be attached to its Windows cleanup job: {error}"
                ));
            }
        };

        let mut control = child.stdin.take().ok_or_else(|| {
            terminate_child(&mut child);
            "The Nammu local server control channel was not created.".to_string()
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            terminate_child(&mut child);
            "The Nammu local server readiness channel was not created.".to_string()
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            terminate_child(&mut child);
            "The Nammu local server diagnostics channel was not created.".to_string()
        })?;

        let bootstrap_delivery = control
            .write_all(bootstrap_line.as_bytes())
            .and_then(|_| control.write_all(b"\n"))
            .and_then(|_| control.flush());
        bootstrap_line.zeroize();
        if let Err(error) = bootstrap_delivery {
            vault_key.zeroize();
            terminate_child(&mut child);
            return Err(format!(
                "The Nammu local server bootstrap could not be delivered: {error}"
            ));
        }

        let redactions = vec![api_capability.clone(), vault_key.clone()];
        vault_key.zeroize();
        let (ready_tx, ready_rx) = mpsc::channel();
        spawn_stdout_reader(stdout, ready_tx, redactions.clone());
        spawn_stderr_reader(stderr, redactions);

        let ready = match ready_rx.recv_timeout(STARTUP_TIMEOUT) {
            Ok(Ok(ready)) => ready,
            Ok(Err(error)) => {
                terminate_child(&mut child);
                return Err(error);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                terminate_child(&mut child);
                return Err("The Nammu local server did not become ready in time.".to_string());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                terminate_child(&mut child);
                return Err(
                    "The Nammu local server readiness channel closed unexpectedly.".to_string(),
                );
            }
        };

        validate_ready_message(&ready, &instance_id)?;

        Ok(Self {
            child,
            control: Some(control),
            origin: ready.origin,
            instance_id,
            api_capability,
            #[cfg(windows)]
            _job: job,
        })
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    fn authorize_request(
        &self,
        method: &str,
        path_and_query: &str,
    ) -> Result<LocalRequestAuthorization, String> {
        validate_request_target(method, path_and_query)?;

        let expires_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "The system clock is not valid for local authorization.".to_string())?
            .checked_add(REQUEST_TOKEN_LIFETIME)
            .ok_or_else(|| "The local authorization expiry could not be calculated.".to_string())?
            .as_millis() as u64;
        let payload = RequestAuthorizationPayload {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            instance_id: &self.instance_id,
            method,
            path_and_query,
            expires_at,
            nonce: random_hex(16)?,
        };
        let encoded_payload = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&payload)
                .map_err(|error| format!("The local request could not be authorized: {error}"))?,
        );
        let mut signer = Hmac::<Sha256>::new_from_slice(self.api_capability.as_bytes())
            .map_err(|_| "The local request signer could not be initialized.".to_string())?;
        signer.update(encoded_payload.as_bytes());
        let signature = URL_SAFE_NO_PAD.encode(signer.finalize().into_bytes());

        Ok(LocalRequestAuthorization {
            origin: self.origin.clone(),
            token: format!("{encoded_payload}.{signature}"),
            expires_at,
        })
    }

    pub fn shutdown(&mut self) {
        if let Ok(Some(_)) = self.child.try_wait() {
            self.control.take();
            return;
        }

        if let Some(mut control) = self.control.take() {
            let _ = control.write_all(b"{\"type\":\"shutdown\"}\n");
            let _ = control.flush();
        }

        let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }

        terminate_child(&mut self.child);
    }
}

impl Drop for LocalServerSupervisor {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub struct LocalServerState {
    supervisor: Mutex<Option<LocalServerSupervisor>>,
}

impl LocalServerState {
    pub fn new(supervisor: LocalServerSupervisor) -> Self {
        Self {
            supervisor: Mutex::new(Some(supervisor)),
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut slot) = self.supervisor.lock() {
            if let Some(mut supervisor) = slot.take() {
                supervisor.shutdown();
            }
        }
    }

    pub fn service_info(&self) -> Result<LocalServiceInfo, String> {
        let slot = self
            .supervisor
            .lock()
            .map_err(|_| "The local service state is unavailable.".to_string())?;
        let supervisor = slot
            .as_ref()
            .ok_or_else(|| "The local service is not running.".to_string())?;
        Ok(LocalServiceInfo {
            origin: supervisor.origin.clone(),
            instance_id: supervisor.instance_id.clone(),
        })
    }

    pub fn authorize_request(
        &self,
        method: &str,
        path_and_query: &str,
    ) -> Result<LocalRequestAuthorization, String> {
        let slot = self
            .supervisor
            .lock()
            .map_err(|_| "The local service state is unavailable.".to_string())?;
        let supervisor = slot
            .as_ref()
            .ok_or_else(|| "The local service is not running.".to_string())?;
        supervisor.authorize_request(method, path_and_query)
    }
}

fn validate_request_target(method: &str, path_and_query: &str) -> Result<(), String> {
    const METHODS: [&str; 5] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    if !METHODS.contains(&method) {
        return Err("The local request method is not allowed.".to_string());
    }
    if path_and_query.len() > 2_048
        || !path_and_query.starts_with("/api/")
        || path_and_query.starts_with("//")
        || path_and_query.contains('\\')
        || path_and_query.contains('#')
        || path_and_query.chars().any(char::is_control)
    {
        return Err("The local request target is invalid.".to_string());
    }
    Ok(())
}

fn resolve_launch_plan(app: &AppHandle) -> Result<LaunchPlan, String> {
    let development = cfg!(debug_assertions);
    let project_override = env::var_os("NAMMU_DESKTOP_PROJECT_DIR").map(PathBuf::from);
    let server_override = env::var_os("NAMMU_DESKTOP_SERVER_ENTRY").map(PathBuf::from);
    let node_override = env::var_os("NAMMU_DESKTOP_NODE");

    let (project_directory, server_entry, node) = if project_override.is_some()
        || server_override.is_some()
        || node_override.is_some()
    {
        let project_directory = project_override.ok_or_else(|| {
            "NAMMU_DESKTOP_PROJECT_DIR is required when overriding the local server runtime."
                .to_string()
        })?;
        let server_entry = server_override.unwrap_or_else(|| project_directory.join("server.mjs"));
        let node = node_override.unwrap_or_else(|| OsString::from("node"));
        (project_directory, server_entry, node)
    } else if development {
        let project_directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "The Nammu repository root could not be resolved.".to_string())?
            .to_path_buf();
        let server_entry = project_directory.join("server.mjs");
        (project_directory, server_entry, OsString::from("node"))
    } else {
        let local_server = app
            .path()
            .resource_dir()
            .map_err(|error| format!("The packaged resource directory is unavailable: {error}"))?
            .join("resources")
            .join("local-server");
        let project_directory = child_compatible_path(local_server.join("app"));
        let server_entry = child_compatible_path(project_directory.join("server.mjs"));
        #[cfg(windows)]
        let node = OsString::from(child_compatible_path(
            local_server.join("runtime").join("node.exe"),
        ));
        #[cfg(not(windows))]
        let node = OsString::from(local_server.join("runtime").join("node"));
        (project_directory, server_entry, node)
    };

    if !server_entry.is_file() {
        return Err(format!(
            "The Nammu local server entrypoint is missing: {}",
            server_entry.display()
        ));
    }

    Ok(LaunchPlan {
        node,
        server_entry,
        project_directory,
        development,
    })
}

#[cfg(windows)]
fn child_compatible_path(path: PathBuf) -> PathBuf {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    const VERBATIM_PREFIX: [u16; 4] = [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
    const VERBATIM_UNC_PREFIX: [u16; 8] = [
        b'\\' as u16,
        b'\\' as u16,
        b'?' as u16,
        b'\\' as u16,
        b'U' as u16,
        b'N' as u16,
        b'C' as u16,
        b'\\' as u16,
    ];

    let encoded = path.as_os_str().encode_wide().collect::<Vec<_>>();
    if encoded.starts_with(&VERBATIM_UNC_PREFIX) {
        let normalized = [vec![b'\\' as u16, b'\\' as u16], encoded[8..].to_vec()].concat();
        return PathBuf::from(OsString::from_wide(&normalized));
    }
    if encoded.starts_with(&VERBATIM_PREFIX) {
        return PathBuf::from(OsString::from_wide(&encoded[4..]));
    }
    path
}

#[cfg(not(windows))]
fn child_compatible_path(path: PathBuf) -> PathBuf {
    path
}

fn random_hex(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("Secure desktop session entropy is unavailable: {error}"))?;
    let mut encoded = String::with_capacity(byte_count * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}")
            .map_err(|_| "Secure desktop session entropy could not be encoded.".to_string())?;
    }
    Ok(encoded)
}

fn encode_hex(bytes: &[u8]) -> Result<String, String> {
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}")
            .map_err(|_| "Secure bytes could not be encoded.".to_string())?;
    }
    Ok(encoded)
}

fn spawn_stdout_reader(
    stdout: impl std::io::Read + Send + 'static,
    ready_tx: mpsc::Sender<Result<ReadyMessage, String>>,
    redactions: Vec<String>,
) {
    thread::spawn(move || {
        let mut readiness_sent = false;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else {
                if !readiness_sent {
                    let _ = ready_tx.send(Err(
                        "The Nammu local server readiness stream could not be read.".to_string(),
                    ));
                }
                return;
            };

            if let Some(payload) = line.strip_prefix(READY_PREFIX) {
                if readiness_sent {
                    continue;
                }
                readiness_sent = true;
                let result = serde_json::from_str::<ReadyMessage>(payload).map_err(|error| {
                    format!("The Nammu local server sent invalid readiness data: {error}")
                });
                let _ = ready_tx.send(result);
                continue;
            }

            eprintln!("[nammu-local] {}", redact(&line, &redactions));
        }

        if !readiness_sent {
            let _ = ready_tx.send(Err(
                "The Nammu local server exited before reporting readiness.".to_string(),
            ));
        }
    });
}

fn spawn_stderr_reader(stderr: impl std::io::Read + Send + 'static, redactions: Vec<String>) {
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[nammu-local] {}", redact(&line, &redactions));
        }
    });
}

fn redact(line: &str, secrets: &[String]) -> String {
    secrets.iter().fold(line.to_string(), |value, secret| {
        value.replace(secret, "[redacted]")
    })
}

fn validate_ready_message(ready: &ReadyMessage, expected_instance_id: &str) -> Result<(), String> {
    if ready.protocol_version != CONTROL_PROTOCOL_VERSION
        || ready.r#type != "ready"
        || ready.instance_id != expected_instance_id
    {
        return Err("The Nammu local server readiness identity is invalid.".to_string());
    }

    let Some(port_text) = ready.origin.strip_prefix("http://127.0.0.1:") else {
        return Err("The Nammu local server did not bind to numeric IPv4 loopback.".to_string());
    };
    let port = port_text
        .parse::<u16>()
        .map_err(|_| "The Nammu local server reported an invalid port.".to_string())?;
    if port == 0 || port_text != port.to_string() {
        return Err("The Nammu local server reported an invalid port.".to_string());
    }
    Ok(())
}

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::{
        random_hex, validate_ready_message, validate_request_target, ReadyMessage,
        CONTROL_PROTOCOL_VERSION,
    };

    #[test]
    fn secure_values_have_the_requested_size_and_are_unique() {
        let first = random_hex(32).expect("first capability");
        let second = random_hex(32).expect("second capability");
        assert_eq!(first.len(), 64);
        assert_eq!(second.len(), 64);
        assert_ne!(first, second);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn readiness_requires_numeric_loopback_and_matching_identity() {
        let ready = ReadyMessage {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            r#type: "ready".to_string(),
            instance_id: "instance".to_string(),
            origin: "http://127.0.0.1:43127".to_string(),
        };
        assert!(validate_ready_message(&ready, "instance").is_ok());
        assert!(validate_ready_message(&ready, "other").is_err());

        let wrong_host = ReadyMessage {
            origin: "http://localhost:43127".to_string(),
            ..ready
        };
        assert!(validate_ready_message(&wrong_host, "instance").is_err());
    }

    #[test]
    fn request_authorization_accepts_only_known_methods_and_api_targets() {
        assert!(validate_request_target("GET", "/api/health?detail=1").is_ok());
        assert!(validate_request_target("OPTIONS", "/api/health").is_err());
        assert!(validate_request_target("GET", "https://example.com/api/health").is_err());
        assert!(validate_request_target("GET", "/firefox-wisp/secret").is_err());
        assert!(validate_request_target("GET", "/api/health#fragment").is_err());
    }
}
