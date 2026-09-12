# Notes package migration

Nammu Notes is no longer implemented inside NammuOS Core. Its source lives in the sibling
`nammu-notes` repository and builds as the official `os.nammu.notes` application package.

## Runtime boundary

```text
NammuOS launcher / Notes compatibility entry
  -> AppSandboxHost
  -> signed os.nammu.notes .napp
  -> private MessageChannel RPC
  -> @nammu/sdk capability contract
  -> /userdata/os.nammu.notes/notes.json
```

The package receives no Core imports, DOM access to the host, arbitrary filesystem access, or
direct native APIs. Clipboard export and user-selected Markdown save pass through explicit broker
permissions. App data remains in the package-scoped VFS and is retained by the default uninstall
policy.

## Existing user data

The signed official package declares the exact legacy key `nammu-notes`. On its first launch only,
the migration capability lets it read that key. Notes validates and writes the data to its scoped
`notes.json` before asking Core to delete the legacy value. Unknown keys are denied. Third-party
packages cannot use the official legacy migration boundary.

## Release workflow

From `nammu-notes`:

```text
bun run build
```

From NammuOS, with `NAMMU_RELEASE_PRIVATE_KEY_PATH` pointing outside both repositories:

```text
bun run nmu:release:sign -- ../nammu-notes/dist/os.nammu.notes-1.0.0-unsigned.napp ../nammu-notes/dist/os.nammu.notes-1.0.0-signed.napp
bun run notes:package:accept
bun run notes:sandbox:accept
```

The first acceptance covers signature, install, guarded update, rollback, data-retaining uninstall,
reinstall, and recovery. The second launches the real signed package in `AppSandboxHost`, migrates a
legacy note, edits it, closes the app, reopens it, and verifies persistence.

The release private key remains outside source control. Only the rotated public verification key is
part of NammuOS.
