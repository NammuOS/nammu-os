# Phase 1C-LOCAL implementation checkpoint

Status: the desktop-local runtime foundation, security boundary, data layer, Wisp path, packaging path, and Windows vault prototype are implemented and verified. Desktop cloud-provider integration is intentionally blocked at the required OAuth/provider decision boundary, so the complete cloud portion of Phase 1C-LOCAL is not being declared finished.

## Final process architecture

```text
Web
`-- Next.js + shared React application
    `-- existing custom Node/Next backend
        |-- PostgreSQL
        `-- optional Redis / Upstash

Windows desktop
`-- Nammu OS.exe (Tauri 2 / one WebView2 window)
    |-- local Vite bundle importing the shared React application
    `-- supervised packaged node.exe
        `-- server.mjs on 127.0.0.1:<OS-selected port>
            |-- authenticated local API allowlist
            |-- SQLite WAL database
            |-- memory-only TTL cache
            `-- authenticated local Wisp upgrade
```

The React window manager remains authoritative. Tauri does not turn Nammu apps into native windows and does not replace the Gecko WebAssembly browser engine.

## Server lifecycle

- Rust starts a known development or packaged Node entry; no arbitrary shell command exists.
- Node binds numeric `127.0.0.1` with port `0` and reports the actual origin in a structured readiness message.
- Instance/API/Wisp capabilities are generated cryptographically per launch and delivered through child stdin, not arguments, environment variables, files, logs, or query strings.
- API and Wisp capabilities are independent.
- Tauri uses single-instance protection before starting the server.
- Shutdown requests a graceful close, applies a timeout, and force-terminates if needed.
- A kill-on-close Windows Job Object removes descendants if the native host exits unexpectedly.

The release executable was launched directly after packaging. It started its packaged Node child on an ephemeral loopback port, rejected a second process without starting another Node child, closed gracefully without an orphan, and removed the child after a forced host termination.

## Security boundary

- exact active `127.0.0.1:<port>` Host only;
- forwarded-host/client headers rejected;
- exact Tauri frontend Origin only;
- no wildcard CORS and no desktop credential cookies;
- short-lived, one-time HMAC request proof bound to instance, method, exact path/query, expiry, and nonce;
- authorization required for reads and mutations;
- input size/shape validation for local mutations;
- reviewed route policy with deny as the default;
- reusable API capability remains in Rust;
- provider credentials remain outside React;
- no unrestricted shell, filesystem, HTTP, localhost, updater, global shortcut, or remote-origin grant.

## Local API policy

Enabled local handlers:

- `GET /api/health`
- `GET|POST /api/preferences`
- `GET|POST /api/history`
- `GET|POST /api/settings`

Enabled reviewed stateless handlers:

- `GET /api/maps/search`
- `GET /api/maps/location`
- `GET /api/browser/search`
- `GET /api/browser/public-proxies`
- `POST /api/browser/public-proxies/check`
- `GET /api/music/lyrics`
- `GET /api/music/sponsorblock`
- `GET /api/tools/subdomains`

Google Drive now has an explicit narrow local route set for sanitized accounts, desktop OAuth start/status/cancel, allocation, indexed files, reviewed mutations, preview/download, HTTP uploads, and sync. Generic provider/account routes remain denied after those narrow matches, and the main Next OAuth callback is disabled. OneDrive, Dropbox, Yandex, MEGA, pCloud, and S3 remain disabled. `/api/trpc` remains web-only. `/api/browser/proxy` remains explicitly disabled on desktop. `/api/browser/wisp-endpoint` is unnecessary on desktop because Wisp discovery uses private Tauri IPC.

## SQLite and repository strategy

Desktop opens `%LOCALAPPDATA%/com.nammu.os/data/nammu-os.sqlite3` with:

- WAL;
- foreign keys;
- 5-second busy timeout;
- `trusted_schema = OFF`;
- transactional, checksummed, versioned migrations.

The current schema contains local user/session metadata, cloud account metadata with `credential_ref`, file metadata, settings/history, notes, calendar events, projects, and encrypted credential envelopes. It does not store raw cloud file bodies. Preferences/history/settings use a desktop repository while their web handlers continue using the existing web data layer. Desktop cache selection is explicit and memory-only; it never falls through to Redis.

No existing localStorage is migrated or deleted.

## Credential vault

The Windows prototype creates one random 256-bit installation key and protects it with current-user Windows DPAPI. Node receives the unwrapped key through the private bootstrap, copies it into the vault, and zeroes the bootstrap buffer. Each provider record is independently protected with AES-256-GCM, a fresh nonce, authenticated credential-reference data, and a versioned envelope stored in SQLite.

Tests cover restart persistence, lock/store/retrieve/delete behavior, wrong-key rejection, ciphertext tamper rejection, format versioning, and absence of plaintext provider tokens/master key in SQLite. Recovery/export and the final DPAPI-versus-Stronghold choice remain open. See [the complete vault report](./desktop-credential-vault.md).

## Wisp lifecycle

Gecko receives one local Wisp endpoint per application session through `PlatformServices`. The endpoint is placed in the iframe fragment, captured by the local runtime bridge, and removed from history immediately. The WebSocket upgrade validates exact Host, Origin, path, and the separate Wisp capability. The capability path is stripped before `wisp-js` receives the request, preventing it from being interpreted as a target or included in library diagnostics.

Existing Gecko/WASM files, application-scoped engine lifecycle, tab model, private/loopback destination protection, and cross-origin isolation remain in place. No remote Wisp was introduced.

## Uploads and shell resources

- The phantom `/ws/uploads` dependency was removed.
- Cloud uploads use the authenticated HTTP transport and report only honest completion information available from that transport.
- Preview/download media is fetched through the authenticated platform service and exposed to UI elements through short-lived object URLs.
- Outfit, Syne, and IBM Plex Mono are bundled locally; the desktop shell no longer depends on Google Fonts.

## Google Drive desktop OAuth

Google Drive is implemented as a public/native authorization-code flow with S256 PKCE, cryptographic state, a five-minute one-time memory session, and an exact numeric `127.0.0.1` callback listener on an OS-selected port. The listener is separate from the long-lived Nammu API and closes on completion, cancellation, timeout, or shutdown.

Tokens are exchanged and refreshed server-side, stored only in the DPAPI-backed `CredentialVault`, and never returned to React. SQLite stores sanitized account metadata plus a credential reference and a transactional file hierarchy index. Refresh rotation, revoked access, reconnect, provider revocation, restart persistence, malformed/replayed callbacks, and network failures have focused test coverage.

The packaged release accepts only a separate public `GOOGLE_DESKTOP_CLIENT_ID`; no client secret is packaged and no web client fallback exists. This workspace does not currently provide that ID, so live Google consent was not run. The packaged route was instead verified to fail closed. See [the complete OAuth/provider report](./desktop-oauth-status.md).

## Web/desktop separation

- `bun run dev` and `bun run build` retain the normal Next.js web application.
- Web services use relative same-origin URLs and normal browser credentials.
- Desktop services discover only the supervised dynamic localhost origin and attach request proofs centrally.
- PostgreSQL/Redis remain web concerns; SQLite/memory cache remain desktop concerns.
- Existing `/apps/:id`, `/tools/:id`, and `/browser` web routes build and their SSR/hydration tests pass.
- Desktop uses the same React registries/components without duplicating application business logic.
- No production Nammu service origin or remote backend was added.

## Verification performed

- `bun test`: 118 passed, 0 failed, 924 assertions.
- `bun run typecheck`: passed.
- `bun run lint`: passed with 0 errors and 129 existing warnings.
- `bun run build`: passed with all web and standalone routes.
- `bun run desktop:check`: Vite desktop build and Rust check passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 6 passed, including DPAPI round-trip/persistence and native lifecycle helpers.
- Packaged Node/Next/SQLite/Wisp/Google-route smoke test: passed, including deny-by-default for a non-Google provider and fail-closed missing client configuration.
- `bun run desktop:build`: completed and produced the release EXE plus NSIS installer.
- Direct release launch: the new packaged child started, bound its local service, accepted a main-window close, exited with code `0`, and left no Node child behind.

The Vite build still reports the known roughly 1.2 MB main application chunk. Per phase scope, no unrelated bundling optimization was attempted.

## Artifacts

- `src-tauri/target/release/nammu-os.exe`
- `src-tauri/target/release/bundle/nsis/Nammu OS_4.1.0_x64-setup.exe`

They are unsigned development artifacts.

## Known limitations and remaining decisions

1. Supply a separate Google Desktop application client ID and run the live consent/account acceptance pass before public release. The full Drive restricted scope may require Google verification/security review.
2. Decide the Dropbox/Yandex callback product behavior and prototype OneDrive numeric-loopback registration; these providers remain disabled.
3. Decide device-bound credential recovery/backup and the long-term DPAPI/Stronghold/macOS/Linux key-protector strategy.
4. CSP remains intentionally deferred until the final resource graph is exercised; `csp: null` is not the intended public-release policy.
5. Code signing, release provenance, and public installer policy remain for the Windows release phase.
6. Desktop standalone content in external browser tabs needs a separate product decision; the public `/apps/:id` and `/tools/:id` URLs remain web-runtime routes, while the normal desktop architecture remains one native Tauri window.
7. No live external-provider or PostgreSQL integration test was run in this checkpoint; web code paths were preserved and verified by tests/typecheck/build.
8. The tracked Kubernetes credential issue remains an urgent, separate remediation and must be resolved before public release. See [the remediation runbook](./security-remediation.md).
