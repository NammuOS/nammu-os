# Desktop-local service architecture

This document records the implemented Phase 1C-LOCAL service model. Nammu Desktop has no production Nammu API origin and no remote Wisp dependency.

## Runtime graph

```text
Nammu OS.exe
|-- Tauri 2 / WebView2
|   `-- local Vite bundle using the shared React application
`-- supervised packaged Node runtime
    `-- server.mjs on 127.0.0.1:<OS-selected port>
        |-- authenticated local API allowlist
        |-- SQLite in Tauri app-local data
        |-- memory-only TTL cache
        `-- authenticated /firefox-wisp/<launch capability>
```

Web mode is unchanged: the Next.js application uses same-origin routes, PostgreSQL, and optional Redis. Runtime selection is centralized in `PlatformCapabilities`; React components do not choose service origins or attach desktop authentication themselves.

## Startup and discovery

1. Tauri's single-instance plugin prevents a competing desktop process.
2. Rust creates an instance ID, an API capability, and a separate Wisp capability for the launch.
3. Rust starts the known packaged Node executable and sends private bootstrap data over child stdin. Secrets are not placed in arguments, environment variables, public files, readiness output, or logs.
4. Node binds numeric `127.0.0.1` with port `0` and reports the resulting origin through a structured readiness line.
5. React asks Tauri for public service metadata. For each API request, Tauri creates a short-lived HMAC proof bound to the exact method and path/query. The reusable API capability is never exposed to React.
6. Shutdown first requests a graceful server close, then force-terminates on timeout. A Windows Job Object cleans up descendants if the host exits unexpectedly.

## Security boundary

The local server accepts only:

- the active `127.0.0.1:<port>` Host;
- the exact configured Tauri frontend Origin;
- reviewed methods and paths in the explicit route policy;
- a valid, short-lived request proof for reads and mutations;
- no forwarded-host headers and no wildcard CORS.

Unknown routes are denied. Localhost is not treated as trusted merely because it is local.

## Route allowlist

Enabled local repository routes:

| Route              | Methods   | Execution         |
| ------------------ | --------- | ----------------- |
| `/api/health`      | GET       | local runtime     |
| `/api/preferences` | GET, POST | SQLite repository |
| `/api/history`     | GET, POST | SQLite repository |
| `/api/settings`    | GET, POST | SQLite repository |

Enabled reviewed stateless Next.js routes:

| Route                               | Methods |
| ----------------------------------- | ------- |
| `/api/maps/search`                  | GET     |
| `/api/maps/location`                | GET     |
| `/api/browser/search`               | GET     |
| `/api/browser/public-proxies`       | GET     |
| `/api/browser/public-proxies/check` | POST    |
| `/api/music/lyrics`                 | GET     |
| `/api/music/sponsorblock`           | GET     |
| `/api/tools/subdomains`             | GET     |

Classified but disabled pending the provider/OAuth repository work:

- account connect, callback, status, list, and disconnect routes;
- cloud file, folder, preview, download, trash, and bulk-operation routes;
- upload initiation and HTTP stream routes;
- allocation and sync routes.

Explicitly disabled or web-only:

- `/api/browser/proxy` remains disabled because it is an arbitrary SSRF/open-proxy surface;
- `/api/browser/wisp-endpoint` is not used by desktop React;
- `/api/trpc` remains web-only until individual procedures receive a desktop repository/security review.

The policy is deny-by-default: a new Next route is not available to desktop merely because it exists.

## Gecko and Wisp

Gecko WebAssembly remains bundled with the UI and remains Nammu Browser's engine. The Tauri WebView is only the outer host.

At launch, React obtains an opaque Wisp URL from `PlatformServices`. The URL is delivered to the local Gecko bridge in the iframe fragment, captured in memory, and immediately removed from browser history. Gecko connects to:

```text
ws://127.0.0.1:<dynamic-port>/firefox-wisp/<separate capability>
```

The upgrade handler validates exact Host, frontend Origin, path, and capability, removes the capability path before handing the socket to `wisp-js`, and never logs it. The API capability cannot authorize Wisp, and the Wisp capability cannot authorize the API. Existing private/loopback destination protections and cross-origin isolation remain in place.

## Local data layout

Under Tauri's application-local-data directory:

```text
data/
|-- nammu-os.sqlite3
|-- nammu-os.sqlite3-wal       # present while WAL has pending frames
`-- nammu-os.sqlite3-shm       # present while the database is open
vault/
`-- master-key.dpapi           # Windows-user-bound protected installation key
```

SQLite enables WAL, foreign keys, a 5-second busy timeout, trusted-schema restrictions, and transactional, checksummed migrations. It stores local metadata and settings, not raw cloud file contents. Desktop cache is explicitly memory-only and never attempts Redis. Existing browser localStorage data is not automatically migrated.

See [the credential-vault design](./desktop-credential-vault.md) and [the desktop OAuth status](./desktop-oauth-status.md).

## Uploads and offline shell

The nonexistent `/ws/uploads` dependency has been removed from the desktop cloud client. Uploads use authenticated HTTP `FormData` streams and expose only progress that can be measured honestly by the current transport.

Core Nammu fonts are bundled locally. The shell can render without Google Fonts, while Internet-dependent apps and Gecko browsing naturally still require connectivity.

## Deferred work

- Desktop provider/OAuth routes remain blocked on the decisions in the OAuth status report.
- CSP hardening remains a separate resource-graph task; no speculative policy has been added around Gecko WASM, workers, SharedArrayBuffer, Wisp, media, frames, or maps.
- The DPAPI vault is a Windows prototype pending the portability/recovery decision.
- Signing and public release policy remain part of the later Windows release phase.
