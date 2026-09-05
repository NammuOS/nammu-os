# Nammu OS Desktop Performance Engineering Report (Gecko baseline)

> This is the retained before-migration baseline. Current native-WebView2 results are recorded in
> `desktop-native-webview-performance.md`.

Date: 2026-09-03  
Target: Windows x64, Tauri 2 release build, packaged Node/Next local server, WebView2, Gecko/WASM

## Executive result

This pass optimized the existing architecture rather than replacing it. Nammu's React window manager remains authoritative, the packaged local-first service boundary is unchanged, and Nammu Browser still uses Gecko/WASM through local Wisp.

The largest shipped improvements are:

- stateful Gecko applications survive minimize and restore in milliseconds instead of rebuilding an engine;
- closing or retrying Browser, WhatsApp, or YouTube Music invokes an explicit Gecko worker teardown hook;
- the desktop application entry chunk fell from approximately 1.216 MB to 417.5 KB (about 65.7% smaller) through application- and tool-level lazy loading;
- stabilized shell CPU fell from 4.094 CPU-seconds per 10-second sample to 0.500 (about 87.8% lower) after removing permanently-running paused animations and reducing wallpaper rendering cost;
- window drag and resize use requestAnimationFrame-coalesced direct geometry and commit React state only at the end of the gesture;
- background polling and rendering work is reduced without suspending expected messaging, media, or browser network behavior.

The dominant remaining cost is fundamental: Browser, WhatsApp, and YouTube Music currently create three independent Gecko/WASM engines. A measured three-engine state used approximately 5.34 GB working set and 7.27 GB private memory. That cost cannot be responsibly removed with a small React optimization.

## Architecture observed

```text
NammuOS.exe
  Tauri host
    WebView2: React desktop and React window manager
    packaged Node/Next local server
      SQLite
      memory cache
      loopback Wisp

React desktop window
  Browser       -> Firefox-WASM iframe -> Gecko engine -> local Wisp
  WhatsApp      -> Firefox-WASM iframe -> Gecko engine -> local Wisp
  YouTube Music -> Firefox-WASM iframe -> Gecko engine -> local Wisp
```

Nammu Browser correctly uses one Gecko engine per Browser application session, not one engine per browser tab. WhatsApp also maps its account shortcuts to contextual Gecko tabs within its own single engine.

## Measurement method

Measurements used the actual release executable at `src-tauri/target/release/nammu-os.exe`, not Vite development mode. WebView2 remote debugging was enabled only for the profiling launch. The harness captures navigation timing, DOM/runtime counts, CDP performance metrics, Windows process-tree working/private memory, CPU deltas, application readiness, minimize/restore state, iframe counts, and close-time teardown.

Profiling utilities:

- `scripts/start-desktop-profile.ps1`
- `scripts/profile-desktop-performance.mjs`

Startup measurements vary substantially between first-run and warm-run states because a newly linked unsigned executable, WebView2 profile state, Windows Defender scanning, packaged Node module loading, and filesystem cache all affect the first launch. The reliable warm measurement reached the usable shell in approximately 2.1 seconds. A final newly built cold executable reached it in 11.35 seconds; this is recorded rather than presented as an artificial improvement.

## Before and after

| Scenario                                 |             Before |            After | Result                                 |
| ---------------------------------------- | -----------------: | ---------------: | -------------------------------------- |
| Desktop application entry JS             |          ~1,216 KB |         417.5 KB | ~65.7% smaller                         |
| Warm shell navigation/load               |   2,271 / 2,337 ms | 2,077 / 2,100 ms | modest improvement                     |
| Shell CPU over 10 seconds                |        4.094 CPU-s |      0.500 CPU-s | ~87.8% lower                           |
| Shell process-tree working set           |           591.4 MB |         574.9 MB | modest reduction                       |
| Browser minimize -> usable restore       |   engine recreated |             7 ms | engine preserved                       |
| WhatsApp minimize -> usable restore      | ~18.2 s recreation |             6 ms | engine preserved                       |
| YouTube Music minimize -> usable restore | ~17.0 s recreation |            16 ms | engine preserved                       |
| WhatsApp observed isolated open          |             27.4 s |           11.5 s | improved in measured warm-artifact run |
| YouTube Music observed isolated open     |             18.3 s |           10.8 s | improved in measured warm-artifact run |
| Browser tabs / Gecko iframes             |              2 / 1 |            2 / 1 | one engine preserved                   |

The application-ready measurements are machine- and cache-dependent observations, not universal performance guarantees.

## Implemented changes

### Runtime lifecycle

- Added a centralized window-runtime policy and active/background/minimized context.
- Browser, WhatsApp, and YouTube Music remain mounted while minimized.
- Minimized engines keep required background networking/audio behavior but reduce UI polling and visual work.
- Ordinary applications still unmount on minimize, avoiding needless retained trees.
- Firefox-WASM exposes `geckoDispose`, backed by Emscripten pthread runtime termination.
- Each Gecko wrapper retains a durable runtime handle because React clears DOM refs before passive unmount cleanup.
- Retry and close paths dispose the old engine and clear the retained handle.
- Packaged-runtime instrumentation observed exactly one disposal call when Browser closed.

### React and window manager

- Window components are memoized.
- Unchanged `WindowState` object identities are preserved during focus and window-list updates.
- Drag updates are coalesced to animation frames and applied as a compositor transform.
- Resize updates are coalesced to animation frames and persisted after pointer release.
- Snap preview state changes only when the target edge changes.
- A 122-event packaged drag trace produced one layout; the equivalent resize produced 28 layouts while applying live size feedback.

### Loading and bundle topology

- System applications are split into lazy chunks.
- Tool families are resolved through a lazy component registry.
- Desktop and standalone routes use explicit Suspense boundaries.
- Browser, Cloud, Maps, Settings, WhatsApp, YouTube Music, and the large converter/developer/tool families are not part of the desktop application entry chunk.
- Registry tests prove every existing tool remains addressable.

### Browser

- Browser keeps one long-lived Gecko session across Nammu browser tabs.
- Page-state polling stops while minimized and slows while backgrounded.
- The selected Gecko docshell is marked inactive while minimized to suppress hidden painting without destroying the session.
- Close and retry now terminate the engine explicitly.

### WhatsApp

- The authenticated Gecko session and contextual account tabs survive minimize.
- Minimize/restore no longer produces another login/runtime bootstrap.
- Close and retry explicitly dispose the engine.

### YouTube Music

- The visualizer requestAnimationFrame loop now exists only when the visualizer is enabled and the application is foregrounded.
- Media polling updates React state only when meaningful metadata or playback state changes, not for every current-time tick.
- Media, SponsorBlock, and settings reconciliation intervals slow in background/minimized phases.
- Animated thumbnail/background work pauses outside the foreground.
- Playback remains independent and is not paused merely because the Nammu window is backgrounded.
- Close and retry explicitly dispose the engine.

### CSS, compositor, and wallpaper

- Paused equalizer bars use no animation rather than a permanently paused animation timeline.
- Status indicators are static by default; a dedicated live class remains available where a genuinely changing signal is justified.
- Matrix rendering caps device pixel ratio at 1.25, reduces expensive glow work, respects document visibility/reduced motion, and lowers its cadence while windows cover the desktop.
- The selected wallpaper, visual identity, and effects remain intact.

## Native WebView2 feasibility decision

Moving WhatsApp and YouTube Music into Tauri child WebViews was investigated and intentionally not shipped.

Tauri exposes child webviews with native position, size, visibility, focus, and close operations. On Windows, however, Wry creates these child WebViews above the parent WebView's z-order. They therefore do not participate in the React desktop's DOM stacking context. A native child surface can cover Nammu title bars, menus, dialogs, overlapping windows, snapping previews, and other React-managed content regardless of CSS `z-index`.

Hiding child WebViews whenever another React window overlaps them would produce blank or flickering windows and would break side-by-side workflows. Correctly solving this requires a native composition/window coordination layer, not a small WebView substitution. That would violate the locked architecture in which the React window manager is authoritative and Rust stays thin.

This migration is therefore classified as **blocked by native surface composition semantics**, not rejected forever. It should be reconsidered only if Tauri/Wry supports compositing child webviews within the parent webview's visual tree, or if Nammu explicitly approves a larger native composition architecture.

References:

- [Tauri Webview JavaScript API](https://v2.tauri.app/reference/javascript/api/namespacewebview/)
- [Official Tauri multiwebview example](https://github.com/tauri-apps/tauri/blob/dev/examples/multiwebview/main.rs)
- [Wry Windows child-webview z-order implementation](https://github.com/tauri-apps/wry/pull/1271)

## Remaining constraints

- Three simultaneously open Gecko applications remain memory-heavy. The measured final state was ~5.34 GB working set / ~7.27 GB private memory.
- Explicit worker termination stops runtime activity, but WebView2 may retain detached WASM address space until JavaScript garbage collection. In one three-engine close test, memory remained elevated until diagnostic GC, after which it fell to ~794 MB working set / ~512 MB private memory.
- Concurrently starting multiple Gecko engines creates CPU, memory, and disk contention. In a three-engine sequence, WhatsApp readiness could extend to roughly 50 seconds even though its isolated observed opening was 11.5 seconds.
- First launch of a newly linked unsigned binary remains vulnerable to antivirus and cold-filesystem variability.
- The existing 127 lint warnings are unrelated repository cleanup debt; lint exits successfully with zero errors.

## Release and regression result

- `bun test`: 139 passed, 0 failed, 1,032 expectations.
- `bun run typecheck`: passed.
- `bun run lint`: passed with 0 errors and 127 existing warnings.
- `bun run build`: passed; all app/API/standalone routes built.
- `bun run desktop:web:build`: passed; 2,337 modules transformed.
- Rust formatting/check/tests: passed; 6 Rust tests passed.
- Packaged Node/Next lifecycle smoke: passed on an OS-selected numeric `127.0.0.1` port.
- Tauri optimized x64 release build: passed.
- NSIS build: passed.
- Release sensitive-data verifier: passed with 0 forbidden matches.
- Single instance: second launch exited; one host and one local Node server remained.
- Normal Windows close: host exited and left 0 Node children.
- Forced host termination: host exited and left 0 Node children/debug listener.
- Final EXE: `src-tauri/target/release/nammu-os.exe` (79,799,808 bytes).
- Final NSIS installer: `src-tauri/target/release/bundle/nsis/Nammu OS_4.1.0_x64-setup.exe` (137,275,053 bytes).

## Recommended future work

1. Treat a shared Gecko service/process architecture as a separate research project if the product needs all three Gecko-based applications open concurrently. Do not attempt it as a component refactor.
2. Add repeatable Windows ETW/WPA cold-start capture on a clean release machine to separate Defender, Node module loading, WebView2 startup, and UI boot.
3. Add memory-pressure UX that explains the cost of starting a third Gecko application and allows users to close inactive engines intentionally; do not silently kill authenticated/background sessions.
4. Revisit native WebView2 only after the surface-composition constraint changes or a native composition phase is explicitly approved.
