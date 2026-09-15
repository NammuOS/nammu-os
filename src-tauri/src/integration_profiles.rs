use crate::{trusted_shell::require_trusted_shell, web_surface::WebSurfaceState};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{State, Webview};

const JOURNAL_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationProfileAdoptionRequest {
    app_namespace: String,
    migration_id: String,
    migration_version: u32,
    legacy_namespace: String,
    legacy_profile_id: String,
    destination_profile_key: String,
    partition_key: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum IntegrationProfileAdoptionStatus {
    Adopted,
    AlreadyAdopted,
    SourceNotFound,
}

#[derive(Debug, Clone, Serialize)]
pub struct IntegrationProfileAdoptionResult {
    status: IntegrationProfileAdoptionStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct IntegrationProfilePurgeResult {
    removed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum JournalState {
    Prepared,
    Complete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AdoptionJournal {
    journal_version: u32,
    app_namespace: String,
    migration_id: String,
    migration_version: u32,
    legacy_namespace: String,
    legacy_profile_id: String,
    destination_profile_key: String,
    partition_key: String,
    state: JournalState,
}

fn safe_segment(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn valid_app_namespace(value: &str) -> bool {
    value.len() == 28
        && value.starts_with("pkg-")
        && value[4..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_request(request: &IntegrationProfileAdoptionRequest) -> Result<(), String> {
    if !valid_app_namespace(&request.app_namespace)
        || !safe_segment(&request.migration_id, 80)
        || request.migration_version == 0
        || request.legacy_namespace != "telegram"
        || !safe_segment(&request.legacy_profile_id, 80)
        || !safe_segment(&request.destination_profile_key, 80)
        || !request
            .destination_profile_key
            .starts_with(&format!("{}-", request.app_namespace))
        || !safe_segment(&request.partition_key, 80)
        || request.legacy_profile_id != request.partition_key
    {
        return Err("The integration-profile adoption request is invalid.".to_string());
    }
    Ok(())
}

fn journal_path(root: &Path, request: &IntegrationProfileAdoptionRequest) -> PathBuf {
    root.join(".adoptions").join(format!(
        "{}--{}--{}--{}.json",
        request.app_namespace,
        request.migration_id,
        request.migration_version,
        request.partition_key
    ))
}

fn journal_for(
    request: &IntegrationProfileAdoptionRequest,
    state: JournalState,
) -> AdoptionJournal {
    AdoptionJournal {
        journal_version: JOURNAL_VERSION,
        app_namespace: request.app_namespace.clone(),
        migration_id: request.migration_id.clone(),
        migration_version: request.migration_version,
        legacy_namespace: request.legacy_namespace.clone(),
        legacy_profile_id: request.legacy_profile_id.clone(),
        destination_profile_key: request.destination_profile_key.clone(),
        partition_key: request.partition_key.clone(),
        state,
    }
}

fn journal_matches(journal: &AdoptionJournal, request: &IntegrationProfileAdoptionRequest) -> bool {
    journal.journal_version == JOURNAL_VERSION
        && journal.app_namespace == request.app_namespace
        && journal.migration_id == request.migration_id
        && journal.migration_version == request.migration_version
        && journal.legacy_namespace == request.legacy_namespace
        && journal.legacy_profile_id == request.legacy_profile_id
        && journal.destination_profile_key == request.destination_profile_key
        && journal.partition_key == request.partition_key
}

fn write_journal(path: &Path, journal: &AdoptionJournal) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The adoption journal location is invalid.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("The adoption journal directory could not be created: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(journal)
        .map_err(|error| format!("The adoption journal could not be encoded: {error}"))?;
    let mut file = fs::File::create(&temporary)
        .map_err(|error| format!("The adoption journal could not be created: {error}"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("The adoption journal could not be persisted: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("The adoption journal could not be committed: {error}"))?;
    Ok(())
}

fn read_journal(path: &Path) -> Result<Option<AdoptionJournal>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path)
        .map_err(|error| format!("The adoption journal could not be read: {error}"))?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "The adoption journal is corrupt; adoption failed closed.".to_string())
}

fn adopt_at_root(
    root: &Path,
    request: &IntegrationProfileAdoptionRequest,
) -> Result<IntegrationProfileAdoptionResult, String> {
    validate_request(request)?;
    let source = root
        .join(&request.legacy_namespace)
        .join(&request.legacy_profile_id);
    let destination = root
        .join("integration")
        .join(&request.destination_profile_key)
        .join(&request.partition_key);
    let journal_path = journal_path(root, request);
    let existing_journal = read_journal(&journal_path)?;
    if let Some(journal) = &existing_journal {
        if !journal_matches(journal, request) {
            return Err("The adoption journal does not match this request.".to_string());
        }
        if journal.state == JournalState::Complete && destination.is_dir() && !source.exists() {
            return Ok(IntegrationProfileAdoptionResult {
                status: IntegrationProfileAdoptionStatus::AlreadyAdopted,
            });
        }
    }

    let source_exists = source.is_dir();
    let destination_exists = destination.exists();
    if source_exists && destination_exists {
        return Err(
            "Both legacy and destination profiles exist; adoption will not overwrite either."
                .to_string(),
        );
    }
    if destination_exists {
        if existing_journal
            .as_ref()
            .is_some_and(|journal| journal.state == JournalState::Prepared)
            && !source.exists()
        {
            write_journal(&journal_path, &journal_for(request, JournalState::Complete))?;
            return Ok(IntegrationProfileAdoptionResult {
                status: IntegrationProfileAdoptionStatus::AlreadyAdopted,
            });
        }
        return Err(
            "The destination profile already exists without a completed adoption.".to_string(),
        );
    }
    if !source_exists {
        return Ok(IntegrationProfileAdoptionResult {
            status: IntegrationProfileAdoptionStatus::SourceNotFound,
        });
    }

    let destination_parent = destination
        .parent()
        .ok_or_else(|| "The destination profile location is invalid.".to_string())?;
    fs::create_dir_all(destination_parent).map_err(|error| {
        format!("The destination profile directory could not be created: {error}")
    })?;
    write_journal(&journal_path, &journal_for(request, JournalState::Prepared))?;
    fs::rename(&source, &destination)
        .map_err(|error| format!("The legacy profile could not be atomically adopted: {error}"))?;
    write_journal(&journal_path, &journal_for(request, JournalState::Complete))?;
    Ok(IntegrationProfileAdoptionResult {
        status: IntegrationProfileAdoptionStatus::Adopted,
    })
}

#[tauri::command]
pub fn adopt_integration_profile(
    request: IntegrationProfileAdoptionRequest,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<IntegrationProfileAdoptionResult, String> {
    require_trusted_shell(&caller)?;
    validate_request(&request)?;
    let source = state
        .profile_root()
        .join(&request.legacy_namespace)
        .join(&request.legacy_profile_id);
    let destination = state
        .profile_root()
        .join("integration")
        .join(&request.destination_profile_key)
        .join(&request.partition_key);
    if state.profile_is_active(&source)? || state.profile_is_active(&destination)? {
        return Err(
            "An active web surface is using the source or destination profile.".to_string(),
        );
    }
    adopt_at_root(state.profile_root(), &request)
}

fn purge_at_root(root: &Path, app_namespace: &str) -> Result<usize, String> {
    if !valid_app_namespace(app_namespace) {
        return Err("The integration-profile package namespace is invalid.".to_string());
    }
    let integration_root = root.join("integration");
    let mut removed = 0usize;
    if integration_root.is_dir() {
        for entry in fs::read_dir(&integration_root)
            .map_err(|error| format!("Integration profiles could not be enumerated: {error}"))?
        {
            let entry =
                entry.map_err(|error| format!("An integration profile is invalid: {error}"))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(&format!("{app_namespace}-")) {
                let metadata = fs::symlink_metadata(entry.path()).map_err(|error| {
                    format!("An integration profile could not be inspected: {error}")
                })?;
                if metadata.file_type().is_symlink() {
                    return Err(
                        "Integration-profile purge refused a redirected directory.".to_string()
                    );
                }
                fs::remove_dir_all(entry.path()).map_err(|error| {
                    format!("An integration profile could not be removed: {error}")
                })?;
                removed += 1;
            }
        }
    }
    let adoption_root = root.join(".adoptions");
    if adoption_root.is_dir() {
        for entry in fs::read_dir(&adoption_root)
            .map_err(|error| format!("Adoption journals could not be enumerated: {error}"))?
        {
            let entry =
                entry.map_err(|error| format!("An adoption journal is invalid: {error}"))?;
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(&format!("{app_namespace}--"))
            {
                fs::remove_file(entry.path()).map_err(|error| {
                    format!("An adoption journal could not be removed: {error}")
                })?;
            }
        }
    }
    Ok(removed)
}

#[tauri::command]
pub fn purge_integration_profiles(
    app_namespace: String,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<IntegrationProfilePurgeResult, String> {
    require_trusted_shell(&caller)?;
    if !valid_app_namespace(&app_namespace) {
        return Err("The integration-profile package namespace is invalid.".to_string());
    }
    if state.integration_namespace_is_active(&app_namespace)? {
        return Err("Package integration profiles are still active.".to_string());
    }
    Ok(IntegrationProfilePurgeResult {
        removed: purge_at_root(state.profile_root(), &app_namespace)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "nammu-t0-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            TEST_ROOT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn request(partition: &str) -> IntegrationProfileAdoptionRequest {
        IntegrationProfileAdoptionRequest {
            app_namespace: "pkg-0123456789abcdef01234567".into(),
            migration_id: "telegram-core-v1".into(),
            migration_version: 1,
            legacy_namespace: "telegram".into(),
            legacy_profile_id: partition.into(),
            destination_profile_key: "pkg-0123456789abcdef01234567-telegram".into(),
            partition_key: partition.into(),
        }
    }

    #[test]
    fn atomically_adopts_and_replays_without_overwriting() {
        let root = root();
        let request = request("account-a");
        let source = root.join("telegram/account-a");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("Cookies"), b"authenticated").unwrap();
        assert_eq!(
            adopt_at_root(&root, &request).unwrap().status,
            IntegrationProfileAdoptionStatus::Adopted
        );
        assert_eq!(
            adopt_at_root(&root, &request).unwrap().status,
            IntegrationProfileAdoptionStatus::AlreadyAdopted
        );
        assert_eq!(
            fs::read(
                root.join("integration/pkg-0123456789abcdef01234567-telegram/account-a/Cookies")
            )
            .unwrap(),
            b"authenticated"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn adopts_multiple_legacy_accounts_into_independent_partitions() {
        let root = root();
        for account in ["account-a", "account-b"] {
            let source = root.join("telegram").join(account);
            fs::create_dir_all(&source).unwrap();
            fs::write(source.join("Cookies"), account.as_bytes()).unwrap();
            assert_eq!(
                adopt_at_root(&root, &request(account)).unwrap().status,
                IntegrationProfileAdoptionStatus::Adopted
            );
        }
        for account in ["account-a", "account-b"] {
            assert_eq!(
                fs::read(
                    root.join("integration/pkg-0123456789abcdef01234567-telegram")
                        .join(account)
                        .join("Cookies")
                )
                .unwrap(),
                account.as_bytes()
            );
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_destination_collision_and_invalid_namespace() {
        let root = root();
        let request = request("account-a");
        fs::create_dir_all(root.join("telegram/account-a")).unwrap();
        fs::create_dir_all(
            root.join("integration/pkg-0123456789abcdef01234567-telegram/account-a"),
        )
        .unwrap();
        assert!(adopt_at_root(&root, &request)
            .unwrap_err()
            .contains("Both legacy"));
        let mut invalid = request.clone();
        invalid.legacy_namespace = "../browser".into();
        assert!(adopt_at_root(&root, &invalid).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn recovers_a_move_completed_before_final_journal_write() {
        let root = root();
        let request = request("account-a");
        let destination = root.join("integration/pkg-0123456789abcdef01234567-telegram/account-a");
        fs::create_dir_all(&destination).unwrap();
        write_journal(
            &journal_path(&root, &request),
            &journal_for(&request, JournalState::Prepared),
        )
        .unwrap();
        assert_eq!(
            adopt_at_root(&root, &request).unwrap().status,
            IntegrationProfileAdoptionStatus::AlreadyAdopted
        );
        let completed = read_journal(&journal_path(&root, &request))
            .unwrap()
            .unwrap();
        assert_eq!(completed.state, JournalState::Complete);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn purge_removes_only_the_requested_package_namespace() {
        let root = root();
        fs::create_dir_all(root.join("integration/pkg-0123456789abcdef01234567-telegram/a"))
            .unwrap();
        fs::create_dir_all(root.join("integration/pkg-aaaaaaaaaaaaaaaaaaaaaaaa-other/a")).unwrap();
        assert_eq!(
            purge_at_root(&root, "pkg-0123456789abcdef01234567").unwrap(),
            1
        );
        assert!(!root
            .join("integration/pkg-0123456789abcdef01234567-telegram")
            .exists());
        assert!(root
            .join("integration/pkg-aaaaaaaaaaaaaaaaaaaaaaaa-other")
            .exists());
        let _ = fs::remove_dir_all(root);
    }
}
