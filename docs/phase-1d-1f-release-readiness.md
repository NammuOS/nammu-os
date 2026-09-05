# Nammu OS desktop release-readiness report

Date: 2026-09-02  
Version: 4.1.0  
Target: Windows x64  
Runtime architecture: Tauri 2 -> bundled React/Vite -> packaged Node/Next -> dynamic numeric `127.0.0.1:<ephemeral-port>` -> SQLite, memory cache, and local Wisp

This report closes the engineering work for Phase 1D, Phase 1E, and Phase 1F. The live Google-account OAuth journey remains a separate final-acceptance item.

## Audit outcome

| Area                       | Final status                                  | Evidence / boundary                                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Platform runtime selection | COMPLETE AND VERIFIED                         | Deterministic SSR, Web, and Tauri selection tests; no direct Tauri imports in application components.                                                                                                                          |
| Native open/save dialogs   | COMPLETE AND VERIFIED                         | Packaged application displayed Windows `Open` and `Save As`; both cancellation paths completed without data mutation. Only dialog-selected paths enter Tauri's runtime file scope.                                             |
| Web file fallback          | COMPLETE AND VERIFIED                         | Browser File/Blob implementation and capability-shape tests pass.                                                                                                                                                              |
| Arbitrary filesystem API   | NOT JUSTIFIED / SHOULD REMAIN OMITTED         | React receives selected file names/bytes, not a general path primitive. No directory or unrestricted filesystem permission is enabled.                                                                                         |
| Text clipboard             | COMPLETE AND VERIFIED                         | Packaged Projects consumer copied the expected URL through the native capability; the pre-test clipboard was restored.                                                                                                         |
| Image/file clipboard       | NOT JUSTIFIED / SHOULD REMAIN OMITTED         | No current product consumer requires it.                                                                                                                                                                                       |
| Notifications              | COMPLETE AND VERIFIED for permission handling | Unit coverage verifies granted and denied behavior. The packaged machine reported Windows permission `denied`; Nammu correctly suppressed delivery. A visible granted-delivery check requires the user/OS to grant permission. |
| External URLs              | COMPLETE AND VERIFIED                         | Central scheme validation plus packaged Projects opener invocation. No shell primitive exists.                                                                                                                                 |
| Host window controls       | COMPLETE AND VERIFIED                         | Packaged maximize, restore, minimize, close, focus/restore-on-second-launch all passed.                                                                                                                                        |
| Internal window management | COMPLETE AND VERIFIED                         | Browser, Files, Cloud, Settings, Maps, YouTube Music, Projects, and tools remained React-managed windows inside one Tauri host.                                                                                                |
| Windows credential vault   | COMPLETE AND VERIFIED                         | DPAPI-protected master material, AES-256-GCM envelopes with AAD, deterministic lock lifecycle, tamper failure, restart persistence, rotation, and disconnect deletion tests pass.                                              |
| Stronghold replacement     | NOT JUSTIFIED / SHOULD REMAIN OMITTED         | The Windows DPAPI implementation is already narrow and correct.                                                                                                                                                                |
| System tray                | NOT JUSTIFIED / SHOULD REMAIN OMITTED         | Nammu exits predictably; a tray would make close behavior less clear without an approved background workflow.                                                                                                                  |
| Startup registration       | NOT JUSTIFIED / SHOULD REMAIN OMITTED         | No product requirement justifies auto-start.                                                                                                                                                                                   |
| Global shortcuts           | NOT JUSTIFIED / SHOULD REMAIN OMITTED         | Existing in-app shortcuts are sufficient and require fewer permissions.                                                                                                                                                        |
| Single instance            | COMPLETE AND VERIFIED                         | A second release launch exited and restored/focused the first host. Counts remained one Tauri host, one Node child, one local server, and one SQLite writer.                                                                   |
| Offline shell resources    | COMPLETE AND VERIFIED                         | Fonts, icons, frontend JavaScript, Node runtime, Next runtime, SQLite binding, and Gecko/WASM are local/bundled. Internet applications still require Internet by design.                                                       |
| CSP hardening              | DEFERRED                                      | CSP remains a separate resource-graph task because speculative hardening could break Gecko/WASM, workers, Wisp, media, maps, and frames. COOP/COEP remains enforced.                                                           |

## Phase 1D — native capabilities

### Capability implementation

The shared `PlatformCapabilities` contract remains the only application-facing native boundary. It provides:

- user-selected file open and save;
- text clipboard;
- validated external URL opening;
- notification permission and delivery behavior;
- host minimize, maximize/restore, and close;
- Web and Tauri service implementations selected centrally.

The Tauri implementation is now constructed through an injectable environment, allowing deterministic tests without placing Tauri-specific checks or imports throughout React. Native file paths remain inside the implementation. Current native file consumers are deliberately small configuration/backup workflows; large upload and cloud workflows remain streaming HTTP/browser-file flows instead of being converted into memory-heavy Rust commands.

### Tauri permission model

The `main` capability grants only:

- dialog open/save;
- runtime-scoped file read/write;
- default safe URL opening;
- text clipboard read/write;
- notification permission/request/notify;
- host minimize, toggle-maximize, and close.

It does not grant shell execution, the Tauri HTTP plugin, localhost plugin, broad filesystem scopes, directory access, global shortcuts, tray features, or updater permissions.

### Secure storage

The local data layout is:

```text
%LOCALAPPDATA%\com.nammu.os\
├── data\
│   ├── nammu-os.sqlite3
│   ├── nammu-os.sqlite3-wal
│   └── nammu-os.sqlite3-shm
├── vault\
│   └── master-key.dpapi
└── EBWebView\
```

The installed database passed `integrity_check`, uses WAL, has foreign keys enabled, a 5000 ms busy timeout, schema version 3, and three checksum-led migrations. The 277-byte DPAPI master-key blob is not a raw 32-byte key. No sensitive environment value was found in SQLite. The vault table stores an opaque `envelope` rather than plaintext credentials. It currently has zero credential rows because live Google consent is deferred.

## Phase 1E — Windows packaging

### Identity and installer

- Product/file description: `Nammu OS`
- Executable: `nammu-os.exe`
- Stable identifier: `com.nammu.os`
- Publisher metadata: `Nammu`
- Version: `4.1.0`
- Copyright: `Copyright © 2026 Nammu OS`
- Target: Windows x64
- Installer: NSIS, current-user mode, no administrator requirement
- Icons: existing Nammu branding for application, EXE, installer, Start menu, taskbar, and uninstall surfaces

The real NSIS lifecycle passed:

1. current-user installation;
2. uninstall registration and Start menu shortcut creation;
3. installed EXE launch with PATH restricted to Windows system directories;
4. in-place 4.1.0 maintenance/upgrade run while Nammu was active;
5. clean host/Node shutdown during maintenance;
6. clean uninstall of program files, registry entry, and shortcut;
7. byte-for-byte preservation of SQLite and DPAPI vault data.

A true older-version-to-4.1.0 upgrade remains deferred until a retained earlier installer exists; the same-version maintenance path exercises the NSIS replacement and process-cleanup behavior without fabricating an old release.

### Packaged runtime

Release verification reported:

- staged runtime files: 11,350;
- staged Node/Next runtime: 461,530,424 bytes;
- installed files including EXE/uninstaller: 11,352;
- installed footprint: 541,428,298 bytes;
- release EXE: 79,734,784 bytes;
- NSIS installer: 150,288,965 bytes;
- sensitive configuration matches: 0.

The package contains the bundled Node executable, production Next server, runtime dependency closure, `better-sqlite3` native binding, and the local Gecko/WASM frontend resources embedded by Tauri. The installed application started without developer Node, Bun, Rust, Cargo, a package manager, source tree, or developer PATH.

### Configuration, signing, and updates

The Google Desktop OAuth client ID and required Desktop client-secret value are non-confidential installed-app metadata confined to the packaged local-server configuration. Neither reaches React. PKCE remains mandatory, while provider access and refresh tokens remain encrypted and local-server/vault-only.

`RELEASE DISTRIBUTION LIMITATION — unsigned Windows binary`

No signing certificate or Trusted Signing account is configured. The release pipeline can add signing later without changing the runtime architecture. Auto-update remains a future release-system phase: there is no authenticated update channel, and no remote Nammu backend was introduced merely to support updates.

### Authoritative commands

```bash
bun install
bun run dev
bun run desktop:dev
bun run desktop:check
bun run desktop:server:prepare
bun run desktop:server:smoke
bun run desktop:rust:check
bun run desktop:build
bun run desktop:release:verify
```

Final artifacts:

```text
src-tauri\target\release\nammu-os.exe
src-tauri\target\release\bundle\nsis\Nammu OS_4.1.0_x64-setup.exe
```

## Phase 1F — regression and release validation

### Automated gates

| Gate                                           | Result                                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `bun test`                                     | PASS — 123 tests, 0 failures, 949 expectations                                                                       |
| Focused platform/security/database/OAuth suite | PASS — 28 tests, 0 failures                                                                                          |
| `bun run typecheck`                            | PASS                                                                                                                 |
| `bun run lint`                                 | PASS — 0 errors; 129 pre-existing warnings retained rather than broad-refactored                                     |
| `bun run build`                                | PASS — Next.js 16.3.1 production build and route generation                                                          |
| `bun run desktop:web:build`                    | PASS — 2,334 Vite modules; known 1.20 MB chunk warning is non-blocking and intentionally not made a bundling project |
| Rust formatting/check/tests                    | PASS — 6 tests, 0 failures                                                                                           |
| Packaged local-server smoke                    | PASS — dynamic numeric loopback origin and graceful control-pipe shutdown                                            |
| Tauri release build                            | PASS                                                                                                                 |
| NSIS build                                     | PASS                                                                                                                 |
| Release artifact/secret verification           | PASS — zero sensitive matches                                                                                        |
| Web production runtime start                   | PASS — HTTP 200 with same-origin Web behavior                                                                        |

During the first full suite run, the upload-ticket tamper test exposed that a non-canonical Base64URL spelling can decode to the same bytes. Ticket parsing now requires canonical Base64URL and exact IV/tag sizes, so non-canonical/tampered encodings are rejected before AES-GCM processing.

### Packaged runtime acceptance

- Tauri loaded the local React shell at `tauri.localhost`.
- The bundled Node child—not a PATH-installed Node—started the local Next server.
- Each launch selected a new numeric `127.0.0.1` port.
- No server capability, Wisp capability, OAuth state, PKCE verifier, or credential appeared in process command lines.
- React reported `crossOriginIsolated === true` and `SharedArrayBuffer` was available.
- Gecko/WASM initialized once for the Browser application session.
- The Wisp capability fragment was removed from the iframe URL after bootstrap.
- Gecko navigated through local Wisp to `https://example.com/` and loaded `Example Domain` completely.
- Opening Browser did not create a second Node/local-service runtime.
- Normal Tauri close removed host, Node child, Wisp listener, and local listener.
- Force-terminating the verified host caused Windows Job Object cleanup of Node and the listener.
- A second launch exited and restored/focused the existing instance without a second local runtime.

### Localhost security

The security suite verifies:

- numeric `127.0.0.1` binding and OS-selected port 0;
- exact Host and Tauri frontend Origin validation;
- rejection of forwarded-host metadata;
- no wildcard CORS or credential-mode CORS;
- one-time request proofs for reads and mutations;
- method/path-bound replay resistance;
- distinct API and Wisp capabilities;
- exact Wisp Host/Origin/path validation;
- deny-by-default route policy;
- disabled generic `/api/browser/proxy` route;
- private/loopback Wisp destination protection;
- no desktop Redis connection.

The enabled desktop-local application routes are the explicitly reviewed preferences, history, settings, allocation, maps, browser search/public-proxy discovery, music metadata, Subdomain Inspector, and Google-only Drive routes. Generic provider routes, arbitrary browser proxy, tRPC, and every unreviewed route remain denied. All non-Google desktop cloud providers remain disabled at the server boundary.

### Application smoke

The packaged shell successfully opened or exercised:

- Browser and real Gecko navigation;
- Cloud shell with providers still guarded;
- Files;
- Maps;
- YouTube Music shell;
- Settings and native backup dialogs;
- Tools;
- Subdomain Inspector;
- Projects and native clipboard/external-link consumers;
- Launcher/Start menu and search input;
- concurrent internal React windows;
- standalone route production generation and hydration tests.

### Web/desktop separation

The Web production build and custom server remain independent of Tauri, start successfully, use relative/same-origin requests, retain the existing Next routes and web PostgreSQL/optional Redis architecture, and do not import native APIs into React application code. Desktop SQLite and memory-cache selection occurs only in explicit desktop-local runtime mode.

## Final status

| Status                   | Items                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COMPLETE                 | Phase 1D capability boundary; native file/dialog cancellation; text clipboard; safe external URLs; notification permission/denial behavior; host window controls; DPAPI/AES-GCM vault; single instance; local/offline shell assets; Phase 1E metadata/icons/current-user NSIS/runtime packaging; Phase 1F automated, web, release, Gecko, Wisp, SQLite, vault, shutdown, and application smoke gates. |
| DEFERRED                 | Real Google Desktop OAuth consent/account/Drive-operation acceptance; CSP resource-graph hardening; actual granted notification delivery on a Windows profile that permits notifications; true cross-version installer upgrade once an older release artifact exists; code signing until a real certificate/account exists.                                                                           |
| BLOCKED                  | Public distribution trust is limited by the unsigned binary. No architecture or local desktop runtime blocker remains.                                                                                                                                                                                                                                                                                |
| OPTIONAL / NOT JUSTIFIED | System tray, startup registration, global shortcuts, image/file clipboard, Stronghold replacement, speculative updater, broad filesystem/directory access, HTTP/localhost plugins, shell execution, remote Nammu backend, remote Wisp, hosted update service, and bundle-size refactoring during this architecture phase.                                                                             |

Google Drive implementation and automated/security verification remain complete. Its real-account consent journey is recorded as **DEFERRED / FINAL ACCEPTANCE**, not failed and not production-complete. All other desktop cloud providers remain denied.
