# Native Web Surface validation (completed prototype record)

The Browser proof described here has been promoted to the shared production
`NativeWebSurface` architecture. The canonical cross-application contract is
[`desktop-remote-web-surfaces.md`](desktop-remote-web-surfaces.md). This file retains the original
Browser acceptance evidence only.

Date: 2026-09-04  
Target: Windows x64, Tauri 2.11.5, `tauri-runtime-wry` 2.11.4, Wry 0.55.1, WebView2 152  
Decision: **DESKTOP BROWSER USES THE NATIVE WINDOWS WEB ENGINE**

## Result

Nammu Browser now selects its renderer synchronously at the platform boundary:

```text
Web       -> Gecko/WASM -> Wisp -> Internet
Desktop   -> Tauri/Wry child webview -> WebView2 -> Internet
```

Desktop does not request a Wisp URL, mount the Gecko iframe, or silently start Gecko after a native error. A native failure remains visible and retryable in the same renderer.

Each live desktop Browser tab owns one persistent native surface. Only the selected tab is shown; inactive tabs stay alive so navigation, login, storage, and audio are not lost on tab switches. Closing a tab destroys its surface. Closing Browser releases the native WebView2 profile process.

## Packaged acceptance evidence

The actual release executable was exercised with YouTube and Wikipedia:

| Check | Result |
| --- | --- |
| Browser Gecko iframe count | 0 |
| Browser native surface count after two live tabs | 2 |
| Wikipedia navigation to final title | about 0.5 seconds (warm packaged run) |
| Independent tab state | Passed; YouTube and Wikipedia retained separate pages |
| WebView2 audio state | Passed; YouTube reported active playback |
| Background-tab audio state | Passed while Wikipedia was selected |
| Drag | Passed; native surface hid during interaction and returned afterward |
| Resize | Passed; coalesced bounds updates and final content alignment verified |
| Browser close | Passed; Browser-profile WebView2 processes exited |
| Host close | Passed; Tauri host, packaged Node child, and child WebView2 exited |

The browser home page labels the desktop renderer as `Native Windows Web Engine`; `Full Gecko WebAssembly Engine` remains accurate for Web.

## Composition policy

WebView2 child controllers are native child surfaces and cannot participate in the shell WebView's CSS stacking context. Nammu therefore uses an explicit active-surface policy:

- a native surface is visible only for the active Browser tab in the focused, non-minimized Browser window;
- it is hidden while its Nammu window is dragged or resized;
- it is hidden while shell menus or Browser overlays are active;
- background Nammu windows never leave an input-active native child above the foreground window.

This preserves interaction correctness without replacing Nammu's React window manager. The trade-off is that the website viewport uses its dark placeholder while a React overlay is above it; arbitrary DOM/native interleaving and CSS rounded clipping remain unsupported by the platform.

## Audio and profile lifecycle

The Rust boundary observes WebView2 `IsDocumentPlayingAudio` and `IsMuted`, emits both through typed snapshots, and exposes only fixed `mute` / `unmute` controls. It does not expose general remote-page evaluation.

The persistent Browser profile remains under:

```text
%LOCALAPPDATA%\com.nammu.os\web-surfaces\browser\EBWebView
```

Cookies and website storage remain in WebView2. They are not copied to React, localStorage, Nammu SQLite, or the local Node service.

## Security boundary

- Only the trusted local `main` shell WebView has Tauri capabilities.
- Remote website child labels match no Tauri capability and cannot invoke Nammu commands.
- Rust verifies both caller webview and caller window labels for every surface command.
- Navigation accepts credential-free `http:` and `https:` URLs and rejects Nammu's trusted local origins.
- Remote popups are denied rather than becoming unmanaged privileged windows.
- No arbitrary eval, shell/process, or filesystem primitive exists in the surface contract.
- Surface bounds updates are animation-frame coalesced and serialized; visibility changes are revisioned and serialized.

## Remaining Browser limitations

- Native WebView2 surfaces are rectangular and cannot be interleaved with React using CSS `z-index`.
- Gecko-only `about:` pages are replaced by a safe Nammu internal-page explanation on Desktop; Browser-owned side panels remain available.
- The existing public proxy manager is Gecko-specific and is explicitly unavailable in the native Windows renderer. It never triggers Gecko as a fallback.
- The native surface limit is 24 live website tabs to prevent unbounded WebView allocation.
- Web continues to use Gecko/Wisp because ordinary browser iframes cannot provide equivalent arbitrary-site compatibility.
