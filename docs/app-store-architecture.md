# NammuOS App Store & Package Architecture Specification

## 1. System Philosophy & Strategic Invariant

NammuOS is a lightweight, personal web workstation. As the ecosystem expands, bundling every application (Browser, Code Studio, Notes, PDF Studio, Multi-Cloud Workspace, Android Runtime) directly into the OS image creates unsustainable image sizes, slow update cycles, and monolithic coupling.

### The Golden Rule

> **NammuOS Core knows applications only through manifests, capabilities, IPC/runtime contracts, and `@nammu/sdk`. Core must never contain application-specific imports, routes, state models, permissions logic, or special-case behavior for an optional app. Apps depend on NammuOS; NammuOS does not depend on apps.**

The package system is completely runtime-agnostic. It does not dictate what browser engine, editor core, or rendering engine an application employs internally.

---

## 2. Global Architecture

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

## 3. The Package Manager: `nmu`

The package authority is named **`nmu` (Nammu Package Manager)**, avoiding collision with Node's NPM.

### Separation of Concerns

- **`nmu` Engine**: A protected core service responsible for downloading, verifying, staging, installing, upgrading, rolling back, repairing, and removing application packages.
- **Nammu Store**: A GUI frontend that invokes `nmu` actions and presents curated catalog metadata.
- **Terminal CLI (`nmu`)**: Enables command-line operations (`nmu install <id>`, `nmu update --all`, `nmu remove <id>`).
- **File Manager**: Double-clicking a `.napp` archive invokes `nmu` with the local package.

---

## 4. Execution Sandbox & Security Model

### Zero Privileged Execution

Under no circumstances should downloaded application code be dynamically imported via `import()` or `eval()` into the host NammuOS JavaScript thread. Doing so grants arbitrary third-party code access to window managers, system tokens, and internal state.

### Sandbox Architecture

1. **Isolated Context**: Applications run in sandboxed contexts (e.g., isolated Workers, secure sub-frames with `sandbox="allow-scripts"`, or remote native surfaces).
2. **Controlled IPC Bridge**: The application interacts with the system strictly via message passing.
3. **Capability Tokens**: Instead of leaking internal APIs, Core issues scoped capability tokens that expire or can be revoked.

```text
┌──────────────────────────────────────┐
│             NammuOS Core             │
│  (Privileged Host Runtime)           │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Capability Bridge (Host)       │  │
│  └───────────────▲────────────────┘  │
└──────────────────┼───────────────────┘
                   │ postMessage / IPC (JSON-RPC)
┌──────────────────┼───────────────────┐
│                  ▼                   │
│  ┌────────────────────────────────┐  │
│  │ @nammu/sdk Client Bridge       │  │
│  └───────────────┬────────────────┘  │
│                  ▼                   │
│        Application Code              │
│  (Sandboxed Execution Thread)        │
└──────────────────────────────────────┘
```

---

## 5. Nammu Virtual Filesystem (VFS) Namespaces

Because NammuOS runs across web browsers and desktop shells, storage paths represent virtual namespaces rather than raw POSIX paths. The `@nammu/sdk` abstracts whether the underlying storage is OPFS, IndexedDB, server-backed storage, or native desktop files.

| Virtual Path              | Purpose                                              | Lifecycle                                       | Mutability       |
| :------------------------ | :--------------------------------------------------- | :---------------------------------------------- | :--------------- |
| `/applications/<app-id>/` | Package payload, assets, and binaries                | Replaced during updates; deleted on uninstall   | Read-Only to App |
| `/userdata/<app-id>/`     | User configurations, projects, keybindings, profiles | Preserved during updates and default uninstalls | Read-Write       |
| `/cache/<app-id>/`        | Temporary compilation cache, session state           | Purgeable by OS during low disk space           | Read-Write       |
| `/home/`                  | User-visible personal documents and shared files     | Managed by user via File Manager                | Subject to Perms |

---

## 6. Manifest vs. Registry Metadata Separation

### Package Manifest (`nammu.app.json`)

The application package describes only its own intrinsic runtime requirements and identity. It is stored at the root of the `.napp` archive under the single canonical name: **`nammu.app.json`**.

```json
{
  "id": "os.nammu.code",
  "name": "Code Studio",
  "version": "2.3.0",
  "runtime": "web",
  "entry": "app/index.html",
  "minNammuVersion": "0.8.0",
  "dataSchemaVersion": 4,
  "permissions": [
    "filesystem.read",
    "filesystem.write",
    "clipboard.read",
    "clipboard.write",
    "notifications"
  ],
  "capabilities": [
    {
      "type": "file-handler",
      "extensions": ["ts", "tsx", "js", "jsx", "json", "md", "css"],
      "mime": "text/plain"
    }
  ],
  "optionalCapabilities": ["terminal.pty-provider", "git.credentials-helper"]
}
```

### Store Registry Catalog Entry (`store/registry/<app-id>.json`)

Store presentation details, release channels, and download statistics are decoupled from the binary package:

```json
{
  "appId": "os.nammu.code",
  "developer": "NammuOS Team",
  "verified": true,
  "category": "Developer Tools",
  "repository": "https://github.com/nammu-os/code",
  "summary": "Full-featured modern code editor with language support and extensions.",
  "description": "Code Studio provides zero-latency code editing, VFS workspace management, and integrated debugging.",
  "license": "MIT",
  "releases": {
    "stable": {
      "version": "2.3.0",
      "packageUrl": "https://releases.nammu.dev/code/code-2.3.0.napp",
      "packageHash": "sha256:4b22c8a1...",
      "downloadSize": 86048512,
      "installedSize": 184549376,
      "requiredFreeSpace": 250000000,
      "releaseDate": "2026-09-12T00:00:00Z",
      "keyId": "key-nammu-official-2026"
    },
    "beta": {
      "version": "2.4.0-beta.1",
      "packageUrl": "https://releases.nammu.dev/code/code-2.4.0-beta.1.napp",
      "packageHash": "sha256:91ef23c0...",
      "downloadSize": 87102900,
      "installedSize": 188000000,
      "requiredFreeSpace": 250000000,
      "releaseDate": "2026-09-11T18:00:00Z",
      "keyId": "key-nammu-official-2026"
    }
  },
  "screenshots": [
    "https://store.nammu.dev/code/editor-light.png",
    "https://store.nammu.dev/code/editor-dark.png"
  ]
}
```

---

## 7. Package Format & Cryptographic Trust

### Archive Structure (`.napp`)

```text
os.nammu.code-2.3.0.napp
├── nammu.app.json      # Canonical application manifest
├── app/                # Application code and assets
│   ├── index.html
│   ├── bundle.js
│   └── style.css
├── icon.png            # 256x256 application icon
└── signature.json      # Trust envelope
```

### Trust Envelope (`signature.json`)

Integrity verification extends beyond raw SHA-256 hashes to cryptographic identity:

```json
{
  "version": 1,
  "algorithm": "Ed25519",
  "keyId": "key-nammu-official-2026",
  "publisher": "NammuOS Core Team",
  "digest": "sha256:4b22c8a12e345...",
  "signature": "d38f8a7e09b3c4d5...",
  "timestamp": "2026-09-12T00:00:00Z"
}
```

### Verification Pipeline:

1. **Digest Verification**: Ensure the unpacked archive matches the digest.
2. **Key ID Lookup**: Resolve the publisher public key from the known trust store.
3. **Signature Check**: Cryptographically verify the signature against the publisher's key.
4. **Revocation Check**: Check registry trust records for revoked releases or compromised keys.

---

## 8. Transactional Installs, Updates, and Rollbacks

To prevent broken, partially written application states, `nmu` executes installs and upgrades transactionally:

```text
1. Download Package
         │
2. Verify Digest & Signature
         │
3. Stage into /applications/.staging/<app-id>-<new-version>/
         │
4. Validate nammu.app.json & System Compatibility
         │
5. Perform Data Schema Migration (if dataSchemaVersion increases)
   └─ Pre-migration snapshot: /userdata/.snapshots/<app-id>-v<old>/
         │
6. Atomic Directory Swap:
   /applications/<app-id> ← /applications/.staging/<app-id>-<new-version>/
   Previous binary backed up to /applications/.previous/<app-id>/
         │
7. Launch Health Check (Verify IPC bridge initialization)
         │
  ┌──────┴──────┐
Success       Failure
  │             │
Activate      Automatic Rollback:
App           1. Restore /applications/<app-id> from .previous
              2. Restore /userdata/<app-id> from .snapshots
              3. Log incident in system diagnostic journal
```

### Data Migrations vs. Binary Rollbacks

- **Binary Rollback**: Reverts the package executable code in `/applications/<app-id>/`.
- **Data Migration**: Triggered when `dataSchemaVersion` advances. An app provides migration scripts.
- **Data Snapshot**: Taken automatically before any migration so that if a new version fails health checks, both binary and data return cleanly to the previous state.

---

## 9. Local Application Database

Core maintains a local database of all installed applications independent of remote store availability:

```typescript
interface InstalledAppRecord {
  appId: string;
  installedVersion: string;
  installDate: number;
  sourceRegistry: 'official' | 'community' | 'developer' | 'local';
  sourceUrl?: string;
  channel: 'stable' | 'beta' | 'nightly';
  grantedPermissions: string[];
  disabled: boolean;
  lastKnownGoodVersion?: string;
  packageHash: string;
  dataSchemaVersion: number;
  downloadSize: number;
  installedSize: number;
}
```

---

## 10. Namespace Reservation & Source Tracking

To prevent namespace squatting and malicious package injection:

- **`os.nammu.*`**: Exclusively reserved for official packages signed with the official Nammu key.
- **Third-Party Namespaces**: Must follow reverse-domain notation (e.g., `com.spotify.client`, `dev.author.terminal`).
- **Source Tracking**: If an application was installed from `community-repo-a`, `nmu` will never update it from `community-repo-b` even if the IDs match, preventing silent supply-chain hijacking.

---

## 11. Runtime Classes

Not every `.napp` package is simply HTML, CSS, and JS. The `runtime` manifest field dictates sandbox initialization:

1. **`web`**: Standard sandboxed web application (e.g., Notes, Canvas).
2. **`wasm`**: Compute-heavy web application with direct WebAssembly memory allocation (e.g., Code Studio).
3. **`system-extension`**: Headless background service or provider (e.g., Download Manager daemon).
4. **`runtime`**: Subsystem execution engine (e.g., Android Runtime container).
5. **`integration`**: Native remote surface adapter on desktop builds (e.g., WhatsApp, Telegram).

---

## 12. Public Developer SDK (`@nammu/sdk`)

All official and third-party apps integrate with NammuOS through identical public contracts:

```typescript
import {
  defineApp,
  filesystem,
  notifications,
  jobs,
  permissions,
  windows,
  settings,
} from '@nammu/sdk';

export default defineApp({
  id: 'os.nammu.notes',

  async onLaunch({ window, vfs, notifications }) {
    await window.setTitle('Notes');

    // Read/write app-specific private data
    const notesIndex = await vfs.userdata.readJSON('index.json');

    // Display system notification
    await notifications.send({
      title: 'Notes Synced',
      body: 'All personal notes are up to date.',
    });
  },

  async onFileOpen({ file, window }) {
    await window.setTitle(`Editing: ${file.name}`);
  },
});
```

---

## 13. Summary of Governance Rules

1. **Package Manager Authority**: `nmu` owns package lifecycle; Store is a visual client.
2. **Zero In-Process Code**: Downloaded applications never execute inside Core JavaScript threads.
3. **Manifest Standard**: The manifest is always named `nammu.app.json`.
4. **Data Preservation**: Uninstalling an app defaults to preserving user data unless explicit deletion is confirmed.
5. **Decoupled Repositories**: Every major application resides in its own GitHub repository under `nammu-os` with dedicated CI/CD and release pipelines.

---

## 14. Phase 1 Security Hardening Status

Status: **COMPLETE / LOCKED** as of 2026-09-12. The package/runtime foundation is implemented and its clean regression gate passes 329/329 tests. The generated Store interface remains provisional and is not approved as the final product UI; the next package-system proof is an independently packaged Notes application.

### Trust and signing

- Production code contains verification logic and public-key material only. Package signing exists exclusively in test tooling.
- The previously embedded development signing key is retired and must be treated as compromised.
- The rotated official public verification key is configured under key ID `nammu-official-2026-09` and is authorized only for `os.nammu.*`.
- Its matching private key was generated outside the repository under the local release-signing directory. Move that private material into the protected CI/offline signing boundary before public distribution; never commit or bundle it.
- Manifest publisher identity, signature-envelope publisher identity, trusted key ownership, namespace authority, and update signer continuity must all agree.

### Runtime boundary

- Sandboxed applications communicate only through a one-time, nonce-bound `MessageChannel`.
- Calls made before channel bootstrap are queued and flushed once; they are never executed through a `window.postMessage` RPC fallback.
- Package entry scripts are materialized from immutable VFS package contents into the sandbox document. Remote, absolute, and traversal script references are rejected.
- Runtime permission requests must name a known permission declared by the installed manifest.
- Applications may subscribe to their own events. System and cross-application subscriptions require the explicit `events.system.subscribe` and `events.cross-app.subscribe` permissions.

### Durability and recovery

- IndexedDB hydration completes before database/VFS operations are served, and transaction failures propagate to callers.
- Installed versions are immutable. Normal updates must be newer; repair is the explicit same-version path and downgrade is an explicit operation.
- Each installed version retains complete immutable metadata.
- Activation journals and userdata snapshots persist before activation, enabling automatic timeout rollback and startup recovery after a crash.

### Verification commands

```text
bun test tests/nmuLifecycle.test.ts tests/nmuAdversarial.test.ts tests/nmuPersistence.test.ts
bun run nmu:sandbox:accept
bun run typecheck
bun run lint
bun run build
bun run desktop:web:build
```

The browser acceptance mounts real `AppSandboxHost` instances and executes an installed package's actual `main.js` through the production MessageChannel bridge. It verifies instance isolation, VFS userdata, settings, notifications, and the activation acknowledgement.
