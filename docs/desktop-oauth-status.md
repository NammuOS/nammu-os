# Desktop OAuth architecture and provider status

Status: Google Drive implemented and enabled for the local-first Windows desktop runtime. Every other desktop cloud provider remains deny-listed.

## Implemented Google Drive flow

Google Drive uses separate installed-app OAuth client metadata and the authorization-code flow:

1. React starts the operation through the authenticated `PlatformServices` transport.
2. The local Node service creates an independent 64-byte PKCE verifier, S256 challenge, 32-byte OAuth state, attempt ID, five-minute expiry, and one-time in-memory session.
3. A temporary HTTP listener binds to numeric `127.0.0.1` on port `0`; the OS-selected port becomes the exact redirect URI.
4. Nammu opens Google authorization in the system browser. React receives the transient authorization URL, but never receives the verifier, authorization code, access token, refresh token, or vault key.
5. The temporary listener accepts only the exact loopback Host, the root callback request, one GET callback, no forwarding metadata, and a matching single-use state. It is separate from the long-lived Nammu API and therefore does not weaken that API's Origin/HMAC proof boundary.
6. The local service exchanges the code with the installed-app client ID/secret metadata, original verifier, and byte-identical redirect URI; verifies the account through Drive `about`; and atomically commits the encrypted credential plus sanitized account metadata.
7. Tokens live only in `CredentialVault`. SQLite `cloud_accounts` contains only `credential_ref`; React receives sanitized account/file records.
8. Initial indexing preserves folders and parent paths. Subsequent provider operations and manual sync refresh the SQLite metadata index transactionally.

The manager handles explicit cancellation, denied consent, malformed callbacks, mismatched state, replay/duplicate callbacks, timeout, network and exchange failures, multiple concurrent attempts with a strict limit, restart persistence, access-token refresh, refresh-token rotation, revoked grants, reconnect, revocation, and atomic credential deletion on disconnect.

## Scope decision

Desktop requests only:

`https://www.googleapis.com/auth/drive`

This is broader than `drive.file`, but it is the minimum scope compatible with Nammu Cloud's approved product behavior: display the user's existing Drive hierarchy and support create, upload, download, preview, rename, star, trash, restore, permanent delete, and sync for existing items. `drive.file` would restrict Nammu to files created by or explicitly opened with the app and would not preserve the existing Cloud experience.

Google classifies the full Drive scope as restricted. A public distribution will therefore need the applicable OAuth consent-screen configuration, verification, privacy disclosures, and restricted-scope review. Nammu must not silently downgrade the scope and present an incomplete Drive as if it were complete.

## Release configuration

Create a Google Cloud OAuth client with application type **Desktop app**, separate from the confidential web client, then configure:

```env
GOOGLE_DESKTOP_CLIENT_ID=your-native-client-id.apps.googleusercontent.com
GOOGLE_DESKTOP_CLIENT_SECRET=your-native-client-metadata
```

Both values are non-confidential installed-app metadata; the Desktop client secret is not an application-authenticity boundary and never replaces PKCE. `desktop:server:prepare` validates the pair and copies it only into the local server's `desktop-provider-config.json`. The value is absent from React, URLs, logs, callback pages, SQLite, browser storage, and command-line arguments. Missing or partial metadata fails closed with a clear `503` response; it never falls back to Web OAuth credentials, Vercel, a hosted Nammu origin, or localhost defaults.

The separate Desktop-app client ID is configured as public package metadata. Automated protocol/provider simulations and the packaged architecture are verified. The real Google-account consent/token exchange and provider-operation acceptance remain **DEFERRED / FINAL ACCEPTANCE**; they are neither failed nor production-complete.

## Desktop route boundary

Enabled Google-only routes:

- `GET /api/accounts`
- `DELETE /api/accounts/<uuid>`
- `POST /api/accounts/google_drive/connect`
- `GET|DELETE /api/accounts/google_drive/status?attempt_id=...`
- `GET|PATCH /api/allocation`
- `GET /api/files`
- `POST /api/files/folders`
- `POST /api/files/bulk/delete`
- `POST /api/files/trash/empty`
- `GET /api/files/<uuid>/download`
- `GET /api/files/<uuid>/preview`
- `DELETE /api/files/<uuid>`
- exact reviewed rename/star/restore/permanent-delete action routes
- `POST /api/uploads/initiate`
- `POST /api/uploads/<opaque-id>/stream`
- `POST /api/sync/run`

Generic account/provider shapes remain classified but disabled after the narrower Google rules. The main Next OAuth callback route remains disabled on desktop; callbacks use the separate temporary listener. OneDrive, Dropbox, Yandex, MEGA, pCloud, and S3 connect routes remain disabled.

## Existing web flow

The current Next.js web OAuth handlers remain independent web-server flows backed by environment client secrets, Drizzle/PostgreSQL, and encrypted web credential columns. They were not redirected to SQLite or the desktop public client. `bun run dev` and the Next production build retain their prior same-origin behavior.

## Other provider status

- **OneDrive:** still requires a focused numeric-`127.0.0.1` public-client registration prototype.
- **Dropbox:** exact pre-registered redirect rules conflict with the approved dynamic callback port.
- **Yandex Disk:** documented redirect matching includes the port and conflicts with the dynamic-port rule.
- **MEGA, pCloud, S3:** direct-credential desktop flows remain unapproved and disabled.

No fixed callback port, manual-code workaround, confidential-native-secret claim, wildcard CORS, remote Nammu backend, remote Wisp, or Tauri HTTP/localhost permission was introduced.
