# Nammu Store distribution milestone

## Boundary

```text
Nammu Store UI
  -> NammuStoreService
  -> authenticated same-origin package route
  -> pinned registry app/version URL
  -> SHA-256 verification (server and client)
  -> downloaded manifest inspection
  -> permission review
  -> nmu
  -> signature / publisher / namespace verification
  -> immutable VFS install
  -> AppSandboxHost
```

The Store does not implement package installation, trust, rollback, repair, or deletion itself.
Those operations remain owned by `NMUEngine`. The Store is an orchestration and presentation layer.

## First registry entry

The bootstrap official registry contains only `os.nammu.notes` version `1.0.0`. Its release points
to the independent Notes repository release, declares the expected byte size and SHA-256, and
contains public product metadata. Notes source and package bytes are not bundled into NammuOS Core.
Its Store screenshot is generated from the real signed package running inside `AppSandboxHost`, not
from a mock application surface.

The release asset is published at the immutable URL in `storeRegistry.ts`:

```text
https://github.com/NammuOS/nammu-notes/releases/download/v1.0.0/os.nammu.notes-1.0.0-signed.napp
```

An independent public download and the same download through Nammu's allowlisted Store delivery
route both produce 21,214 bytes and the pinned digest below. A missing or changed upstream release
fails visibly and does not fall back to an untrusted mirror or a package embedded in Core.

The immutable `v1.0.0` release is pinned to SHA-256
`e535510bbde478a0d76d6656c2d0f48d7f743fc8bc513e51870d8e3043674927`. The artifact validator
proves that exact archive against the production publisher trust path and the tagged Notes source
before publication.

## Install review

The permission dialog is populated from the manifest inside the downloaded `.napp`, after its
catalog hash and app/version identity are verified. Catalog text is never trusted as the install
permission source. After confirmation, nmu repeats manifest validation and enforces the official
Ed25519 signature, publisher identity, namespace authorization, and permission rules.

## Lifecycle

- **Install** downloads, reviews, and calls `nmu.install`.
- **Open** dispatches the generic installed-application launch event.
- **Update** uses the normal nmu activation health check and opens the candidate app so its
  `app.ready` acknowledgement can commit activation.
- **Repair** requires the exact current app/version package and signer continuity.
- **Rollback** activates only an immutable retained previous version.
- **Uninstall** removes application code and cache while retaining private user data by default.

The provisional Store code copied during earlier UI exploration is not a package authority. Active
Store surfaces no longer contact the Umbrel registry. The licensed `umbrel/` and
`AppStore Reference/` folders were used only for interaction and visual reference.

## Remote-distribution acceptance

The focused acceptance command is:

```text
bun run store:remote:accept
```

It starts with an isolated browser profile and no installed Notes record, uses the real Store UI
and package delivery route, checks that permission review came from the downloaded manifest, and
proves install, sandbox launch, edit/persistence, close/reopen, repair, data-retaining uninstall,
remote reinstall, and data recovery. It never reads a local `.napp` and does not modify a user's
normal NammuOS profile.

The official signing private key remains outside both repositories. Publishing and remote
acceptance never require it because they consume the already signed immutable release artifact.
