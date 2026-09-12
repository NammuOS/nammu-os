# NammuOS Roadmap & Architecture: Modular Package System (`nmu`)

## Strategic Architecture: The Decoupled NammuOS Platform

### Executive Summary

NammuOS Core is a small, secure, unbloated desktop operating system shell and runtime. Large applications (Browser, Code Studio, Notes, PDF Studio, Canvas, Cloud Workspace, Android Runtime, etc.) are decoupled into standalone, versioned `.napp` packages managed by **`nmu` (Nammu Package Manager)** and distributed through the **Nammu Store** and community registries.

### The Golden Invariant (Strengthened)

> [!IMPORTANT]
> **NammuOS Core knows applications only through manifests, capabilities, IPC/runtime contracts, and `@nammu/sdk`. Core must never contain application-specific imports, routes, state models, permissions logic, or special-case behavior for an optional app. Apps depend on NammuOS; NammuOS does not depend on apps.**

---

## 1. System Architecture

```text
                         Nammu Registries
                               │
                         release metadata
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              NammuOS Core                              │
│                                                                        │
│    Desktop Shell / Window Manager / Profiles / Nammu VFS / Recovery    │
│                                                                        │
│    ┌──────────────────────────────────────────────────────────────┐    │
│    │                  nmu (Nammu Package Manager)                 │    │
│    │                                                              │    │
│    │   resolve • verify • stage • install • update • migrate      │    │
│    │   repair  • rollback • uninstall • data-snapshot • prune     │    │
│    └──────────────────────────────┬───────────────────────────────┘    │
│                                   │                                    │
│                         Application Database                           │
│                                   │                                    │
│    ┌──────────────────────────────┴───────────────────────────────┐    │
│    │                     App Runtime / Sandbox                    │    │
│    │                                                              │    │
│    │            Controlled IPC Bridge & @nammu/sdk Host           │    │
│    └──────────────────────────────┬───────────────────────────────┘    │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
   Nammu Browser                Code Studio                   Notes
(os.nammu.browser)           (os.nammu.code)             (os.nammu.notes)
   separate repo               separate repo               separate repo

/applications/<app-id>      → Immutable installed package storage
/userdata/<app-id>          → Persistent user data & preferences (preserved across installs)
/cache/<app-id>             → Disposable session and build cache (purgeable)
```

---

## 2. Core Architectural Principles

### 1. Package Manager (`nmu`) as the Single Authority
- `nmu` is the protected core package authority.
- The **Nammu Store** is merely one graphical interface to `nmu`.
- Other interfaces include the **Terminal CLI (`nmu install <id>`)**, **File Manager** (double-clicking a `.napp` file), and system background tasks.

### 2. Sandbox Execution Boundary
- **Never evaluate or dynamically import downloaded application code into the privileged Core JavaScript context.**
- Applications execute inside an isolated execution sandbox (e.g., worker/iframe/remote surface) communicating with Core strictly via a message-based IPC bridge exposed through `@nammu/sdk`.
- Core never hands out internal runtime references. Apps receive only capability tokens.

### 3. Nammu VFS Namespaces
NammuOS operates on a virtualized filesystem (VFS) abstraction:
- `/applications/<app-id>/`: Immutable package payload. Managed exclusively by `nmu`.
- `/userdata/<app-id>/`: Isolated persistent user data, settings, extensions, and workspaces.
- `/cache/<app-id>/`: Ephemeral session caches, temporary files, scratch space.
- `/home/`: User-visible shared files and folders.
The `@nammu/sdk` hides whether the backing storage is Origin Private File System (OPFS), IndexedDB, local desktop filesystem, or server storage.

### 4. Separation of Application Manifest vs. Store Registry Metadata
- **Package Manifest (`nammu.app.json`)**: Packed inside `.napp`. Describes *only* what the application is, its entry point, runtime class, data schema version, declared permissions, and capability contracts.
- **Store Registry Metadata**: Managed by registries. Tracks screenshots, ratings, reviews, developer verification, categories, source repository links, release channels, download sizes, installed sizes, and minimum free space requirements.

### 5. Capabilities Over Hard Dependencies
- Optional applications must not hard-depend on other optional applications.
- Applications declare `optionalCapabilities` (e.g., `"downloads.external-manager"`).
- If an external download manager is present, Browser delegates; if absent, it falls back gracefully to built-in basic downloading.

### 6. Reserved Namespaces & Source Tracking
- `os.nammu.*` is strictly reserved for verified official NammuOS packages.
- Third-party packages use reverse-domain names (`dev.author.app`, `io.company.tool`).
- Local installations track their package origin (`official`, `community`, `developer`, `local-file`) and never silently update from an alternate source.

### 7. Transactional Installs, Updates & Rollbacks
- Installs and updates follow a strict atomic pipeline:
  `Download → Digest Check → Signature & Trust Verify → Stage to Temp → Validate Manifest & Runtime → Atomic Swap → Health Check → Activate`.
- Previous versions are kept temporarily. If launch health checks fail, `nmu` triggers an automatic rollback.
- Data schema versioning (`dataSchemaVersion`) triggers controlled migration scripts, with automatic user-data snapshots created before migration.

---

## 3. Package & Manifest Specifications

### The `.napp` Package Structure
Every `.napp` package is a signed archive containing:

```text
<app-id>-<version>.napp
├── nammu.app.json      # The single canonical application manifest
├── app/                # Application binary payload
│   ├── index.html
│   └── ...
├── assets/             # Bundled local assets
├── icon.png            # Application icon
└── signature.json      # Cryptographic signatures, key ID, digest algorithm
```

### Application Manifest (`nammu.app.json`)
```json
{
  "id": "os.nammu.browser",
  "name": "Browser",
  "version": "1.4.2",
  "runtime": "web",
  "entry": "app/index.html",
  "minNammuVersion": "0.8.0",
  "dataSchemaVersion": 2,
  "permissions": [
    "network",
    "clipboard.read",
    "clipboard.write",
    "notifications"
  ],
  "capabilities": [
    {
      "type": "protocol",
      "scheme": "http"
    },
    {
      "type": "protocol",
      "scheme": "https"
    },
    {
      "type": "file-handler",
      "extensions": ["html", "htm"],
      "mime": "text/html"
    }
  ],
  "optionalCapabilities": [
    "downloads.external-manager"
  ]
}
```

### Store Registry Schema (e.g., `registry/browser.json`)
```json
{
  "appId": "os.nammu.browser",
  "name": "Nammu Browser",
  "developer": "NammuOS Team",
  "verified": true,
  "category": "Internet",
  "repository": "https://github.com/nammu-os/browser",
  "summary": "Fast, private, and modern web browser designed for NammuOS.",
  "license": "MIT",
  "releases": {
    "stable": {
      "version": "1.4.2",
      "packageUrl": "https://releases.nammu.dev/browser/browser-1.4.2.napp",
      "packageHash": "sha256:7f83b165...",
      "downloadSize": 45219840,
      "installedSize": 98304000,
      "requiredFreeSpace": 157286400,
      "minNammuVersion": "0.8.0",
      "releaseDate": "2026-09-12T00:00:00Z",
      "keyId": "key-nammu-official-2026"
    }
  },
  "screenshots": [
    "https://store.nammu.dev/assets/browser/screen1.png"
  ]
}
```

---

## 4. Official NammuOS TODO Checklist

### Phase 1: Specifications, Sandboxing & Package Manager Core (`nmu`)
- [ ] **Define canonical `nammu.app.json` manifest specification** (single standard name).
- [ ] **Define `.napp` application package format & directory structure**.
- [ ] **Architect Nammu VFS namespaces** (`/applications/`, `/userdata/`, `/cache/`, `/home/`).
- [ ] **Build App Sandbox & IPC Bridge**: Enforce that downloaded application code never executes inside Core JavaScript authority.
- [ ] **Build `nmu` core engine**: Atomic staging, validation, installation, uninstallation, repair, and rollback.
- [ ] **Implement Local Installed-App Database**: Track `appId`, `installedVersion`, `channel`, `sourceRegistry`, `grantedPermissions`, `packageHash`, `dataSchemaVersion`.
- [ ] **Package Signing & Trust Model**: Support key IDs, developer signature verification, checksum validation, and revocation checks.
- [ ] **Data Schema Versioning & Migrations**: Implement `dataSchemaVersion` lifecycle and pre-migration data snapshots.
- [ ] **Enforce Core Decoupling Invariant**: Audit and prevent Core from importing optional application code directly.

### Phase 2: Public SDK (`@nammu/sdk`) & Independent Repositories
- [ ] **Create `@nammu/sdk` package**: Expose capability-based APIs for Windows, VFS, Notifications, Settings, Jobs, and Permissions.
- [ ] **Separate official applications from NammuOS Core**:
  - `github.com/nammu-os/core`
  - `github.com/nammu-os/store`
  - `github.com/nammu-os/sdk`
  - `github.com/nammu-os/browser`
  - `github.com/nammu-os/code`
  - `github.com/nammu-os/notes`
  - `github.com/nammu-os/pdf`
  - `github.com/nammu-os/canvas`
  - `github.com/nammu-os/downloads`
  - `github.com/nammu-os/cloud`
  - `github.com/nammu-os/prompt-manager`
- [ ] **Define Package & Runtime Classes**: Support `web`, `wasm`, `system-extension`, `runtime`, and `integration`.
- [ ] **Migrate Browser to `@nammu/sdk`**: Ensure browser engine choice is private to the browser repo.

### Phase 3: Registry, Store Interface & User Experience
- [ ] **Create official Store registry repository (`github.com/nammu-os/store`)**.
- [ ] **Build Nammu Store GUI**: Graphical interface consuming `nmu` and registry metadata.
- [ ] **Display package size metrics**: Download size, installed size, and minimum free space required.
- [ ] **Official & Verified application badges** with namespace reservation (`os.nammu.*`).
- [ ] **Expose Source Repository Links (`View Source ↗`)** on Store listings.
- [ ] **Granular Uninstallation UI**: Prompt user with options to retain or delete user data, settings, and cache.
- [ ] **Application State Machine**: UI reflecting `Installed`, `Not Installed`, `Disabled`, `Update Available`, `Incompatible`, `Corrupted`, `Installing`, `Updating`, `Repairing`.
- [ ] **App Repair & Reset actions**: Repair corrupt binaries without touching user data; reset settings back to default.
- [ ] **Onboarding Installation Presets**: Minimal, Developer, Student, Creator, Full, and Custom.

### Phase 4: Updates, Capabilities & Ecosystem Expansion
- [ ] **Per-app updates & "Update All" queue** in Nammu Store.
- [ ] **Distribution Channels**: Support `stable`, `beta`, and `nightly` channels per package.
- [ ] **Optional Capability Negotiation**: Allow apps to query and delegate tasks (e.g., external download managers) without hard dependencies.
- [ ] **File Associations & Custom Protocol Handlers**: Dynamic routing through Core without hardcoded app logic.
- [ ] **CLI interface for `nmu`**: Terminal commands (`nmu install`, `nmu update`, `nmu list`, `nmu remove`).
- [ ] **Package Source Tracking**: Prevent cross-registry silent overwrites.
- [ ] **Third-party repository support & developer packaging CLI**.
