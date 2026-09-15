# Telegram T0: partitioned integration profiles

Status: runtime foundation only. Telegram remains a built-in application during T0.

## Package contract

A packaged integration requests a surface with three opaque logical values:

```ts
webSurfaces.create({
  capability: "telegram-web",
  profileKey: "telegram",
  partitionKey: "account-a",
  // url, bounds, visibility...
})
```

`maxSurfaces` and `maxPartitions` are mandatory bounds supplied by the signed
manifest for a partitioned capability. A partitioned capability must use a
persistent profile. The broker rejects missing, undeclared, malformed, and
over-limit partitions before reaching the platform driver.

The package never receives a Firefox contextual-identity ID, WebView2 data
directory, filesystem path, native profile handle, or another package's
namespace.

## Runtime mapping

Core hashes the package ID into an internal namespace. The package does not
choose this namespace.

| Runtime | Engine/profile mapping | Partition mapping |
| --- | --- | --- |
| Web | one Gecko/WASM iframe per isolated package + `profileKey` | Firefox contextual identity (`userContextId`) selected by Core |
| Windows Desktop | package-isolated persistent WebView2 profile | child directory selected by Core below that profile |

An omitted `partitionKey` retains the pre-T0 mapping exactly. In particular,
the extracted Browser package and the built-in Browser's existing profile
paths are unchanged.

## Trusted profile adoption

Authenticated browser-profile adoption is deliberately separate from
`migration.legacy-storage`.

The package manifest can name only a reviewed migration ID, version,
destination capability, and destination logical profile. At runtime it can
supply only a legacy logical account ID and matching destination partition.
Core's allowlist supplies all privileged facts:

- exact package ID (`os.nammu.telegram`)
- official publisher and current release key identity
- legacy namespace (`telegram`)
- destination capability/profile
- migration version and maximum partition count

Desktop resolves the approved legacy layout internally and performs a
same-volume atomic directory rename. A durable journal is written before the
rename and marked complete afterward. Recovery handles either a prepared move
that has not happened or a move that completed before the final journal write.
Existing destination data is never overwritten, and both copies are never
treated as writable simultaneously.

Web adoption stores a Core-owned alias from the package partition to the old
Firefox contextual-identity name. Opening the adopted partition therefore
uses the existing container rather than creating a fresh login. Package code
cannot read or alter this alias store.

## Lifecycle

| Operation | VFS user data | integration profiles |
| --- | --- | --- |
| Update / repair / rollback | preserve | preserve |
| Uninstall, retain data | preserve | preserve |
| Uninstall, purge data | remove | remove before package records are deleted |

Desktop purge removes only directories whose first child below
`web-surfaces/integration` begins with Core's exact package namespace. Active
profiles and redirected directory entries fail closed. Adoption journals for
that package are removed after its profiles.

Web purge deletes Core adoption aliases and removes the adopted Firefox
contextual identities. If no pooled Gecko session is running, Core starts a
hidden, temporary local Gecko cleanup session; failure or timeout aborts purge
rather than claiming success.

## Security invariants

- Only trusted Nammu shell webviews possess the Tauri command permissions.
- Remote WebView2 children and sandboxed package iframes cannot invoke native
  profile commands.
- The broker binds surface handles to one authenticated package instance.
- A package cannot supply paths, namespaces, Firefox IDs, or WebView2 handles.
- Adoption requires a verified official package, exact package/publisher/key
  identity, exact declaration, and a Core allowlist entry.
- Community, developer, unsigned, wrong-ID, wrong-key, path traversal, replay
  collision, cross-package adoption, and cross-package purge attempts fail
  closed.
- Profile purge runs before destructive nmu uninstall. A purge failure leaves
  the package installed and recoverable.

## T0 boundary

This phase adds runtime infrastructure only. It does not create
`NammuOS/nammu-telegram`, change Telegram UI, or migrate Telegram metadata.
Telegram extraction begins only after this checkpoint is approved.
