import { Readable } from 'node:stream';

import { normalizeVirtualPath, validateCloudFileName } from '@/server/services/googleDriveService';
import {
  BaseCloudAdapter,
  decodeAccountCredentials,
  persistAccountCredentials,
  type CloudFileRecord,
  type RemoteCloudItem,
  type UploadedCloudItem,
  type UploadStreamInput,
} from './cloudAdapter';

type JsonObject = Record<string, unknown>;
const API_BASE = 'https://cloud-api.yandex.net/v1/disk';

function resourceParent(path: string): string {
  const clean = path.replace(/^disk:/, '').replace(/\/+$/, '');
  const slash = clean.lastIndexOf('/');
  return slash <= 0 ? '/' : normalizeVirtualPath(clean.slice(0, slash + 1));
}

function joined(parent: string, name: string): string {
  const base =
    normalizeVirtualPath(parent) === '/' ? '' : normalizeVirtualPath(parent).replace(/\/+$/, '');
  return `${base}/${name}`;
}

export class YandexCloudAdapter extends BaseCloudAdapter {
  override readonly capabilities = {
    permanentDelete: true,
    restore: false,
    starred: false,
    trash: false,
  };

  private tokenCache: { token: string; expiresAt: number } | null = null;

  private async accessToken(force = false): Promise<string> {
    const credentials = decodeAccountCredentials(this.account);
    if (!force && this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.token;
    }
    if (
      !force &&
      credentials.accessToken &&
      Number(credentials.expiresAt || 0) > Date.now() + 30_000
    ) {
      return String(credentials.accessToken);
    }
    if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
      if (credentials.accessToken) return String(credentials.accessToken);
      throw new Error('Yandex credentials are incomplete. Reconnect the account.');
    }
    const response = await fetch('https://oauth.yandex.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: String(credentials.refreshToken),
        client_id: String(credentials.clientId),
        client_secret: String(credentials.clientSecret),
      }),
    });
    const payload = (await response.json().catch(() => null)) as JsonObject | null;
    if (!response.ok || !payload?.access_token) {
      throw new Error(
        String(payload?.error_description || payload?.error || 'Yandex refresh failed.'),
      );
    }
    const token = String(payload.access_token);
    const expiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
    this.tokenCache = { token, expiresAt };
    await persistAccountCredentials(this.account.id, {
      ...credentials,
      accessToken: token,
      expiresAt,
      refreshToken: payload.refresh_token || credentials.refreshToken,
    });
    return token;
  }

  private async request(
    path: string,
    options: {
      method?: string;
      query?: Record<string, string | number | boolean>;
      raw?: boolean;
    } = {},
    force = false,
  ): Promise<JsonObject | Response> {
    const url = new URL(`${API_BASE}${path}`);
    Object.entries(options.query || {}).forEach(([key, value]) =>
      url.searchParams.set(key, String(value)),
    );
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: { Authorization: `OAuth ${await this.accessToken(force)}` },
    });
    if (response.status === 401 && !force) return this.request(path, options, true);
    if (options.raw) return response;
    if (response.status === 204) return {};
    const payload = (await response.json().catch(() => null)) as JsonObject | null;
    if (!response.ok) {
      const error = new Error(
        String(payload?.message || payload?.description || 'Yandex API failed.'),
      );
      Object.assign(error, { status: response.status });
      throw error;
    }
    return payload || {};
  }

  private async ensurePath(virtualPath: string): Promise<void> {
    let current = '';
    for (const part of normalizeVirtualPath(virtualPath).split('/').filter(Boolean)) {
      current += `/${part}`;
      try {
        await this.request('/resources', { method: 'PUT', query: { path: current } });
      } catch (error) {
        if ((error as { status?: number }).status !== 409) throw error;
      }
    }
  }

  async fetchStructure(): Promise<RemoteCloudItem[]> {
    const records: RemoteCloudItem[] = [];
    const queue = ['/'];
    while (queue.length) {
      const current = queue.shift()!;
      let offset = 0;
      const limit = 200;
      while (true) {
        const payload = (await this.request('/resources', {
          query: { path: current, limit, offset, sort: 'name' },
        })) as JsonObject;
        const embedded = (payload._embedded || {}) as JsonObject;
        const items = (embedded.items || []) as JsonObject[];
        for (const item of items) {
          const isFolder = item.type === 'dir';
          const remotePath = String(item.path || '');
          records.push({
            virtualPath: resourceParent(remotePath),
            fileName: String(item.name || 'Untitled'),
            isFolder,
            size: isFolder ? 0 : Number(item.size || 0),
            mimeType: isFolder
              ? 'application/x-directory'
              : String(item.mime_type || 'application/octet-stream'),
            remoteFileId: remotePath.replace(/^disk:/, ''),
            remoteParentId: resourceParent(remotePath),
            remoteCreatedTime: String(item.created || '') || null,
            remoteModifiedTime: String(item.modified || '') || null,
          });
          if (isFolder) queue.push(remotePath.replace(/^disk:/, ''));
        }
        if (items.length < limit) break;
        offset += limit;
      }
    }
    return records;
  }

  async getStorageSummary() {
    const payload = (await this.request('/')) as JsonObject;
    return {
      totalSpace: Number(payload.total_space || this.account.totalSpace || 0),
      usedSpace: Number(payload.used_space || this.account.usedSpace || 0),
    };
  }

  async upload(input: UploadStreamInput): Promise<UploadedCloudItem> {
    await this.ensurePath(input.virtualPath);
    const path = joined(input.virtualPath, validateCloudFileName(input.fileName));
    const info = (await this.request('/resources/upload', {
      query: { path, overwrite: true },
    })) as JsonObject;
    const href = String(info.href || '');
    if (!href) throw new Error('Yandex did not return an upload URL.');
    const response = await fetch(href, {
      method: String(info.method || 'PUT'),
      headers: { 'Content-Type': input.mimeType, 'Content-Length': String(input.size) },
      body: input.stream.pipe(this.progressStream(input.onProgress)),
      duplex: 'half',
    } as unknown as RequestInit & { duplex: 'half' });
    if (!response.ok) throw new Error('Yandex upload failed.');
    return {
      remoteFileId: path,
      remoteParentId: normalizeVirtualPath(input.virtualPath),
      size: input.size,
      fileName: input.fileName,
      mimeType: input.mimeType,
      modifiedTime: new Date().toISOString(),
    };
  }

  async createFolder(virtualPath: string, name: string): Promise<UploadedCloudItem> {
    await this.ensurePath(virtualPath);
    const path = joined(virtualPath, validateCloudFileName(name));
    try {
      await this.request('/resources', { method: 'PUT', query: { path } });
    } catch (error) {
      if ((error as { status?: number }).status !== 409) throw error;
    }
    return {
      remoteFileId: path,
      remoteParentId: normalizeVirtualPath(virtualPath),
      size: 0,
      fileName: name,
      mimeType: 'application/x-directory',
      modifiedTime: new Date().toISOString(),
    };
  }

  async download(file: CloudFileRecord): Promise<Readable> {
    const info = (await this.request('/resources/download', {
      query: { path: file.remoteFileId },
    })) as JsonObject;
    const response = await fetch(String(info.href || ''));
    if (!response.ok || !response.body) throw new Error('Yandex download failed.');
    return Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream);
  }

  async rename(file: CloudFileRecord, newName: string): Promise<void> {
    await this.request('/resources/move', {
      method: 'POST',
      query: {
        from: file.remoteFileId,
        path: joined(file.virtualPath, validateCloudFileName(newName)),
        overwrite: false,
      },
    });
  }

  async trash(file: CloudFileRecord): Promise<void> {
    await this.request('/resources', {
      method: 'DELETE',
      query: { path: file.remoteFileId, permanently: false },
    });
  }

  async deletePermanently(file: CloudFileRecord): Promise<void> {
    await this.request('/resources', {
      method: 'DELETE',
      query: { path: file.remoteFileId, permanently: true },
    });
  }
}
