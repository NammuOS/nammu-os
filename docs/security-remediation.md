# Urgent repository credential remediation

This task is intentionally separate from the Tauri/desktop migration.

`k8s/secret.yaml` is tracked and contains production-like credential material. The repository and any environment that used those values must be treated as exposed until the credentials are rotated. The manifest must not be used for a deployment in its current form.

Required remediation, in order:

1. Inventory every credential represented by the manifest and identify where it has been used.
2. Revoke or rotate the values at their authoritative providers first. Removing a file does not invalidate a leaked credential.
3. Verify the applications with the new values and review provider/audit logs for unexpected use.
4. Replace the tracked manifest with a non-secret template or a deployment-time secret reference. Real values must come from an approved secret manager or private deployment environment, never Git.
5. Remove the historical values from repository history using a coordinated history rewrite if the repository has been shared, then invalidate old clones/caches as appropriate.
6. Add automated secret scanning and a documented rotation owner/runbook before a public release.

No credential value should be copied into an issue, commit message, build log, screenshot, or migration report. Rotation and history cleanup require explicit operational coordination and were not performed as part of Phase 1C-LOCAL.
