# Remote web surfaces

Date: 2026-09-04  
Status: canonical platform contract

## Engine matrix

| Application   | Web runtime                         | Windows desktop runtime                           | Gecko on desktop |
| ------------- | ----------------------------------- | ------------------------------------------------- | ---------------- |
| Nammu Browser | Gecko/WASM through same-origin Wisp | `NativeWebSurface` through Tauri/Wry and WebView2 | No               |
| WhatsApp      | Gecko/WASM through same-origin Wisp | `NativeWebSurface` through Tauri/Wry and WebView2 | No               |
| Telegram      | Gecko/WASM through same-origin Wisp | `NativeWebSurface` through Tauri/Wry and WebView2 | No               |
| YouTube Music | Gecko/WASM through same-origin Wisp | `NativeWebSurface` through Tauri/Wry and WebView2 | No               |

The application-registry audit found no other remote website wrapper after Telegram was added. Files, Cloud, Maps,
Settings, Music, Projects, Calculator, Notes, Mail, Calendar, Editor, Shell, Nammu AI, the
launcher, and tools are Nammu React applications. Maps fetches tiles and Cloud calls provider
APIs, but neither is a remote web application and neither belongs in a child webview.

Runtime selection is synchronous at the platform boundary. A Tauri runtime never asks for a
Wisp endpoint and never mounts a Firefox-WASM iframe. Native-surface creation failure is surfaced
to the application with a retry action; it does not fall back to Gecko.

```text
Web
React -> GeckoWebSurface -> Gecko/WASM -> same-origin Wisp -> Internet

Desktop
React -> NativeWebSurface -> Tauri/Wry -> platform-native web engine
Windows -> WebView2
```

## Shared lifecycle

`src/components/web-surfaces/NativeWebSurface.tsx` is the single React adapter for all native
remote content. `src/web-surfaces/WebSurface.ts` owns the runtime-neutral managed-surface API,
and `src-tauri/src/web_surface.rs` owns creation, navigation policy, bounds, focus, visibility,
audio/mute state, profiles, popup policy, and destruction.

Only an active, focused, unobstructed Nammu window makes its child surface visible. Minimize,
drag/resize, Start and shell overlays, application drawers, and context menus hide the surface
without destroying it. Restoring the owner shows the same surface and retains its network and
website state. Closing the application destroys its live surfaces.

## Website profile model

WebView2 owns all website cookies, IndexedDB, local storage, service workers, and cache data.
Nammu does not copy website credentials into React state, Nammu local storage, SQLite, logs, or
the provider CredentialVault.

```text
%LOCALAPPDATA%\com.nammu.os\web-surfaces\browser
%LOCALAPPDATA%\com.nammu.os\web-surfaces\whatsapp\<account-id>
%LOCALAPPDATA%\com.nammu.os\web-surfaces\telegram\<account-id>
%LOCALAPPDATA%\com.nammu.os\web-surfaces\youtube-music
```

Normal Browser tabs intentionally share one persistent Browser profile. Private Browser tabs set
Wry's native incognito mode before creation, so they do not reuse the normal persistent session.
WhatsApp and Telegram use one isolated persistent profile per Nammu account tab. YouTube Music
uses one persistent application profile.

## Navigation and popup policy

- Browser accepts credential-free public `http:` and `https:` navigation. Privileged Nammu/local
  origins, URL credentials, `file:`, `javascript:`, `data:`, and custom schemes are rejected.
- WhatsApp top-level navigation is limited to WhatsApp-owned hosts.
- Telegram top-level navigation is limited to Telegram-owned hosts.
- YouTube Music navigation is limited to YouTube and Google-owned hosts needed by sign-in.
- Browser `window.open` and `target=_blank` requests become Nammu Browser tabs.
- Approved WhatsApp, Telegram, and YouTube Music popup flows continue in the same owner surface
  and profile; unapproved popup destinations are denied instead of creating unmanaged native
  windows.

## Security boundary

The local `main` shell webview is trusted. Every remote child webview is untrusted. The Tauri
capability applies only to webview label `main`; remote child labels match no capability. Every
surface command also verifies the caller webview and caller window labels in Rust.

Remote pages cannot invoke Nammu filesystem, dialogs, clipboard manager, CredentialVault,
SQLite, local-server authorization, provider credentials, shell/process, window manager, or
surface-manager commands. The surface API contains typed navigation and lifecycle operations,
not arbitrary page evaluation or shell execution.

Desktop ordinary remote applications have no Wisp consumer. The desktop frontend omits the
`public/firefox-wasm` tree and the packaged local Node server neither imports nor exposes Wisp.
The repository and Web build retain Gecko/WASM and Wisp for Web Nammu.

## Explicit limitations and manual acceptance

- WebView2 proxy configuration is not exposed. The Gecko public-proxy manager remains explicitly
  unavailable on Desktop and never changes the Windows system proxy.
- Native surfaces are rectangular OS child surfaces. They are hidden for React overlays because
  they cannot participate in the shell's CSS stacking context.
- External, non-owner popups from WhatsApp, Telegram, and YouTube Music are currently denied.
  They do not escape into an uncontrolled native window.
- Site microphone, camera, notification, upload, and download behavior uses WebView2's normal
  permission and user-selection flows; no blanket native permission is granted.
- Authenticated WhatsApp and Telegram messaging/media and authenticated YouTube Music playback
  must be accepted manually in the final packaged build. Automated checks must not be presented
  as a substitute for those real-account workflows.
