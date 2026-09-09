<div align="center">
  <img src="./public/branding/nammu-logo.webp" width="78" alt="Nammu OS mark" />

# Nammu OS

**A browser-native operating system for focused work, creative tools, cloud files, and the open web.**

Nammu OS turns a web page into a coherent personal workstation: movable application windows, a real taskbar and launcher, a WebAssembly browser engine, multi-cloud storage, media tools, productivity apps, themes, wallpapers, lock-screen controls, and a persistent audio workspace.

[![CI](https://github.com/nammu-os/nammu-os/actions/workflows/ci.yml/badge.svg)](https://github.com/nammu-os/nammu-os/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16.3-000000?logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2-149ECA?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3-FBF0DF?logo=bun&logoColor=14151A)](https://bun.sh/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://v2.tauri.app/)

  <br />
  <img src="./docs/screenshots/desktop.jpg" alt="Nammu OS desktop with its workspace, taskbar, rail, and music player" width="100%" />
</div>

---

## A workstation, not another dashboard

Nammu OS is built around one idea: tools should feel like parts of the same environment. Apps share the windowing model, visual language, theme system, master audio, global icon settings, taskbar, start menu, context menus, standalone routes, and saved preferences. The result behaves like a small operating system while remaining deployable as a modern web application.

| Desktop experience                                                                                                             | Open web                                                                                                                                                                   | Files everywhere                                                                                                                   | Native toolbox                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Multi-window workspace, snapping, persisted geometry, taskbar, launcher, lock screen, themes, wallpapers, and global controls. | A Nammu-styled multi-tab browser powered by a Gecko WebAssembly runtime, with history, downloads, bookmarks, passwords, private tabs, pinning, and split-window workflows. | Files and an aggregated cloud workspace for Google Drive, OneDrive, Dropbox, MEGA, pCloud, Yandex Disk, and S3-compatible storage. | **127 registered tools** across image, video, audio, PDF and documents, developer utilities, and everyday conversions. |

## Built to feel like one product

- **Desktop shell** — draggable and resizable windows, predictable default geometry, minimize/maximize, snapping, focus management, standalone app routes, a reorderable start menu, draggable taskbar and rail icons, and middle-click close.
- **Runtime-aware web apps** — Browser, WhatsApp, Telegram, and YouTube Music use Gecko/WASM with Wisp on the Web and isolated native WebView2 surfaces on Windows Desktop.
- **Unified appearance** — Cyber Glow, Obsidian Dark, Midnight Navy, and macOS themes, with system-wide light/dark appearance, accent colors, CRT scanlines, icon controls, and motion preferences.
- **Living wallpapers** — configurable Synth Rain and Chaos Flow Matrix effects with color, speed, and size controls.
- **Audio workspace** — persistent music player, queue, playback modes, playback speed, transparency controls, visualization, and local volume combined with the OS master volume.
- **Local-first personalization** — notes, calendar entries, browser state, ordering, settings, lock profile, wallpaper controls, and other preferences survive reloads without turning the interface into a collection of disconnected pages.
- **Accessible application routes** — system apps and tools can also open directly at `/apps/:id` and `/tools/:id`, with deterministic server rendering and safe browser-state hydration.

## Selected interfaces

### Projects is a portfolio, not a task tracker

The Projects app presents shipped work as an equal-weight developer portfolio grid. It includes live previews, search, product-category filters, technology tags, open-in-new-tab and copy-link actions, and an extensible data collection for future projects.

<img src="./docs/screenshots/projects.jpg" alt="Nammu OS Projects portfolio showing an equal-weight project gallery" width="100%" />

The initial collection includes:

- [NavTube — YouTube Clone](https://navtube.vercel.app/)
- [HooBank — Modern Banking Website](https://hoobankk.vercel.app/)
- [macOS Clone — Browser Desktop Experience](https://nammu-os.vercel.app/)
- [Timeless Pages — Online Bookstore](https://timeless-pages.vercel.app/)

Future entries live in [`src/lib/portfolioProjects.ts`](./src/lib/portfolioProjects.ts), so adding work automatically updates the gallery, search, counts, and category filters.

### A complete browser inside the workspace

<img src="./docs/screenshots/browser.jpg" alt="Nammu Browser with tabs, navigation, bookmarks, controls, and speed dial" width="100%" />

Nammu Browser wraps the Firefox/Gecko WebAssembly runtime in the same interface and tab system as the rest of Nammu OS. Engine lifecycle is application-scoped, pinned tabs collapse properly, navigation history is reconciled without duplicate entries, and the full browser can be opened in its own tab at `/browser`.

### One view across multiple cloud providers

<img src="./docs/screenshots/cloud.jpg" alt="Nammu Cloud aggregated storage matrix and provider controls" width="100%" />

Cloud combines provider accounts, capacity, allocation policy, upload routing, sync, file operations, previews, trash, recents, sharing, and account health into one workspace. Provider adapters and route handlers keep UI concerns separate from storage logic.

### Maps and system personalization

<table>
  <tr>
    <td width="50%"><img src="./docs/screenshots/maps.jpg" alt="Nammu Maps with Street Atlas style and location controls" /></td>
    <td width="50%"><img src="./docs/screenshots/settings.jpg" alt="Nammu OS Settings appearance and theme controls" /></td>
  </tr>
  <tr>
    <td><strong>Maps</strong><br /><sub>Street Atlas mapping, search, location, coordinates, zoom controls, and carefully themed map chrome.</sub></td>
    <td><strong>Settings</strong><br /><sub>Appearance, wallpaper, icons, audio, taskbar, start menu, lock screen, storage, credits, and system information.</sub></td>
  </tr>
</table>

## Application gallery

Every primary application uses the same standalone shell and can be opened independently without losing Nammu OS styling or browser-backed state.

<details open>
  <summary><strong>Core workspace</strong></summary>
  <br />
  <table>
    <tr>
      <td width="50%"><img src="./docs/screenshots/files.jpg" alt="Files app" /><br /><strong>Files</strong><br /><sub>Folders, uploads, previews, metadata, downloads, and trash.</sub></td>
      <td width="50%"><img src="./docs/screenshots/cloud.jpg" alt="Cloud app" /><br /><strong>Cloud</strong><br /><sub>Multi-provider storage, policies, connections, and sync.</sub></td>
    </tr>
    <tr>
      <td><img src="./docs/screenshots/browser.jpg" alt="Browser app" /><br /><strong>Browser</strong><br /><sub>Gecko WebAssembly browsing with a native Nammu tab model.</sub></td>
      <td><img src="./docs/screenshots/whatsapp.jpg" alt="WhatsApp app" /><br /><strong>WhatsApp</strong><br /><sub>A focused QR-based WhatsApp Web session without browser chrome.</sub></td>
    </tr>
  </table>
</details>

<details>
  <summary><strong>Productivity and communication</strong></summary>
  <br />
  <table>
    <tr>
      <td width="50%"><img src="./docs/screenshots/notes.jpg" alt="Notes app" /><br /><strong>Notes</strong><br /><sub>Persistent notes with search, organization, and a focused editor.</sub></td>
      <td width="50%"><img src="./docs/screenshots/calendar.jpg" alt="Calendar app" /><br /><strong>Calendar</strong><br /><sub>Month navigation, current-date context, events, and scheduling.</sub></td>
    </tr>
    <tr>
      <td><img src="./docs/screenshots/mail.jpg" alt="Mail app" /><br /><strong>Mail</strong><br /><sub>A compact relay-style inbox and message reader.</sub></td>
      <td><img src="./docs/screenshots/projects.jpg" alt="Projects portfolio app" /><br /><strong>Projects</strong><br /><sub>A visual developer portfolio for shipped websites and applications.</sub></td>
    </tr>
  </table>
</details>

<details>
  <summary><strong>Creation and development</strong></summary>
  <br />
  <table>
    <tr>
      <td width="50%"><img src="./docs/screenshots/editor.jpg" alt="Editor app" /><br /><strong>Editor</strong><br /><sub>A lightweight code and text workspace.</sub></td>
      <td width="50%"><img src="./docs/screenshots/shell.jpg" alt="Shell app" /><br /><strong>Shell</strong><br /><sub>A command-oriented workspace with OS-aware shortcuts.</sub></td>
    </tr>
    <tr>
      <td><img src="./docs/screenshots/calculator.jpg" alt="Calculator app" /><br /><strong>Calculator</strong><br /><sub>Standard, scientific, programmer, conversion, finance, and statistics modes.</sub></td>
      <td><img src="./docs/screenshots/qr-studio.jpg" alt="QR Studio app" /><br /><strong>QR Studio</strong><br /><sub>Create styled QR codes, export assets, and scan compatible input.</sub></td>
    </tr>
  </table>
</details>

<details>
  <summary><strong>Intelligence, navigation, and control</strong></summary>
  <br />
  <table>
    <tr>
      <td width="50%"><img src="./docs/screenshots/nammu-ai.jpg" alt="Nammu AI app" /><br /><strong>Nammu AI</strong><br /><sub>An assistant surface grounded in the local workspace.</sub></td>
      <td width="50%"><img src="./docs/screenshots/maps.jpg" alt="Maps app" /><br /><strong>Maps</strong><br /><sub>Place search, geolocation, coordinates, styles, and navigation controls.</sub></td>
    </tr>
    <tr>
      <td colspan="2"><img src="./docs/screenshots/settings.jpg" alt="Settings app" /><br /><strong>Settings</strong><br /><sub>A single control center for the full operating-system experience.</sub></td>
    </tr>
  </table>
</details>

## 127 native tools

The tool registry spans six focused families: **Image**, **Video**, **Audio**, **PDF & Documents**, **Developer**, and **Utilities**. Tools are searchable from the launcher, discoverable by compatible file type, and available as standalone `/tools/:id` routes.

<img src="./docs/screenshots/subdomain-inspector.jpg" alt="Subdomain Inspector developer tool" width="100%" />

Examples include image conversion and compression, video and audio processing, PDF merge/split/watermark/password workflows, JSON and CSV utilities, regular expressions, hashing, JWT inspection, network calculators, UUID generation, color tools, text transforms, and the passive certificate-transparency **Subdomain Inspector**.

## Architecture

```mermaid
flowchart TB
  User[User] --> Web[Web runtime: Next.js]
  User --> Desktop[Desktop runtime: Tauri 2]
  Web --> Shell[Shared Nammu React application]
  Desktop --> Bundle[Bundled Vite entry]
  Bundle --> Shell
  Shell --> Windows[Window manager + taskbar + launcher]
  Shell --> Apps[15 system apps]
  Shell --> Tools[127 native tools]
  Web --> WebServer[Custom Node/Next server]
  WebServer --> Postgres[PostgreSQL]
  WebServer --> Redis[Optional Redis / Upstash]
  Desktop --> LocalServer[Supervised packaged Node/Next server]
  LocalServer --> SQLite[SQLite + encrypted credential envelopes]
  LocalServer --> Memory[Memory-only TTL cache]
  Apps --> Gecko[Gecko WebAssembly runtime]
  Gecko --> Wisp[Runtime-specific Wisp transport]
  Wisp --> WebServer
  Wisp --> LocalServer
  WebServer --> Providers[User cloud providers]
  LocalServer -. provider routes pending OAuth review .-> Providers
```

| Layer               | Technology                                                                    |
| ------------------- | ----------------------------------------------------------------------------- |
| Application         | Next.js 16.3 App Router, React 19.2, TypeScript 5.9                           |
| Interface           | Tailwind CSS 4, Framer Motion, Lucide icons, custom OS design tokens          |
| Runtime             | Bun 1.3 workflow, custom Node/Next server, WebSockets                         |
| APIs                | Next.js route handlers, tRPC 11, TanStack Query, Zod                          |
| Data                | PostgreSQL + optional Redis on Web; SQLite WAL + memory cache on Desktop      |
| Web browser engine  | Firefox/Gecko compiled to WebAssembly with Wisp transport                     |
| Desktop remote apps | Isolated WebView2 surfaces for Browser, WhatsApp, Telegram, and YouTube Music |
| Desktop host        | Tauri 2, WebView2, bundled Node runtime, and the shared React application     |
| Infrastructure      | Docker for the web stack; Tauri/NSIS for the Windows desktop edition          |

The browser deployment remains a normal Next.js application. The Windows edition bundles the same React application inside one Tauri WebView2 window and supervises a loopback-only Node/Next service on an OS-selected port. Tauri does not replace Nammu's React window manager: Files, Browser, Cloud, Tools, Settings, Music, and other internal windows remain React-managed inside that single native window. Remote websites use Gecko/WASM with Wisp in the Web edition and managed WebView2 child surfaces in the Desktop edition.

Environment-dependent operations cross a small `PlatformCapabilities` boundary. The web provider uses browser APIs and returns explicit unsupported results when browsers cannot perform an operation. The desktop provider uses official Tauri APIs for user-selected files, external URLs, clipboard text, notifications, and the containing native window. File paths remain inside the provider and are never returned to React.

## Run it locally

### Requirements

- [Bun](https://bun.sh/) 1.3 or newer
- [Node.js](https://nodejs.org/) 22 or newer
- A Chromium-compatible browser; Microsoft Edge is used by the screenshot automation on Windows
- Optional PostgreSQL and Redis services for the full backend stack
- Windows desktop development additionally requires the Rust stable MSVC toolchain, Microsoft C++ Build Tools, and WebView2

### Web development

```bash
git clone https://github.com/nammu-os/nammu-os.git
cd nammu-os
bun install

# Configure database and optional provider credentials
cp .env.example .env

bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Windows desktop development

The desktop runtime uses a separate Vite entry only as a bundler. It imports the existing `DesktopApp` and shared registries, components, and state rather than maintaining a second UI implementation. In development, Rust supervises the repository's custom Node/Next server on numeric `127.0.0.1` with an ephemeral port and a local SQLite database.

```bash
bun run desktop:dev
```

### Windows desktop build

```bash
bun run desktop:check
bun run desktop:rust:check
bun run desktop:build
bun run desktop:release:verify
```

`desktop:build` first creates the normal Next.js production build, stages a known Node/Next/SQLite/Wisp runtime, runs its lifecycle smoke test, builds the local React bundle, produces both release artifacts, and verifies the packaged dependency allowlist and secret boundary:

- `src-tauri/target/release/nammu-os.exe`
- `src-tauri/target/release/bundle/nsis/Nammu OS_<version>_x64-setup.exe`

The NSIS installer is explicitly current-user scoped and does not require administrator access. Upgrades preserve the stable `com.nammu.os` application identity. Uninstall removes the installed application but intentionally retains `%LOCALAPPDATA%\com.nammu.os`, including user settings, SQLite data, and the DPAPI-protected credential vault; data removal must remain a separate explicit user action.

**Release distribution limitation — unsigned Windows binary:** no signing certificate or Trusted Signing account is configured, so the EXE and installer are currently unsigned. The release configuration can accept signing later without changing the application architecture. An auto-updater is intentionally absent until a signed, authenticated release channel exists; Nammu does not introduce a hosted backend merely to support updates.

### Desktop platform and service boundaries

Runtime detection is centralized in `src/platform/runtime.ts`. It is safe during SSR and checks for a functional Tauri IPC bridge rather than using browser user-agent detection. Tauri imports are lazy, so the web and server builds do not evaluate native APIs.

Native permissions are deliberately narrow:

- Native open/save dialogs plus read or write access only to the path selected by that dialog
- HTTP, HTTPS, `mailto`, and `tel` URLs through the system application
- Clipboard text read/write only
- Permission checks, permission requests, and basic notifications only
- Minimize, toggle-maximize, and close for the single containing Tauri window

There is no shell/process access, directory-wide filesystem scope, arbitrary HTTP plugin access, global Tauri object, updater, tray, global shortcut, general-purpose secure-storage plugin, or remote-origin capability grant. Provider credentials use the Rust-owned Windows DPAPI/AES-GCM vault and are never exposed as an arbitrary React storage API.

Desktop has no production Nammu backend URL. Tauri starts a packaged local Node service, React discovers it through `PlatformServices`, and Rust authorizes each exact API method/path with a short-lived proof. Host and Origin checks, a deny-by-default route policy, separate API/Wisp capabilities, SQLite repositories, a memory-only cache, graceful shutdown, and Windows Job Object cleanup protect the local boundary. The arbitrary browser proxy and unreviewed cloud/tRPC routes remain disabled.

See [the Phase 1C-LOCAL checkpoint report](./docs/phase-1c-local-report.md), [desktop-local architecture](./docs/desktop-service-origins.md), [credential-vault design](./docs/desktop-credential-vault.md), and [OAuth/provider status](./docs/desktop-oauth-status.md).

### Full Docker stack

```bash
docker compose up -d --build
```

This starts Nammu OS with PostgreSQL 16 and Redis 7 using the included health checks and persistent volumes.

## Quality workflow

```bash
bun test             # Unit and regression suite
bun run typecheck    # Strict TypeScript validation
bun run lint         # ESLint
bun run format:check # Prettier verification
bun run build        # Optimized Next.js production build
```

The test suite covers window geometry, standalone routes, hydration safety, browser history reconciliation, app ordering, context-menu placement, storage allocation, cryptography, MIME handling, master audio, music settings, lock credentials, icons, tools, and the project portfolio collection.

### Refresh the documentation gallery

With the development server running:

```bash
bun run docs:screenshots
```

The capture script opens each Nammu OS route in a clean headless browser profile and regenerates the images in `docs/screenshots`. That keeps this README tied to the product that actually ships.

## Repository map

```text
src/
|-- app/                    Next.js pages, standalone routes, APIs, and actions
|-- components/
|   |-- desktop/            Desktop shell and standalone application boundary
|   |-- os/                 System apps, windows, taskbar, launcher, settings, music
|   |-- browser/            Nammu Browser UI and Gecko session orchestration
|   |-- cloud/              Multi-cloud workspace, provider views, uploads, previews
|   |-- maps/               Map interface and map-specific styling
|   |-- whatsapp/           Focused WhatsApp runtime and session store
|   |-- telegram/           Multi-account Telegram runtime and session store
|   `-- web-surfaces/       Shared Desktop native remote-surface adapter
|-- lib/                    Registries, preferences, ordering, geometry, runtime helpers
|-- platform/               Shared capability contracts and web/Tauri implementations
|-- server/                 tRPC routers, cloud adapters, allocation, crypto, MIME services
`-- tools/                  Image, video, audio, PDF, developer, and utility tools

docs/screenshots/           Reproducible product gallery used by this README
desktop/                    Local Vite entry for the shared Tauri desktop application
drizzle/                    Database migrations and snapshots
k8s/                        Deployment, service, ingress, autoscaling, and configuration
scripts/                    Runtime patching and documentation automation
src-tauri/                  Thin Rust host, minimum capability permissions, and native metadata
tests/                      Unit and regression coverage
vite.desktop.config.ts      Desktop-only client bundler configuration
```

## Credits

Nammu OS stands on excellent open-source work. The in-product Credits page contains the complete, maintained attribution list. Core acknowledgements include:

- [HeyPuter/firefox-wasm](https://github.com/HeyPuter/firefox-wasm) — Firefox/Gecko WebAssembly foundation
- [dimartarmizi/OmniCloud](https://github.com/dimartarmizi/OmniCloud) — multi-cloud product inspiration
- [Saganaki22/SynthRain](https://github.com/Saganaki22/SynthRain) — Synth Rain wallpaper inspiration
- [Yufok1/Matrix-Rain-HTML-Background](https://github.com/Yufok1/Matrix-Rain-HTML-Background) — Chaos Flow wallpaper inspiration
- [Leaflet](https://leafletjs.com/), [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), and [CARTO](https://carto.com/attributions) — map rendering and data
- [Lucide](https://lucide.dev/) — interface icon system

Third-party projects remain subject to their own licenses and attribution requirements.

---

<div align="center">
  <strong>Nammu OS is an evolving personal workstation built in public.</strong><br />
  <sub>Designed as one system. Shipped as the web.</sub>
</div>
