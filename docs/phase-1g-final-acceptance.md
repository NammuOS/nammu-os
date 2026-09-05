# Nammu OS Phase 1G final acceptance (historical checkpoint)

> This report predates the completed Desktop native-web-surface migration. Its Gecko/Wisp Desktop
> measurements describe the old runtime and are retained as the performance baseline. The current
> contract is documented in `desktop-remote-web-surfaces.md`.

Date: 2026-09-02  
Version: 4.1.0  
Target: Windows x64  
Release class: unsigned development/private-preview build

The locked desktop architecture remains unchanged:

```text
Tauri 2
  -> bundled React/Vite frontend
  -> packaged Node/Next local server
  -> dynamic numeric 127.0.0.1:<ephemeral-port>
  -> SQLite + memory cache + local Wisp
  -> Gecko/WASM + user-owned external providers
```

There is no hosted Nammu backend, Vercel fallback, remote Wisp, fixed local port, desktop PostgreSQL dependency, desktop Redis dependency, broad filesystem grant, or React-window-manager replacement.

## Acceptance summary

| Area                        | Result         | Evidence                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Drive real account   | DEFERRED       | Real account selection and consent succeeded. The first token exchange proved this Desktop client requires its non-confidential client-secret metadata. The corrected acceptance build is installed; successful callback completion and real Drive operations still require the user's retry and are not yet claimed. |
| CSP                         | PASS           | A scoped Tauri CSP is active in the packaged EXE. Packaged Browser, Gecko/WASM, blob workers/frames/images, Maps tiles, and media passed without CSP violations. Cross-origin and inline-script probes were blocked. COOP/COEP, `crossOriginIsolated`, and `SharedArrayBuffer` remain intact.                                         |
| Native notification         | PASS           | The packaged Windows permission flow reached granted state and the native plugin delivered the acceptance notification without crashing. Denied behavior remains graceful and tested.                                                                                                                                                 |
| Installer maintenance       | PASS           | Reinstall/repair over the installed 4.1.0 build succeeds, replaces the generated local runtime, preserves SQLite and the DPAPI vault byte-for-byte, keeps one install identity, and leaves no orphan runtime.                                                                                                                         |
| Older-version upgrade       | NOT EXECUTABLE | No retained older valid Tauri/NSIS Nammu OS installer exists. A cross-version success is not fabricated.                                                                                                                                                                                                                              |
| Clean-machine acceptance    | NOT EXECUTABLE | No clean Windows VM or Windows Sandbox is available on this host. Current-host acceptance used only the installed artifact and restricted runtime assumptions, but does not substitute for a clean-machine release gate.                                                                                                              |
| Footprint                   | PASS           | Safe source-map pruning removes 2,884 generated maps (115,545,793 bytes) from the generated packaged-server staging tree. Installed size fell from 541,428,298 to 425,880,163 bytes, a 21.34% reduction.                                                                                                                              |
| Signing                     | DEFERRED       | EXE and installer are unsigned. No code-signing certificate or Trusted Signing configuration is available.                                                                                                                                                                                                                            |
| Wisp credential persistence | PASS           | Branded Firefox persists only GPU/JIT preferences. A one-time bridge cleanup removes the legacy `wisp` field. The installed WebView LevelDB's latest preference record contains no Wisp marker or capability.                                                                                                                         |

## Google Drive status

The implementation remains the approved native/Desktop-app flow:

- client type: Google OAuth 2.0 **Desktop app**;
- redirect shape: `http://127.0.0.1:<OS-selected-random-port>`;
- authorization code flow with PKCE S256;
- Desktop client ID and required client-secret metadata confined to the packaged local server;
- unpredictable, expiring, single-use state;
- byte-identical redirect URI for authorization and token exchange;
- scope: `https://www.googleapis.com/auth/drive` because Nammu manages existing Drive content;
- refresh token encrypted only through the DPAPI-backed `CredentialVault`;
- access tokens, refresh tokens, authorization codes, state, verifier, and vault material remain server-side;
- every non-Google desktop provider remains denied.

The system browser completed real account selection and consent. The subsequent token request established that this specific Desktop client requires its client-secret metadata even with PKCE. The corrected build now supplies that metadata only from the packaged local-server configuration. Successful callback completion, real hierarchy loading, create/upload/download/preview/rename/star/move/trash/restore, restart persistence, live refresh, disconnect, and reconnect remain unverified until the next real-account retry; Google Drive is not described as production-complete.

The Desktop client secret is packaged as non-confidential installed-app metadata. It is not exposed to React and is not treated as proof of application authenticity. PKCE remains mandatory, and user access/refresh tokens remain encrypted in the DPAPI-backed vault.

## CSP result

The packaged policy uses a deny-by-default resource model:

- `default-src 'self'`;
- scripts limited to self, blob, and `wasm-unsafe-eval` (no broad `unsafe-eval`);
- network access limited to self, Tauri IPC, data, and dynamic numeric loopback HTTP/WS;
- images limited to self/data/blob/HTTPS;
- media limited to self/data/blob and the currently required audio origin;
- frames/workers limited to self/blob;
- objects limited to self/blob;
- `base-uri` and `frame-ancestors` limited to self.

Packaged acceptance verified:

- Gecko/WASM initialization;
- `crossOriginIsolated === true`;
- `SharedArrayBuffer` availability;
- local Wisp navigation;
- blob worker, image, and frame probes;
- OpenStreetMap tile loading;
- music playback resource loading;
- inline-script and disallowed cross-origin fetch blocking;
- zero CSP violations during the tested Browser, Maps, and music workflows.

COOP remains `same-origin`; COEP remains `credentialless`.

## Installer and lifecycle result

The NSIS installer remains current-user and does not require elevation. The upgrade hooks remove only the generated `$INSTDIR\resources\local-server` tree before install/uninstall so obsolete Next build IDs cannot accumulate. They never remove `%LOCALAPPDATA%\com.nammu.os`, SQLite, the vault, or WebView user state.

Verified on the final installed artifact:

- installer exit code 0;
- application identity `com.nammu.os` unchanged;
- SQLite and DPAPI master-key files preserved byte-for-byte;
- one Tauri host and one packaged Node child;
- exactly one numeric loopback listener and no non-loopback listener;
- active Browser/Wisp loopback and outbound Internet connections;
- second launch exits while the existing instance remains;
- forced host termination leaves zero orphan children;
- normal close cleans children after the shutdown grace period.

The actual EXE metadata reports:

- product: `Nammu OS`;
- product/file version: `4.1.0`;
- copyright: `Copyright © 2026 Nammu OS`.

## Installed footprint

Final installed size: **425,880,163 bytes (406.15 MiB)** across 8,468 files.

The embedded frontend categories below use the uncompressed Vite build inputs; together with the host/embedding overhead they exactly reconcile to the installed EXE size.

| Category                             |       Bytes |    MiB | Percent |
| ------------------------------------ | ----------: | -----: | ------: |
| Gecko/WASM/browser assets            |  56,528,364 |  53.91 |  13.27% |
| Other bundled Vite/frontend assets   |  15,243,557 |  14.54 |   3.58% |
| Tauri host/PE and embedding overhead |   7,976,687 |   7.61 |   1.87% |
| Packaged Node runtime                |  89,894,400 |  85.73 |  21.11% |
| Production runtime `node_modules`    | 243,223,251 | 231.96 |  57.11% |
| Next production build output         |  12,738,954 |  12.15 |   2.99% |
| Local-server integration/config      |     127,765 |   0.12 |   0.03% |
| Local-server manifest                |         405 |   0.00 |   0.00% |
| NSIS uninstaller                     |     146,780 |   0.14 |   0.03% |

Largest runtime dependency groups include `@next` (106.21 MB), `next` (90.93 MB), `@img` (19.48 MB), `better-sqlite3` (12.31 MB), and `react-dom` (7.32 MB). They are part of the traced production closure or required native runtime.

### Optimization classification

**Required**

- Gecko/WASM assets;
- bundled Node executable;
- traced Next server/runtime closure;
- `better-sqlite3` and required image/native bindings;
- the Vite frontend and local fonts;
- the Tauri host and NSIS uninstaller.

**Safe optimization implemented**

- remove only generated `.map` files from the newly regenerated desktop staging directory;
- verify the release contains zero maps and record the removed count/bytes in the manifest;
- remove stale generated local-server resources during install/upgrade.

Before: 541,428,298 bytes.  
After: 425,880,163 bytes.  
Saved: 115,548,135 bytes (21.34%).

**Risky / not worth it**

- manual pruning inside Next's traced runtime dependency closure;
- deleting Next/native locales or package files without upstream support;
- maintaining a hand-curated dependency allowlist;
- splitting Gecko or the server into remotely downloaded components;
- architecture changes solely for a smaller installer.

## Security and persistence

- Release verification found zero sensitive configuration matches.
- No API or Wisp capability appears in command lines.
- The per-launch Wisp capability stays in the bridge closure and is removed from the iframe URL/history after bootstrap.
- The latest installed `chrome-demo-opts` record contains GPU/JIT only, not Wisp.
- SQLite contains no plaintext provider credential; no real Google credential exists because consent did not complete.
- DPAPI protects vault master material; AES-256-GCM protects provider envelopes with authenticated metadata.
- All desktop-local reads/mutations use one-time method/path-bound proofs.
- Wisp and API capabilities remain separate.
- Generic `/api/browser/proxy` and unreviewed desktop routes remain denied.
- The local server binds only numeric `127.0.0.1` on an OS-selected port.

## Fresh final release gates

| Gate                        | Final result                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `bun test`                  | PASS - 126 tests, 0 failures, 973 assertions across 37 files                         |
| `bun run typecheck`         | PASS                                                                                 |
| `bun run lint`              | PASS - 0 errors; 129 existing warnings                                               |
| `bun run build`             | PASS - Next.js 16.3.1; 28 prerender tasks completed                                  |
| `bun run desktop:web:build` | PASS - 2,334 modules; known non-blocking large-chunk warning                         |
| Rust fmt/check/tests        | PASS - 6 tests, 0 failures                                                           |
| Packaged local-server smoke | PASS - dynamic numeric loopback and graceful control-pipe shutdown                   |
| `bun run desktop:build`     | PASS - clean top-level exit; Next, Vite, optimized Rust, NSIS, verifier              |
| Release verifier            | PASS - 8,466 runtime files, 345,984,775 bytes, zero sensitive matches                |
| Final installer run         | PASS - exit 0; persistent state preserved                                            |
| Packaged Browser/Wisp       | PASS - one local runtime, no LAN listener, active loopback Wisp and Internet traffic |
| Single instance             | PASS - one host and one Node runtime after second launch                             |
| Forced cleanup              | PASS - zero orphan children                                                          |
| Wisp localStorage audit     | PASS - latest preference record has no Wisp capability                               |

## Windows signing and distribution

Both final artifacts report `NotSigned`. No Current User code-signing certificate is installed and no signing secret/configuration is present.

For a trusted public Windows release, configure a real Authenticode certificate or Microsoft Trusted Signing in the release pipeline, protect credentials in CI secret storage, timestamp signatures, sign both the EXE and installer, and verify signatures before publication. This requires release configuration only; it does not require an application architecture change.

An auto-updater remains intentionally absent because no authenticated update channel has been approved. No remote Nammu service was introduced for updates.

## Final artifacts

- EXE: `src-tauri\target\release\nammu-os.exe` - 79,748,608 bytes
- NSIS: `src-tauri\target\release\bundle\nsis\Nammu OS_4.1.0_x64-setup.exe` - 137,250,674 bytes
- Version: `4.1.0`

## RELEASE READY

- Nammu OS Web and desktop runtime separation;
- local-first Tauri/React/Node/Next/SQLite/Wisp architecture;
- packaged Browser/Gecko/Wisp runtime;
- scoped CSP with Gecko isolation preserved;
- platform capabilities and granted/denied notification handling;
- current-user NSIS install/reinstall/uninstall behavior;
- single-instance and process cleanup;
- SQLite/vault persistence and localhost security;
- safe release footprint reduction;
- final automated, production-build, packaging, and installed-runtime gates.

## DEFERRED FOR PUBLIC DISTRIBUTION

- Authenticode/Trusted Signing and SmartScreen reputation;
- Google OAuth verification/publication requirements for the full Drive scope;
- a signed, authenticated update channel if auto-update is approved later;
- the real Google consent/account/Drive-operation acceptance run.

## KNOWN LIMITATIONS

- Google Drive's implementation is automated/security verified but not real-account production-accepted in this run because consent was not completed.
- A true older-version-to-4.1.0 upgrade cannot be claimed until an older valid installer is retained.
- Clean-machine/VM installation was not available on this Windows host; it remains a release-process gate before broad distribution.
- The desktop frontend retains a non-blocking approximately 1.2 MB JavaScript chunk warning.
- The current artifacts are unsigned development/private-preview binaries.

## NOT PLANNED

- hosted Nammu backend, Vercel fallback, VPS, or remote Wisp;
- fixed local-server port;
- broad filesystem access, generic shell execution, Tauri HTTP/localhost plugins;
- desktop PostgreSQL/Redis dependency;
- system tray, auto-start, global shortcuts, or image/file clipboard without a product requirement;
- Stronghold replacement for the working Windows DPAPI vault;
- speculative updater or architecture-breaking dependency surgery.
