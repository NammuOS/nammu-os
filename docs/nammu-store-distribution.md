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

The release asset must be published at the URL in `storeRegistry.ts` before the production Install
button can download it. A missing upstream release fails visibly and does not fall back to an
untrusted mirror or a package embedded in Core.

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

## Distribution operation still required

Publishing the independent `nammu-notes` repository and attaching the signed package to its
`v1.0.0` release is an external release operation. It is deliberately not performed implicitly by
the application build or by tests. The official signing private key must remain outside both
repositories.
