# Generic Integration Runtime — B0

Status: implemented and verified independently of Browser extraction.

## Audit findings

Before B0, `.napp` applications ran in an opaque `sandbox="allow-scripts"` iframe with a nonce-bound `MessagePort`. The broker supported app data, text export, clipboard text, notifications, window basics, events, and one-time legacy storage migration. It did not expose host-managed web content, lifecycle state, named services, binary dialogs, or package resources beyond entry-time script/style inlining.

The built-in remote-web applications used a separate trusted path:

- Web Browser used one Gecko/WASM session per Browser window and Wisp.
- Desktop Browser, WhatsApp, Telegram, and YouTube Music used `NativeWebSurface`/WebView2.
- Native surface ownership stopped at the trusted Tauri host webview. It did not distinguish two sandboxed package instances inside that host.
- Native policies were a closed built-in owner enum.

Those gaps made direct Browser extraction unsafe. B0 adds a second package-instance security boundary without moving Browser code.

## Authority model

Authority is the intersection of all of the following:

1. a verified/installed manifest;
2. a declared permission;
3. a persisted named capability declaration;
4. an authenticated sandbox instance and its private MessagePort;
5. Core-side validation and a concrete host implementation.

No single layer grants authority on its own. Package JavaScript receives opaque handles and structured data only. It never receives Tauri imports, WebView2 handles, native surface IDs, local service credentials, filesystem paths, arbitrary `fetch`, process access, or Wisp capability material.

## WebSurface

Manifest declarations use `type: "web-surface"` with an app-local name, a per-instance maximum, profile policy, and either:

- `public-web`; or
- an exact `approved-origins` list.

The separately reviewed `integration.web-surfaces` permission is mandatory.

SDK operations cover create, destroy, attach, detach, relative bounds, visibility, focus, navigation, state, back, forward, reload, stop, mute, and unmute. The broker binds each opaque handle to the authenticated instance and to the exact capability that created it. A second window—even from the same app—cannot inspect or control it. Teardown destroys every remaining surface.

Desktop uses a native `integration` surface owner. Rust revalidates the explicit navigation policy, rejects trusted/local origins, isolates profile storage, and retains the trusted-shell caller check. Web uses a Core-owned Gecko/WASM iframe with Wisp; logical package surfaces sharing an app/profile reuse one Gecko session rather than starting one engine per tab. The sandboxed package cannot access that iframe or its privileged runtime object.

Existing built-in Browser/WhatsApp/Telegram/YouTube Music owners remain unchanged during B0.

## Lifecycle

Packages can read and subscribe to their own state:

- active/background/minimized/suspended;
- visible/hidden;
- focused/blurred;
- activation/deactivation.

Core also hides host surfaces when their owning window is minimized or the document is suspended. Lifecycle events are sent directly to the owning instance rather than broadcast through a cross-app namespace.

## Safe services

`integration.services` plus an exact `service` capability is required. Package calls contain a service name, operation name, and bounded structured payload—not a URL, request headers, credentials, or a bearer token.

The registry is deny-by-default. B0 exposes only `core.runtime.describe`, which returns non-sensitive runtime feature information. Future Browser services must be added as narrow named operations; arbitrary `/api/*` access is deliberately absent.

## Files and package assets

Binary selection and save reuse the existing user-mediated platform dialogs and existing permissions. Limits are:

- at most 32 selected files;
- at most 32 MiB total transferred through package IPC;
- safe suggested names only;
- no native path returned to package code.

Large/streaming downloads remain a B1 design item; B0 intentionally does not disguise a 32 MiB in-memory transfer as a general download manager.

Package assets are read from the active immutable application version through its scoped VFS. Traversal and absolute paths are rejected; each asset is capped at 64 MiB. The signed fixture proves worker source and a WASM module can be loaded from this path. It does not create an HTTP endpoint or expose another app's package.

## Validation

Focused automated coverage proves:

- signed integration capability persistence;
- strict manifest validation;
- permission and declaration intersection;
- cross-instance surface denial;
- capability-swap denial;
- navigation allowlists;
- automatic teardown;
- isolated lifecycle delivery;
- deny-by-default named services;
- bounded, user-mediated binary operations;
- scoped worker/WASM asset loading;
- SDK-only RPC with no direct Tauri surface.

The browser acceptance fixture installs a signed package, runs it through `AppSandboxHost`, reads lifecycle/service/assets over the private channel, compiles packaged WASM, executes a packaged Worker, creates two logical surfaces in one pooled Core-owned Gecko session, queues navigation, and verifies that unmount removes both sandbox and surface frames.

## B1 boundary

B0 does not migrate Browser UI, bookmarks, history, preferences, tabs, downloads, or state. B1 may now replace Browser's Core imports with these generic contracts. It must still prove production Desktop WebView2 behavior, Web Gecko session behavior, streaming/large downloads, safe Browser-specific service operations, and full Store lifecycle before built-in Browser code is removed.
