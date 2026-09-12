# Nammu official package signing

NammuOS trusts official `.napp` packages through the Ed25519 public key identified by `nammu-official-2026-09`. Only that public key belongs in the source tree and application bundles.

## Private-key boundary

The matching PKCS#8 private key is outside this repository at:

```text
C:\Users\navne\AppData\Local\NammuOS\release-signing\official-ed25519-private.pk8
```

The directory has inherited ACLs removed and grants full control only to `NAVNE\navne`. This local file is an initial signing-environment artifact—not a backup strategy. Before public distribution, move it into a protected offline or CI secret store and define recovery/rotation procedures. Never commit, bundle, log, or pass its bytes as a command-line argument.

## Signing a release

The release signer reads the private-key location only from the release environment:

```powershell
$env:NAMMU_RELEASE_PRIVATE_KEY_PATH = 'C:\secure\official-ed25519-private.pk8'
bun run nmu:release:sign -- .\unsigned.napp .\signed.napp
```

The signer:

- accepts only unsigned `os.nammu.*` packages;
- requires the manifest publisher and key ID to match the configured official identity;
- derives the public key from the supplied private key and compares it with NammuOS's compiled verification key;
- signs the canonical package digest with Ed25519;
- writes through a temporary output and refuses in-place signing;
- never prints private-key contents.

Verify the configured private/public pair and complete package trust path with:

```powershell
$env:NAMMU_RELEASE_PRIVATE_KEY_PATH = 'C:\secure\official-ed25519-private.pk8'
bun run nmu:release:accept
```

Key rotation requires a new key ID/public key release and an explicitly designed publisher-continuity transition. Do not overwrite the current identity silently.
