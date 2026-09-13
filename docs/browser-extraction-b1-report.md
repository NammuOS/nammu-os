# Nammu Browser B1 completion report

Status: complete, based on `v0.8.0-integration-runtime`.

## Final architecture

`os.nammu.browser` is an independent integration application in
`https://github.com/NammuOS/nammu-browser`. The package owns Browser UI, tabs,
new-tab workspaces, bookmarks, history and preferences. It imports the public
`@nammu/sdk` contract and receives only opaque WebSurface handles.

- Web: package -> Core capability broker -> one pooled Gecko/WASM session per
  package profile -> local Wisp -> Internet.
- Desktop: package -> Core capability broker -> Core-owned WebView2 child
  surfaces -> Internet.
- Core: nmu, package VFS, signing trust, AppSandboxHost, WebSurface ownership,
  navigation policy, Gecko/Wisp, WebView2, dialogs and service mediation.

There is no Browser app-ID privilege branch and no Gecko, Wisp, WebView2,
Tauri, signing or nmu implementation in the package.

## Package and distribution

- Application ID: `os.nammu.browser`
- Version/tag: `v1.0.0`
- Publisher: `nammu-official`
- Publisher key: `nammu-official-2026-09`
- Release asset:
  `https://github.com/NammuOS/nammu-browser/releases/download/v1.0.0/os.nammu.browser-1.0.0-signed.napp`
- Size: 626,055 bytes
- SHA-256: `541af4d497a43e7c2576ff3bd061565dc6fed07a84cd34019ba267a39d364ea6`

The Store pins the immutable URL, size and digest. The downloaded manifest, not
catalog prose, remains authoritative for permission review; nmu remains
authoritative for publisher/signature verification.

## Persistence migration

The official one-time migration is restricted to:

- `nammu_browser_bookmarks`
- `nammu_browser_history`
- `nammu_browser_preferences`
- `nammu_browser_new_tab_workspace_v1`

The values move into package-owned settings. Core-owned Gecko and WebView2
profiles remain host-managed and cannot be inspected by package JavaScript.
Uninstall retains package user data unless the user explicitly requests a
purge; reinstall recovers it.

## Generic B0 extensions used by Browser

B1 added only reusable host contracts: surface zoom, popup/open-request events,
typed proxy routes, and deny-by-default named `browser.search` and
`browser.public-proxies` services. Runtime detection and privileged operations
remain centralized in Core. Website upload uses the host-mediated picker path;
website downloads remain owned by the host WebSurface, while bounded package
exports use the approved save capability.

## Acceptance evidence

- Browser repository: 7/7 product/boundary tests; TypeScript and production
  package build passed.
- Signed nmu lifecycle: install, official verification, update activation,
  rollback, repair, data-retaining uninstall, reinstall and data recovery
  passed.
- AppSandboxHost: scoped legacy migration, Browser UI launch, two logical tabs
  sharing one pooled Gecko iframe, teardown and reopen passed.
- Remote Store: actual immutable GitHub asset was fetched three times for
  install, repair and reinstall; pinned digest, permissions and signature were
  verified; browsing/bookmark persistence and close/reopen passed.
- Core: 332/332 tests passed; TypeScript passed; ESLint passed with zero errors
  and 167 pre-existing warnings; Next production and Desktop Vite builds
  passed.
- Native: `cargo fmt --check` and `cargo check` passed; 86/86 Rust tests passed.
- Packaged server: production-only Node/Next staging and dynamic numeric
  loopback lifecycle smoke passed.
- Windows release: Tauri release EXE and NSIS installer passed the strict
  release verifier with zero sensitive-configuration matches.
- Packaged process smoke: a second launch exited through single-instance
  handling; normal close succeeded; zero local-runtime child processes remained.

The B0 native WebSurface suite verifies WebView2 creation, navigation,
back/forward/reload, focus, visibility, zoom, state events, ownership isolation
and destruction. B1 uses that same generic contract; it did not add a second
Desktop browsing runtime.

## Core deletion

The built-in `src/components/browser` product implementation and its duplicate
product tests are removed. Core launchers and `/browser` now launch
`os.nammu.browser` through `AppSandboxHost`. Generic public-proxy services and
Gecko/WebSurface host implementation remain in Core.

## Known product limitations

B1 deliberately does not claim unrestricted package-side downloads: large
website downloads are host-managed and the package cannot read them back.
Desktop per-surface proxy switching reports unsupported rather than bypassing
WebView2 security. Some legacy Gecko-only advanced UI commands (including
engine preferences/password internals and split-view chrome) were not made into
package privileges; exposing them later requires separate generic contracts and
product work. These limitations do not change the Web Gecko/Desktop WebView2
runtime split.

## Release outputs

- EXE:
  `C:\Users\navne\AppData\Local\NammuCodexCache\nammu-active-target\release\nammu-os.exe`
- NSIS:
  `C:\Users\navne\AppData\Local\NammuCodexCache\nammu-active-target\release\bundle\nsis\Nammu OS_4.1.0_x64-setup.exe`

The remaining `.b1-browser-work` directory is disposable test staging. Its only
remaining native module is currently locked by the active Antigravity IDE and
can be removed after that IDE process exits; it is not tracked, packaged or part
of the release.
