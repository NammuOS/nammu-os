import { Readable } from 'node:stream';

import { normalizeVirtualPath, validateCloudFileName } from '@/server/services/googleDriveService';
import {
  BaseCloudAdapter,
  decodeAccountCredentials,
  guessMimeType,
  persistAccountCredentials,
  sliceDownloadStream,
  type CloudFileRecord,
  type DownloadOptions,
  type RemoteCloudItem,
  type UploadedCloudItem,
  type UploadStreamInput,
} from './cloudAdapter';

type JsonObject = Record<string, unknown>;
const DROPBOX_SIMPLE_UPLOAD_LIMIT = 140 * 1024 * 1024;
const DROPBOX_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

async function* fixedChunks(stream: Readable, chunkSize: number): AsyncGenerator<Buffer> {
  let pending = Buffer.alloc(0);
  for await (const value of stream) {
    pending = Buffer.concat([pending, Buffer.isBuffer(value) ? value : Buffer.from(value)]);
    while (pending.length >= chunkSize) {
      yield pending.subarray(0, chunkSize);
      pending = pending.subarray(chunkSize);
    }
  }
  if (pending.length) yield pending;
}

function dropboxPath(parentPath: string, name = ''): string {
  const parent = normalizeVirtualPath(parentPath);
  return `${parent === '/' ? '' : parent.replace(/\/+$/, '')}/${name}`;
}

function parentPath(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return normalizeVirtualPath(clean.slice(0, clean.lastIndexOf('/') + 1) || '/');
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as Record<string, unknown>;
  return String(value.error_summary || value.message || fallback);
}

export class DropboxCloudAdapter extends BaseCloudAdapter {
  override readonly capabilities = {
    permanentDelete: true,
    restore: false,
    starred: false,
    trash: false,
  };

  private tokenCache: { token: string; expiresAt: number } | null = null;

  private async accessToken(force = false): Promise<string> {
    if (!force && this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.token;
    }
    const credentials = decodeAccountCredentials(this.account);
    if (
      !force &&
      credentials.accessToken &&
      Number(credentials.expiresAt || 0) > Date.now() + 30_000
    ) {
      return String(credentials.accessToken);
    }
    if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
      if (credentials.accessToken) return String(credentials.accessToken);
      throw new Error('Dropbox credentials are incomplete. Reconnect the account.');
    }
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: String(credentials.clientId),
        client_secret: String(credentials.clientSecret),
        refresh_token: String(credentials.refreshToken),
        grant_type: 'refresh_token',
      }),
    });
    const payload = (await response.json()) as JsonObject;
    if (!response.ok) throw new Error(errorMessage(payload, 'Dropbox token refresh failed.'));
    const token = String(payload.access_token);
    const expiresAt = Date.now() + Number(payload.expires_in || 14_400) * 1000;
    this.tokenCache = { token, expiresAt };
    await persistAccountCredentials(this.account.id, {
      ...credentials,
      accessToken: token,
      expiresAt,
    });
    return token;
  }

  private async request(url: string, init: RequestInit, force = false): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${await this.accessToken(force)}`, ...init.headers },
    });
    if (response.status === 401 && !force) return this.request(url, init, true);
    return response;
  }

  private async rpc(path: string, body: JsonObject = {}): Promise<JsonObject> {
    const response = await this.request(`https://api.dropboxapi.com/2${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as JsonObject | null;
    if (!response.ok) throw new Error(errorMessage(payload, 'Dropbox API request failed.'));
    return payload || {};
  }

  private async content(
    path: string,
    args: JsonObject,
    body?: Readable | Buffer,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    return this.request(`https://content.dropboxapi.com/2${path}`, {
      method: 'POST',
      headers: {
        'Dropbox-API-Arg': JSON.stringify(args),
        ...extraHeaders,
        ...(body
          ? {
              'Content-Type': 'application/octet-stream',
              ...(Buffer.isBuffer(body) ? { 'Content-Length': String(body.length) } : {}),
            }
          : {}),
      },
      ...(body
        ? Buffer.isBuffer(body)
          ? { body: body as unknown as BodyInit }
          : ({ body, duplex: 'half' } as RequestInit & { body: Readable; duplex: 'half' })
        : {}),
    });
  }

  private async uploadSession(input: UploadStreamInput, parent: string): Promise<JsonObject> {
    const path = dropboxPath(parent || '/', validateCloudFileName(input.fileName));
    const chunks = fixedChunks(input.stream, DROPBOX_UPLOAD_CHUNK_SIZE);
    const first = await chunks.next();
    if (first.done) throw new Error('Dropbox upload stream ended before the declared file size.');

    const startResponse = await this.content(
      '/files/upload_session/start',
      { close: false },
      first.value,
    );
    const start = (await startResponse.json().catch(() => null)) as JsonObject | null;
    if (!startResponse.ok || !start?.session_id) {
      throw new Error(errorMessage(start, 'Dropbox could not start the upload session.'));
    }

    const sessionId = String(start.session_id);
    let offset = first.value.length;
    input.onProgress?.(offset);
    let completed: JsonObject | null = null;

    for await (const chunk of chunks) {
      if (offset + chunk.length > input.size) {
        throw new Error('Dropbox upload stream exceeded the declared file size.');
      }
      const isFinal = offset + chunk.length === input.size;
      const response = await this.content(
        isFinal ? '/files/upload_session/finish' : '/files/upload_session/append_v2',
        isFinal
          ? {
              cursor: { session_id: sessionId, offset },
              commit: { path, mode: 'add', autorename: true, mute: false },
            }
          : { cursor: { session_id: sessionId, offset }, close: false },
        chunk,
      );
      const payload = (await response.json().catch(() => null)) as JsonObject | null;
      if (!response.ok) throw new Error(errorMessage(payload, 'Dropbox chunk upload failed.'));
      offset += chunk.length;
      input.onProgress?.(offset);
      if (isFinal) completed = payload || {};
    }

    if (offset !== input.size || !completed) {
      throw new Error('Dropbox upload stream ended before the declared file size.');
    }
    return completed;
  }

  private async listAll(): Promise<JsonObject[]> {
    const entries: JsonObject[] = [];
    let payload = await this.rpc('/files/list_folder', {
      path: '',
      recursive: true,
      include_deleted: false,
      include_mounted_folders: true,
      include_non_downloadable_files: true,
    });
    entries.push(...((payload.entries as JsonObject[]) || []));
    while (payload.has_more) {
      payload = await this.rpc('/files/list_folder/continue', { cursor: payload.cursor });
      entries.push(...((payload.entries as JsonObject[]) || []));
    }
    return entries;
  }

  private async ensurePath(virtualPath: string): Promise<string> {
    const parts = normalizeVirtualPath(virtualPath).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = `${current}/${part}`;
      try {
        await this.rpc('/files/get_metadata', { path: current });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('not_found')) throw error;
        await this.rpc('/files/create_folder_v2', { path: current, autorename: false });
      }
    }
    return current;
  }

  async fetchStructure(): Promise<RemoteCloudItem[]> {
    return (await this.listAll())
      .filter((entry) => entry['.tag'] === 'file' || entry['.tag'] === 'folder')
      .map((entry) => {
        const isFolder = entry['.tag'] === 'folder';
        const name = String(entry.name || 'Untitled');
        return {
          virtualPath: parentPath(String(entry.path_display || entry.path_lower || '')),
          fileName: name,
          isFolder,
          size: isFolder ? 0 : Number(entry.size || 0),
          mimeType: isFolder ? 'application/x-directory' : guessMimeType(name),
          remoteFileId: String(entry.id || entry.path_lower),
          remoteParentId: parentPath(String(entry.path_display || entry.path_lower || '')),
          remoteCreatedTime: null,
          remoteModifiedTime: isFolder ? null : String(entry.server_modified || '') || null,
        };
      });
  }

  async getStorageSummary() {
    const payload = await this.rpc('/users/get_space_usage');
    const allocation = (payload.allocation || {}) as JsonObject;
    const individual = (allocation.individual || {}) as JsonObject;
    const team = (allocation.team || {}) as JsonObject;
    return {
      totalSpace: Number(
        allocation.allocated || individual.allocated || team.allocated || this.account.totalSpace,
      ),
      usedSpace: Number(payload.used || 0),
    };
  }

  async upload(input: UploadStreamInput): Promise<UploadedCloudItem> {
    const parent = await this.ensurePath(input.virtualPath);
    let payload: JsonObject | null;
    if (input.size > DROPBOX_SIMPLE_UPLOAD_LIMIT) {
      payload = await this.uploadSession(input, parent);
    } else {
      const response = await this.content(
        '/files/upload',
        {
          path: dropboxPath(parent || '/', validateCloudFileName(input.fileName)),
          mode: 'add',
          autorename: true,
          mute: false,
        },
        input.stream.pipe(this.progressStream(input.onProgress)),
      );
      payload = (await response.json().catch(() => null)) as JsonObject | null;
      if (!response.ok) throw new Error(errorMessage(payload, 'Dropbox upload failed.'));
    }
    return {
      remoteFileId: String(payload?.id || payload?.path_lower),
      remoteParentId: parent || '/',
      size: Number(payload?.size || input.size),
      fileName: String(payload?.name || input.fileName),
      mimeType: input.mimeType,
      modifiedTime: String(payload?.server_modified || '') || null,
    };
  }

  async createFolder(virtualPath: string, name: string): Promise<UploadedCloudItem> {
    const parent = await this.ensurePath(virtualPath);
    const payload = await this.rpc('/files/create_folder_v2', {
      path: dropboxPath(parent || '/', validateCloudFileName(name)),
      autorename: true,
    });
    const metadata = (payload.metadata || {}) as JsonObject;
    return {
      remoteFileId: String(metadata.id || metadata.path_lower),
      remoteParentId: parent || '/',
      size: 0,
      fileName: String(metadata.name || name),
      mimeType: 'application/x-directory',
    };
  }

  async download(file: CloudFileRecord, options?: DownloadOptions): Promise<Readable> {
    const response = await this.content(
      '/files/download',
      { path: file.remoteFileId || dropboxPath(file.virtualPath, file.fileName) },
      undefined,
      options?.start !== undefined
        ? { Range: `bytes=${options.start}-${options.end ?? ''}` }
        : undefined,
    );
    if (!response.ok || !response.body) throw new Error('Dropbox download failed.');
    const stream = Readable.fromWeb(
      response.body as unknown as import('node:stream/web').ReadableStream,
    );
    return sliceDownloadStream(stream, options, response.status === 206);
  }

  async rename(file: CloudFileRecord, newName: string): Promise<void> {
    await this.rpc('/files/move_v2', {
      from_path: file.remoteFileId,
      to_path: dropboxPath(file.virtualPath, validateCloudFileName(newName)),
      autorename: false,
      allow_shared_folder: true,
    });
  }

  async trash(file: CloudFileRecord): Promise<void> {
    await this.deletePermanently(file);
  }

  async deletePermanently(file: CloudFileRecord): Promise<void> {
    await this.rpc('/files/delete_v2', { path: file.remoteFileId });
  }
}
