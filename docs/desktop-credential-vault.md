# Desktop credential vault prototype

Status: active Windows credential boundary for Phase 1C-LOCAL. Google Drive desktop OAuth now uses it; no other desktop provider is enabled.

## Boundary

Provider credentials are owned by the local Node service. React has no vault command, no master-key API, and no route that returns stored credentials. Tauri only unwraps the installation key and delivers it to the supervised Node process through the private bootstrap pipe.

The implementation is deliberately split into two replaceable layers:

1. `Windows key protector`: Windows DPAPI protects one random installation master key.
2. `CredentialVault`: Node encrypts each provider record independently before SQLite persistence.

This keeps a future move from DPAPI to Stronghold or another native protector isolated from cloud-provider business logic.

## Key generation and storage

- The first Windows launch creates a cryptographically random 256-bit master key.
- Windows DPAPI protects the key in current-user scope with UI disabled.
- The protected blob is stored as `vault/master-key.dpapi` under Tauri's application-local-data directory.
- A version header (`NAMMU-DPAPI-V1`) allows deterministic format detection.
- An existing unreadable, malformed, or wrongly sized key fails closed and is never silently overwritten.
- The unwrapped key is sent to the local Node process only in the private stdin bootstrap message. It is not placed in arguments, environment variables, URLs, logs, readiness output, Tauri commands, or localStorage.

## Record encryption

- SQLite stores only a versioned JSON envelope in `credential_vault_entries`.
- Each record uses AES-256-GCM with a new 96-bit random nonce.
- The credential reference is authenticated as additional data, preventing an encrypted record from being reassigned to another provider/account reference.
- The 128-bit authentication tag detects a wrong key or modified ciphertext.
- Plaintext payload buffers and unlocked key buffers are zeroed when their lifecycle ends where the language/runtime permits.
- Raw cloud file contents are not stored in SQLite.

## Lock and unlock lifecycle

- The vault starts unlocked after the Node service receives the launch bootstrap.
- `lock()` zeroes the in-process key and rejects store, retrieve, and delete operations.
- `unlock()` accepts a candidate key in memory. Authentication of existing records detects a wrong key.
- Local-server shutdown locks the vault before closing SQLite.
- There is intentionally no React-exposed lock/unlock command in this checkpoint.

## Recovery and backup behavior

There is no recovery key in this prototype. The DPAPI blob is tied to the Windows user profile that protected it. Copying only the SQLite database to another computer or Windows account does not make credentials recoverable.

Normal Windows password changes are expected to preserve DPAPI access through Windows' profile mechanisms. Administrative password resets, damaged profiles, account migration, or loss of the DPAPI master-key blob can make the vault unrecoverable. In that case Nammu must report the failure and require an explicit future reset/reconnect flow; it must not replace the key silently.

A portable backup/recovery format is not defined yet. Before provider routes are enabled for release, the team must decide whether credentials are intentionally device-bound or whether an explicit password-protected export/recovery design is required.

## Format evolution

Both the DPAPI blob and credential envelopes are versioned. A future protector or record format must use an explicit transactional migration. Unknown versions fail closed. No automatic migration from existing browser localStorage or web database credentials is performed.

## Current provider use and remaining decision

Google Drive access/refresh tokens are stored only as an authenticated vault envelope referenced by `cloud_accounts.credential_ref`. OAuth commit and disconnect update the credential entry and account metadata in one SQLite transaction. Refresh-token rotation overwrites the same encrypted record, and a successful provider revocation removes credentials and cascading file metadata atomically.

DPAPI is the least-complex secure Windows-native implementation for the current target; it is not a permanent rejection of Tauri Stronghold. The long-term choice should be made after deciding recovery, portability, and macOS/Linux requirements. Every future provider still requires its own reviewed OAuth/direct-credential design before its desktop routes can be enabled.
