# Nammu Browser B1 extraction audit

Status: audit complete; the implemented extraction is recorded in `browser-extraction-b1-report.md`.

## Current product code

Browser-specific product code is concentrated in `src/components/browser`: the tab strip, omnibox, menus, new-tab workspace, bookmark library, history UI, proxy manager, preferences, viewport controls, internal pages and Browser-specific models. `BrowserApp.tsx` also currently contains legacy host adapters for direct Gecko chrome scripting and direct `NativeWebSurface` usage. Those adapters are not product authority and must not move into the package.

The built-in implementation persists four product records in Core-origin `localStorage`:

- `nammu_browser_bookmarks`
- `nammu_browser_history`
- `nammu_browser_preferences`
- `nammu_browser_new_tab_workspace_v1`

The package will use isolated SDK settings and a one-time official migration for exactly those keys. No WebView2 or Gecko profile data moves through package storage.

## Core-owned runtime

The following remain in NammuOS Core:

- `AppSandboxHost`, capability broker, nmu, signing and package VFS;
- the B0 WebSurface contract and instance ownership table;
- Tauri child WebView2 construction, profile directories, navigation policy and event collection;
- Web Gecko/WASM iframe, Wisp bootstrap, pooled Gecko session and privileged Gecko evaluation;
- native dialogs and bounded binary transfer;
- service credentials, local-server capability proofs and route policy.

Package JavaScript receives only opaque surface handles, lifecycle events, bounded data and named service results.

## Required package boundary

The Browser package owns its React UI, product models and persisted preferences. Each remote tab is represented by a generic B0 WebSurface. All tabs in the same Web package/profile reuse one Core-owned Gecko session; Desktop surfaces remain Core-owned WebView2 children. Private-session intent is declared at surface creation and profile storage remains inaccessible to the package.

Browser search and public-proxy discovery require narrow named service operations. Raw `/api/*`, Wisp URLs, request proofs and service credentials are not exposed. Upload/export uses the existing user-mediated binary APIs. Large remote downloads require a host-managed streaming/download event extension; the 32 MiB B0 IPC transfer must not be misrepresented as an unlimited download pipeline.

## Concrete generic gaps found by B1

1. Package surfaces need popup/open-request delivery so a Browser package can create a Nammu tab without exposing native handles.
2. Surface zoom is already implemented by the Core platform but is not exposed through the B0 package broker/SDK.
3. Browser search and proxy discovery need explicit deny-by-default service operations.
4. Web public-proxy routing currently depends on privileged Gecko code in `BrowserApp`; it must become a typed host-managed surface operation or remain honestly unavailable.
5. Streaming surface downloads and website upload mediation need host ownership. They must not be implemented as unrestricted filesystem or fetch access.
6. The standalone `/browser` route must become a generic installed-package host before built-in product code is deleted.

Each gap is reusable by future integration packages and must remain independent of `os.nammu.browser` identity.

## Deletion gate

Core Browser product files and their source-based tests remain until a signed external package proves Web and Desktop rendering, persistence/migration, nmu lifecycle, surface cleanup and Store delivery. Only then may Core retain a generic Browser launcher while deleting the built-in implementation.
