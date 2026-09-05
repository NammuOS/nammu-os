import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';

import { DESKTOP_SETTINGS_USER_ID } from './desktopDatabase.mjs';
import { DesktopGoogleOAuthError, GOOGLE_DESKTOP_OAUTH_SCOPE } from './desktopGoogleOAuth.mjs';
import { resolveGoogleDesktopClientMetadata } from './desktopGoogleClientMetadata.mjs';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;

const GOOGLE_DOWNLOAD_EXPORTS = Object.freeze({
  'application/vnd.google-apps.document': Object.freeze({
    extension: '.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }),
  'application/vnd.google-apps.spreadsheet': Object.freeze({
    extension: '.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }),
  'application/vnd.google-apps.presentation': Object.freeze({
    extension: '.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }),
  'application/vnd.google-apps.drawing': Object.freeze({
    extension: '.pdf',
    mimeType: 'application/pdf',
  }),
});

const GOOGLE_PREVIEW_EXPORTS = Object.freeze({
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
});

export class DesktopGoogleDriveError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'DesktopGoogleDriveError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeDesktopCloudPath(path) {
  const segments = String(path || '/')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new DesktopGoogleDriveError('invalid_path', 'The cloud path is invalid.', 400);
  }
  return segments.length ? `/${segments.join('/')}/` : '/';
}

export function validateDesktopCloudFileName(value) {
  const name = String(value || '').trim();
  if (!name || name === '.' || name === '..' || name.length > 255 || /[\0/\\]/.test(name)) {
    throw new DesktopGoogleDriveError('invalid_file_name', 'The file name is invalid.', 400);
  }
  return name;
}

function sanitizeAccount(account) {
  return Object.freeze({
    id: account.id,
    user_id: account.user_id,
    email: account.email,
    provider: 'google_drive',
    total_space: Number(account.total_space || 0),
    used_space: Number(account.used_space || 0),
    free_space: Math.max(0, Number(account.total_space || 0) - Number(account.used_space || 0)),
    status: account.status,
    created_at: account.created_at,
    updated_at: account.updated_at,
    ...(account.label ? { label: account.label } : {}),
  });
}

function sanitizeFile(file) {
  return Object.freeze({
    id: file.id,
    name: file.file_name,
    file_name: file.file_name,
    path: normalizeDesktopCloudPath(file.virtual_path),
    virtual_path: normalizeDesktopCloudPath(file.virtual_path),
    is_folder: Boolean(file.is_folder),
    is_starred: Boolean(file.is_starred),
    is_trashed: Boolean(file.is_trashed),
    is_shared: Boolean(file.is_shared),
    size: Number(file.size || 0),
    mime_type: file.mime_type || 'application/octet-stream',
    cloud_account_id: file.cloud_account_id,
    remote_file_id: file.remote_file_id,
    remote_parent_id: file.remote_parent_id,
    provider: 'google_drive',
    email: file.email,
    created_at: file.remote_created_time || file.created_at,
    updated_at: file.remote_modified_time || file.updated_at,
  });
}

async function responseJson(response) {
  const text = await response.text();
  if (text.length > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new DesktopGoogleDriveError(
      'provider_response_too_large',
      'Google Drive returned an unexpectedly large response.',
      502,
    );
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new DesktopGoogleDriveError(
      'provider_response_invalid',
      'Google Drive returned an invalid response.',
      502,
    );
  }
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter <= 30) {
    return retryAfter * 1000;
  }
  return Math.min(4_000, 350 * 2 ** attempt);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function providerError(status) {
  if (status === 401) {
    return new DesktopGoogleDriveError(
      'google_credentials_expired',
      'Google Drive access has expired. Reconnect this account.',
      401,
    );
  }
  if (status === 403) {
    return new DesktopGoogleDriveError(
      'google_access_denied',
      'Google Drive denied this operation. Check the account permission and try again.',
      403,
    );
  }
  if (status === 404) {
    return new DesktopGoogleDriveError(
      'google_file_not_found',
      'The Google Drive item no longer exists.',
      404,
    );
  }
  if (status === 429) {
    return new DesktopGoogleDriveError(
      'google_rate_limited',
      'Google Drive is temporarily rate limiting requests. Try again shortly.',
      429,
    );
  }
  return new DesktopGoogleDriveError(
    'google_provider_error',
    'Google Drive could not complete the operation.',
    status >= 500 ? 502 : status,
  );
}

function escapeDriveQuery(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildParentPath(file, byId, rootId) {
  const segments = [];
  const visited = new Set();
  let parentId = file.parents?.[0];
  while (parentId && parentId !== rootId && parentId !== 'root' && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.name) segments.unshift(parent.name);
    parentId = parent.parents?.[0];
  }
  return normalizeDesktopCloudPath(segments.length ? `/${segments.join('/')}/` : '/');
}

function isInSharedTree(file, files) {
  const byRemoteId = new Map(
    files
      .filter((candidate) => candidate.cloud_account_id === file.cloud_account_id)
      .map((candidate) => [candidate.remote_file_id, candidate]),
  );
  const visited = new Set();
  let current = file;
  while (current && !visited.has(current.remote_file_id)) {
    visited.add(current.remote_file_id);
    if (current.is_shared) return true;
    current = current.remote_parent_id ? byRemoteId.get(current.remote_parent_id) : null;
  }
  return false;
}

function validateStoredCredential(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.accessToken !== 'string' ||
    typeof value.refreshToken !== 'string' ||
    !Number.isFinite(value.expiresAt)
  ) {
    throw new DesktopGoogleDriveError(
      'credential_invalid',
      'The stored Google Drive authorization is invalid. Reconnect the account.',
      401,
    );
  }
  return value;
}

export function createDesktopGoogleDriveService({
  database,
  clientId,
  clientSecret,
  fetchImplementation = globalThis.fetch,
  now = () => Date.now(),
}) {
  const refreshLocks = new Map();

  function configuredMetadata() {
    const metadata = resolveGoogleDesktopClientMetadata(clientId, clientSecret);
    if (!metadata) {
      throw new DesktopGoogleDriveError(
        'google_desktop_oauth_not_configured',
        'Google Drive desktop OAuth is not configured for this build.',
        503,
      );
    }
    return metadata;
  }

  function requireAccount(accountId, { allowInvalid = false } = {}) {
    const account = database.cloudAccounts.get(accountId, DESKTOP_SETTINGS_USER_ID);
    if (!account || account.provider !== 'google_drive') {
      throw new DesktopGoogleDriveError(
        'account_not_found',
        'Google Drive account not found.',
        404,
      );
    }
    if (!allowInvalid && account.status !== 'active') {
      throw new DesktopGoogleDriveError(
        'account_reconnect_required',
        'Reconnect this Google Drive account before using it.',
        409,
      );
    }
    return account;
  }

  async function refreshCredential(account, previous) {
    const metadata = configuredMetadata();
    let response;
    try {
      response = await fetchImplementation(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: metadata.clientId,
          client_secret: metadata.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: previous.refreshToken,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new DesktopGoogleDriveError(
        'token_refresh_network_error',
        'Nammu could not reach Google to refresh this account.',
        502,
      );
    }
    const payload = await responseJson(response);
    if (!response.ok) {
      if (payload?.error === 'invalid_grant' || response.status === 401) {
        database.cloudAccounts.update(account.id, { status: 'invalid_token' });
        throw new DesktopGoogleDriveError(
          'google_authorization_revoked',
          'Google Drive access was revoked. Reconnect this account.',
          401,
        );
      }
      throw providerError(response.status);
    }
    if (
      typeof payload.access_token !== 'string' ||
      !Number.isFinite(Number(payload.expires_in)) ||
      Number(payload.expires_in) <= 0
    ) {
      throw new DesktopGoogleDriveError(
        'token_refresh_invalid',
        'Google returned an invalid refreshed credential.',
        502,
      );
    }
    const next = {
      ...previous,
      accessToken: payload.access_token,
      refreshToken:
        typeof payload.refresh_token === 'string' && payload.refresh_token
          ? payload.refresh_token
          : previous.refreshToken,
      expiresAt: now() + Number(payload.expires_in) * 1000,
      scope: typeof payload.scope === 'string' ? payload.scope : previous.scope,
      tokenType: typeof payload.token_type === 'string' ? payload.token_type : previous.tokenType,
    };
    database.credentials.store(account.credential_ref, next);
    database.cloudAccounts.update(account.id, { status: 'active' });
    return next;
  }

  async function credentialFor(account, forceRefresh = false) {
    let credential = validateStoredCredential(
      database.credentials.retrieve(account.credential_ref),
    );
    if (!forceRefresh && credential.expiresAt > now() + 60_000) return credential;
    let lock = refreshLocks.get(account.id);
    if (!lock) {
      lock = refreshCredential(account, credential).finally(() => refreshLocks.delete(account.id));
      refreshLocks.set(account.id, lock);
    }
    credential = await lock;
    return credential;
  }

  async function googleFetch(account, url, init = {}, options = {}) {
    const retryable = options.retryable ?? (init.method === undefined || init.method === 'GET');
    const replayableBody = !init.body || typeof init.body?.pipe !== 'function';
    const maxRetries = retryable ? 2 : 0;
    let credential = await credentialFor(account, false);
    let refreshedAfterUnauthorized = false;
    for (let attempt = 0; ; attempt += 1) {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${credential.accessToken}`);
      let response;
      try {
        response = await fetchImplementation(url, {
          ...init,
          headers,
          redirect: 'error',
          signal: init.signal || AbortSignal.timeout(options.timeoutMs || REQUEST_TIMEOUT_MS),
          ...(init.body && typeof init.body?.pipe === 'function' ? { duplex: 'half' } : {}),
        });
      } catch {
        throw new DesktopGoogleDriveError(
          'google_network_error',
          'Nammu could not reach Google Drive. Check the network and try again.',
          502,
        );
      }
      if (response.status === 401 && !refreshedAfterUnauthorized && replayableBody) {
        await response.body?.cancel().catch(() => undefined);
        credential = await credentialFor(account, true);
        refreshedAfterUnauthorized = true;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await response.body?.cancel().catch(() => undefined);
        await wait(retryDelay(response, attempt));
        continue;
      }
      return response;
    }
  }

  async function googleJson(account, url, init = {}, options = {}) {
    const response = await googleFetch(account, url, init, options);
    const payload = await responseJson(response);
    if (!response.ok) throw providerError(response.status);
    return payload;
  }

  async function aboutWithAccessToken(accessToken) {
    let response;
    try {
      const url = new URL(`${DRIVE_API}/about`);
      url.searchParams.set('fields', 'user(displayName,emailAddress),storageQuota(limit,usage)');
      response = await fetchImplementation(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new DesktopGoogleOAuthError(
        'google_profile_network_error',
        'Nammu could not verify the Google Drive account.',
        502,
      );
    }
    const payload = await responseJson(response);
    if (!response.ok) {
      throw new DesktopGoogleOAuthError(
        'google_profile_failed',
        'Google Drive authorization succeeded, but the account could not be verified.',
        502,
      );
    }
    const email = payload?.user?.emailAddress;
    if (typeof email !== 'string' || !email.includes('@') || email.length > 320) {
      throw new DesktopGoogleOAuthError(
        'google_profile_invalid',
        'Google did not return a valid Drive account identity.',
        502,
      );
    }
    return {
      email: email.toLowerCase(),
      totalSpace: Number(payload.storageQuota?.limit || 0),
      usedSpace: Number(payload.storageQuota?.usage || 0),
    };
  }

  async function listRemoteFiles(account) {
    const files = [];
    let pageToken = null;
    do {
      const url = new URL(`${DRIVE_API}/files`);
      url.searchParams.set('pageSize', '1000');
      url.searchParams.set('spaces', 'drive');
      url.searchParams.set('corpora', 'user');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set(
        'fields',
        'nextPageToken,files(id,name,mimeType,size,starred,trashed,shared,sharedWithMeTime,ownedByMe,parents,createdTime,modifiedTime)',
      );
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const payload = await googleJson(account, url);
      if (Array.isArray(payload.files)) files.push(...payload.files);
      pageToken = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : null;
    } while (pageToken);
    return files;
  }

  async function listRemoteFolderChildren(account, remoteFolderId) {
    const files = [];
    let pageToken = null;
    do {
      const url = new URL(`${DRIVE_API}/files`);
      url.searchParams.set(
        'q',
        `'${escapeDriveQuery(remoteFolderId)}' in parents and trashed = false`,
      );
      url.searchParams.set('pageSize', '1000');
      url.searchParams.set('spaces', 'drive');
      url.searchParams.set('corpora', 'user');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set(
        'fields',
        'nextPageToken,files(id,name,mimeType,size,starred,trashed,shared,sharedWithMeTime,ownedByMe,parents,createdTime,modifiedTime)',
      );
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const payload = await googleJson(account, url);
      if (Array.isArray(payload.files)) files.push(...payload.files);
      pageToken = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : null;
    } while (pageToken);
    return files;
  }

  async function syncAccount(accountId) {
    const account = requireAccount(accountId, { allowInvalid: true });
    try {
      const aboutUrl = new URL(`${DRIVE_API}/about`);
      aboutUrl.searchParams.set('fields', 'user(emailAddress),storageQuota(limit,usage)');
      const rootUrl = new URL(`${DRIVE_API}/files/root`);
      rootUrl.searchParams.set('fields', 'id');
      rootUrl.searchParams.set('supportsAllDrives', 'true');
      const [about, root, remoteFiles] = await Promise.all([
        googleJson(account, aboutUrl),
        googleJson(account, rootUrl),
        listRemoteFiles(account),
      ]);
      const valid = remoteFiles.filter(
        (file) => typeof file?.id === 'string' && typeof file?.name === 'string',
      );
      const byId = new Map(valid.map((file) => [file.id, file]));
      const rootId = typeof root.id === 'string' ? root.id : 'root';
      const timestamp = new Date(now()).toISOString();
      const rows = valid.map((file) => ({
        id: randomUUID(),
        virtualPath: buildParentPath(file, byId, rootId),
        fileName: file.name,
        isFolder: file.mimeType === GOOGLE_FOLDER_MIME_TYPE,
        isStarred: Boolean(file.starred),
        isTrashed: Boolean(file.trashed),
        // `shared` also covers files owned by the user and shared outward.
        // `sharedWithMeTime` identifies Google's actual Shared with me collection.
        isShared: typeof file.sharedWithMeTime === 'string' && Boolean(file.sharedWithMeTime),
        size: Number(file.size || 0),
        mimeType: file.mimeType || 'application/octet-stream',
        remoteFileId: file.id,
        remoteParentId: file.parents?.[0] || null,
        remoteCreatedTime: file.createdTime || null,
        remoteModifiedTime: file.modifiedTime || null,
        createdAt: file.createdTime || timestamp,
        updatedAt: file.modifiedTime || timestamp,
      }));
      database.cloudFiles.replaceForAccount(account.id, rows);
      database.cloudAccounts.update(account.id, {
        totalSpace: Number(about.storageQuota?.limit || 0),
        usedSpace: Number(about.storageQuota?.usage || 0),
        status: 'active',
      });
      return { fileCount: rows.length };
    } catch (error) {
      if (error instanceof DesktopGoogleDriveError && [401, 403].includes(error.status)) {
        database.cloudAccounts.update(account.id, { status: 'invalid_token' });
      }
      throw error;
    }
  }

  async function ensurePath(account, virtualPath) {
    const parts = normalizeDesktopCloudPath(virtualPath).split('/').filter(Boolean);
    let parentId = 'root';
    for (const part of parts) {
      const listUrl = new URL(`${DRIVE_API}/files`);
      listUrl.searchParams.set(
        'q',
        `'${escapeDriveQuery(parentId)}' in parents and name = '${escapeDriveQuery(part)}' and mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and trashed = false`,
      );
      listUrl.searchParams.set('pageSize', '2');
      listUrl.searchParams.set('spaces', 'drive');
      listUrl.searchParams.set('fields', 'files(id,name)');
      const listed = await googleJson(account, listUrl);
      const existingId = listed.files?.[0]?.id;
      if (typeof existingId === 'string') {
        parentId = existingId;
        continue;
      }
      const createUrl = new URL(`${DRIVE_API}/files`);
      createUrl.searchParams.set('fields', 'id');
      const created = await googleJson(
        account,
        createUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: part,
            mimeType: GOOGLE_FOLDER_MIME_TYPE,
            parents: [parentId],
          }),
        },
        { retryable: false },
      );
      if (typeof created.id !== 'string') {
        throw new DesktopGoogleDriveError(
          'folder_create_failed',
          'Google Drive did not return the new folder.',
          502,
        );
      }
      parentId = created.id;
    }
    return parentId;
  }

  async function mutateFile(fileId, changes) {
    const file = database.cloudFiles.get(fileId, DESKTOP_SETTINGS_USER_ID);
    if (!file) throw new DesktopGoogleDriveError('file_not_found', 'Cloud file not found.', 404);
    const account = requireAccount(file.cloud_account_id);
    const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(file.remote_file_id)}`);
    url.searchParams.set('fields', 'id');
    url.searchParams.set('supportsAllDrives', 'true');
    await googleJson(
      account,
      url,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      },
      { retryable: false },
    );
    await syncAccount(account.id);
  }

  return Object.freeze({
    listAccounts() {
      return database.cloudAccounts
        .list(DESKTOP_SETTINGS_USER_ID)
        .filter((account) => account.provider === 'google_drive')
        .map(sanitizeAccount);
    },

    async completeAuthorization({ tokens, label }) {
      const profile = await aboutWithAccessToken(tokens.accessToken);
      const existing = database.cloudAccounts.findGoogleByEmail(
        profile.email,
        DESKTOP_SETTINGS_USER_ID,
      );
      let previous = null;
      if (existing) {
        previous = database.credentials.retrieve(existing.credential_ref);
      }
      const refreshToken = tokens.refreshToken || previous?.refreshToken;
      if (typeof refreshToken !== 'string' || !refreshToken) {
        throw new DesktopGoogleOAuthError(
          'refresh_token_missing',
          'Google did not issue an offline refresh token. Revoke Nammu OS access in Google and connect again.',
          502,
        );
      }
      if (
        !String(tokens.scope || '')
          .split(/\s+/)
          .includes(GOOGLE_DESKTOP_OAUTH_SCOPE)
      ) {
        throw new DesktopGoogleOAuthError(
          'drive_scope_missing',
          'Google did not grant the Drive permission required by Nammu Cloud.',
          403,
        );
      }
      const timestamp = new Date(now()).toISOString();
      const id = existing?.id || randomUUID();
      const credentialRef = existing?.credential_ref || `google-drive:${id}`;
      const credential = {
        accessToken: tokens.accessToken,
        refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
        tokenType: tokens.tokenType,
      };
      const committed = database.cloudAccounts.commitGoogle(
        {
          id,
          userId: DESKTOP_SETTINGS_USER_ID,
          email: profile.email,
          credentialRef,
          totalSpace: profile.totalSpace,
          usedSpace: profile.usedSpace,
          label,
          createdAt: existing?.created_at || timestamp,
          updatedAt: timestamp,
        },
        credential,
      );

      let warning = null;
      try {
        await syncAccount(committed.id);
      } catch {
        warning = 'Google Drive connected, but its file index could not be refreshed yet.';
      }
      const current = database.cloudAccounts.get(committed.id, DESKTOP_SETTINGS_USER_ID);
      return { account: sanitizeAccount(current), warning };
    },

    async disconnect(accountId) {
      const account = requireAccount(accountId, { allowInvalid: true });
      const credential = validateStoredCredential(
        database.credentials.retrieve(account.credential_ref),
      );
      let response;
      try {
        response = await fetchImplementation(GOOGLE_REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: credential.refreshToken || credential.accessToken }),
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new DesktopGoogleDriveError(
          'google_revoke_network_error',
          'Nammu could not reach Google to revoke this account. Nothing was disconnected.',
          502,
        );
      }
      if (!response.ok && response.status !== 400) throw providerError(response.status);
      database.cloudAccounts.disconnect(account.id, DESKTOP_SETTINGS_USER_ID);
      refreshLocks.delete(account.id);
      return true;
    },

    listFiles(query = {}) {
      const path = normalizeDesktopCloudPath(query.path || '/');
      let files = database.cloudFiles.list(DESKTOP_SETTINGS_USER_ID);
      if (query.trash) files = files.filter((file) => Boolean(file.is_trashed));
      else {
        files = files.filter((file) => !file.is_trashed);
        if (query.starred) files = files.filter((file) => Boolean(file.is_starred));
        else if (query.shared) files = files.filter((file) => Boolean(file.is_shared));
        else if (query.search) {
          const needle = query.search.toLocaleLowerCase();
          files = files.filter((file) => file.file_name.toLocaleLowerCase().includes(needle));
        } else if (query.recent) {
          files = files
            .filter((file) => !file.is_folder)
            .sort(
              (left, right) =>
                Date.parse(right.remote_modified_time || right.updated_at) -
                Date.parse(left.remote_modified_time || left.updated_at),
            )
            .slice(0, 50);
        } else {
          files = files.filter(
            (file) =>
              !isInSharedTree(file, files) && normalizeDesktopCloudPath(file.virtual_path) === path,
          );
        }
      }
      return files.map(sanitizeFile);
    },

    async listSharedFolder(folderId) {
      const folder = database.cloudFiles.get(folderId, DESKTOP_SETTINGS_USER_ID);
      if (!folder || !folder.is_folder || folder.is_trashed) {
        throw new DesktopGoogleDriveError(
          'shared_folder_not_found',
          'The shared Google Drive folder is unavailable.',
          404,
        );
      }
      const indexedFiles = database.cloudFiles.list(DESKTOP_SETTINGS_USER_ID);
      if (!isInSharedTree(folder, indexedFiles)) {
        throw new DesktopGoogleDriveError(
          'shared_folder_not_found',
          'The selected folder is not part of Shared with me.',
          404,
        );
      }

      const account = requireAccount(folder.cloud_account_id);
      const remoteFiles = await listRemoteFolderChildren(account, folder.remote_file_id);
      const timestamp = new Date(now()).toISOString();
      const virtualPath = normalizeDesktopCloudPath(`${folder.virtual_path}${folder.file_name}/`);
      const rows = remoteFiles
        .filter((file) => typeof file?.id === 'string' && typeof file?.name === 'string')
        .map((file) => {
          const existing = database.cloudFiles.getByRemote(account.id, file.id);
          return {
            id: existing?.id || randomUUID(),
            virtualPath,
            fileName: file.name,
            isFolder: file.mimeType === GOOGLE_FOLDER_MIME_TYPE,
            isStarred: Boolean(file.starred),
            isTrashed: Boolean(file.trashed),
            isShared: typeof file.sharedWithMeTime === 'string' && Boolean(file.sharedWithMeTime),
            size: Number(file.size || 0),
            mimeType: file.mimeType || 'application/octet-stream',
            remoteFileId: file.id,
            remoteParentId: file.parents?.[0] || folder.remote_file_id,
            remoteCreatedTime: file.createdTime || null,
            remoteModifiedTime: file.modifiedTime || null,
            createdAt: file.createdTime || existing?.created_at || timestamp,
            updatedAt: file.modifiedTime || timestamp,
          };
        });
      database.cloudFiles.upsertForAccount(account.id, rows);
      return rows
        .map((row) => database.cloudFiles.getByRemote(account.id, row.remoteFileId))
        .filter(Boolean)
        .sort((left, right) => {
          if (left.is_folder !== right.is_folder) return left.is_folder ? -1 : 1;
          return left.file_name.localeCompare(right.file_name, undefined, { sensitivity: 'base' });
        })
        .map(sanitizeFile);
    },

    async syncAll() {
      const accounts = database.cloudAccounts
        .list(DESKTOP_SETTINGS_USER_ID)
        .filter((account) => account.provider === 'google_drive');
      const results = [];
      const failures = [];
      for (const account of accounts) {
        try {
          results.push({ accountId: account.id, ...(await syncAccount(account.id)) });
        } catch (error) {
          failures.push({
            accountId: account.id,
            error: error instanceof Error ? error.message : 'Google Drive sync failed.',
          });
        }
      }
      return { results, failures };
    },

    async createFolder({ virtualPath, folderName, accountId }) {
      const name = validateDesktopCloudFileName(folderName);
      const account = accountId
        ? requireAccount(accountId)
        : database.cloudAccounts
            .list(DESKTOP_SETTINGS_USER_ID)
            .filter(
              (candidate) => candidate.provider === 'google_drive' && candidate.status === 'active',
            )
            .sort(
              (left, right) =>
                right.total_space - right.used_space - (left.total_space - left.used_space),
            )[0];
      if (!account) {
        throw new DesktopGoogleDriveError(
          'active_account_required',
          'Connect an active Google Drive account first.',
          409,
        );
      }
      const parentId = await ensurePath(account, virtualPath);
      const url = new URL(`${DRIVE_API}/files`);
      url.searchParams.set('fields', 'id');
      const created = await googleJson(
        account,
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, mimeType: GOOGLE_FOLDER_MIME_TYPE, parents: [parentId] }),
        },
        { retryable: false },
      );
      await syncAccount(account.id);
      const local = database.cloudFiles.getByRemote(account.id, created.id);
      if (!local) {
        throw new DesktopGoogleDriveError(
          'folder_index_failed',
          'The folder was created, but Nammu could not find it in the refreshed Drive index.',
          502,
        );
      }
      return sanitizeFile(local);
    },

    async rename(fileId, name) {
      await mutateFile(fileId, { name: validateDesktopCloudFileName(name) });
    },
    async star(fileId, isStarred) {
      await mutateFile(fileId, { starred: Boolean(isStarred) });
    },
    async trash(fileId, isTrashed = true) {
      await mutateFile(fileId, { trashed: Boolean(isTrashed) });
    },
    async deletePermanently(fileId) {
      const file = database.cloudFiles.get(fileId, DESKTOP_SETTINGS_USER_ID);
      if (!file) throw new DesktopGoogleDriveError('file_not_found', 'Cloud file not found.', 404);
      const account = requireAccount(file.cloud_account_id);
      const response = await googleFetch(
        account,
        `${DRIVE_API}/files/${encodeURIComponent(file.remote_file_id)}?supportsAllDrives=true`,
        { method: 'DELETE' },
        { retryable: false },
      );
      if (!response.ok) throw providerError(response.status);
      await syncAccount(account.id);
    },
    async bulkTrash(fileIds) {
      for (const fileId of [...new Set(fileIds)]) await this.trash(fileId, true);
    },
    async emptyTrash() {
      const accounts = database.cloudAccounts
        .list(DESKTOP_SETTINGS_USER_ID)
        .filter((account) => account.provider === 'google_drive' && account.status === 'active');
      for (const account of accounts) {
        const response = await googleFetch(
          account,
          `${DRIVE_API}/files/trash`,
          { method: 'DELETE' },
          { retryable: false },
        );
        if (!response.ok) throw providerError(response.status);
        await syncAccount(account.id);
      }
    },

    selectUploadAccount(accountId) {
      if (accountId) return requireAccount(accountId);
      const account = database.cloudAccounts
        .list(DESKTOP_SETTINGS_USER_ID)
        .filter(
          (candidate) => candidate.provider === 'google_drive' && candidate.status === 'active',
        )
        .sort(
          (left, right) =>
            right.total_space - right.used_space - (left.total_space - left.used_space),
        )[0];
      if (!account) {
        throw new DesktopGoogleDriveError(
          'active_account_required',
          'Connect an active Google Drive account before uploading.',
          409,
        );
      }
      return account;
    },

    async upload({ accountId, filePath, fileName, mimeType, size, virtualPath }) {
      const account = requireAccount(accountId);
      const name = validateDesktopCloudFileName(fileName);
      const parentId = await ensurePath(account, virtualPath);
      const initiateUrl = new URL(`${DRIVE_UPLOAD_API}/files`);
      initiateUrl.searchParams.set('uploadType', 'resumable');
      initiateUrl.searchParams.set('fields', 'id');
      const initiation = await googleFetch(
        account,
        initiateUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Upload-Content-Length': String(size),
            'X-Upload-Content-Type': mimeType,
          },
          body: JSON.stringify({ name, parents: [parentId] }),
        },
        { retryable: false },
      );
      if (!initiation.ok) throw providerError(initiation.status);
      const uploadLocation = initiation.headers.get('location');
      let uploadUrl;
      try {
        uploadUrl = new URL(uploadLocation);
      } catch {
        throw new DesktopGoogleDriveError(
          'upload_session_invalid',
          'Google Drive did not return a valid upload session.',
          502,
        );
      }
      if (uploadUrl.protocol !== 'https:' || uploadUrl.hostname !== 'www.googleapis.com') {
        throw new DesktopGoogleDriveError(
          'upload_session_invalid',
          'Google Drive returned an untrusted upload address.',
          502,
        );
      }
      const uploaded = await googleFetch(
        account,
        uploadUrl,
        {
          method: 'PUT',
          headers: { 'Content-Length': String(size), 'Content-Type': mimeType },
          body: createReadStream(filePath),
        },
        { retryable: false, timeoutMs: 30 * 60 * 1000 },
      );
      if (!uploaded.ok) throw providerError(uploaded.status);
      const uploadedMetadata = await responseJson(uploaded);
      if (typeof uploadedMetadata.id !== 'string') {
        throw new DesktopGoogleDriveError(
          'upload_response_invalid',
          'Google Drive accepted the upload without returning the new file.',
          502,
        );
      }
      await syncAccount(account.id);
      const local = database.cloudFiles.getByRemote(account.id, uploadedMetadata.id);
      if (!local) {
        throw new DesktopGoogleDriveError(
          'upload_index_failed',
          'The file was uploaded, but Nammu could not find it in the refreshed Drive index.',
          502,
        );
      }
      return sanitizeFile(local);
    },

    async media(fileId, { preview = false, range = null } = {}) {
      const file = database.cloudFiles.get(fileId, DESKTOP_SETTINGS_USER_ID);
      if (!file) throw new DesktopGoogleDriveError('file_not_found', 'Cloud file not found.', 404);
      if (file.is_folder) {
        throw new DesktopGoogleDriveError(
          'folder_has_no_media',
          'Folders cannot be downloaded or previewed as files.',
          400,
        );
      }
      const account = requireAccount(file.cloud_account_id);
      const exportConfig = preview
        ? GOOGLE_PREVIEW_EXPORTS[file.mime_type]
          ? { mimeType: GOOGLE_PREVIEW_EXPORTS[file.mime_type], extension: '' }
          : null
        : GOOGLE_DOWNLOAD_EXPORTS[file.mime_type] || null;
      let url;
      const mimeType = exportConfig?.mimeType || file.mime_type || 'application/octet-stream';
      let fileName = file.file_name;
      if (exportConfig) {
        url = new URL(`${DRIVE_API}/files/${encodeURIComponent(file.remote_file_id)}/export`);
        url.searchParams.set('mimeType', exportConfig.mimeType);
        if (exportConfig.extension && !fileName.toLowerCase().endsWith(exportConfig.extension)) {
          fileName += exportConfig.extension;
        }
      } else {
        url = new URL(`${DRIVE_API}/files/${encodeURIComponent(file.remote_file_id)}`);
        url.searchParams.set('alt', 'media');
        url.searchParams.set('supportsAllDrives', 'true');
      }
      const headers = range && !exportConfig ? { Range: range } : {};
      const response = await googleFetch(account, url, { headers }, { retryable: true });
      if (!response.ok && response.status !== 206) throw providerError(response.status);
      return {
        response,
        fileName,
        mimeType,
        size: Number(file.size || 0),
        export: Boolean(exportConfig),
      };
    },
  });
}
