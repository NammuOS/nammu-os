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

function encoded(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

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

export class OneDriveCloudAdapter extends BaseCloudAdapter {
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
      throw new Error('OneDrive credentials are incomplete. Reconnect the account.');
    }
    const tenantId = String(credentials.tenantId || 'common');
    const response = await fetch(
      `https://login.microsoftonline.com/${encoded(tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: String(credentials.clientId),
          client_secret: String(credentials.clientSecret),
          refresh_token: String(credentials.refreshToken),
          redirect_uri: String(credentials.redirectUri || ''),
          grant_type: 'refresh_token',
          scope: 'offline_access openid profile email Files.ReadWrite.All User.Read',
        }),
      },
    );
    const payload = (await response.json()) as JsonObject;
    if (!response.ok) {
      throw new Error(
        String(payload.error_description || payload.error || 'OneDrive refresh failed.'),
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

  private async request(url: string, init: RequestInit = {}, force = false): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${await this.accessToken(force)}`, ...init.headers },
    });
    if (response.status === 401 && !force) return this.request(url, init, true);
    return response;
  }

  private async graph(pathOrUrl: string, init: RequestInit = {}): Promise<JsonObject> {
    const url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
    const response = await this.request(url, init);
    const payload = (await response.json().catch(() => null)) as JsonObject | null;
    if (!response.ok) {
      const error = (payload?.error || {}) as JsonObject;
      throw new Error(String(error.message || 'OneDrive API request failed.'));
    }
    return payload || {};
  }

  private async children(folderId = 'root'): Promise<JsonObject[]> {
    const items: JsonObject[] = [];
    let nextUrl =
      folderId === 'root'
        ? 'https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id,name,size,file,folder,parentReference,createdDateTime,lastModifiedDateTime'
        : `https://graph.microsoft.com/v1.0/me/drive/items/${encoded(folderId)}/children?$select=id,name,size,file,folder,parentReference,createdDateTime,lastModifiedDateTime`;
    while (nextUrl) {
      const payload = await this.graph(nextUrl);
      items.push(...((payload.value as JsonObject[]) || []));
      nextUrl = String(payload['@odata.nextLink'] || '');
    }
    return items;
  }

  private async ensurePath(virtualPath: string): Promise<string> {
    const parts = normalizeVirtualPath(virtualPath).split('/').filter(Boolean);
    let parentId = 'root';
    for (const part of parts) {
      const existing = (await this.children(parentId)).find(
        (item) => item.folder && item.name === part,
      );
      if (existing) {
        parentId = String(existing.id);
        continue;
      }
      const payload = await this.graph(
        parentId === 'root'
          ? '/me/drive/root/children'
          : `/me/drive/items/${encoded(parentId)}/children`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: part,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'rename',
          }),
        },
      );
      parentId = String(payload.id);
    }
    return parentId;
  }

  async fetchStructure(): Promise<RemoteCloudItem[]> {
    const records: RemoteCloudItem[] = [];
    const walk = async (folderId: string, virtualPath: string) => {
      for (const item of await this.children(folderId)) {
        const isFolder = Boolean(item.folder);
        const file = (item.file || {}) as JsonObject;
        const parent = (item.parentReference || {}) as JsonObject;
        const name = String(item.name || 'Untitled');
        records.push({
          virtualPath: normalizeVirtualPath(virtualPath),
          fileName: name,
          isFolder,
          size: Number(item.size || 0),
          mimeType: isFolder
            ? 'application/x-directory'
            : String(file.mimeType || 'application/octet-stream'),
          remoteFileId: String(item.id),
          remoteParentId: String(parent.id || folderId),
          remoteCreatedTime: String(item.createdDateTime || '') || null,
          remoteModifiedTime: String(item.lastModifiedDateTime || '') || null,
        });
        if (isFolder) await walk(String(item.id), `${normalizeVirtualPath(virtualPath)}${name}/`);
      }
    };
    await walk('root', '/');
    return records;
  }

  async getStorageSummary() {
    const payload = await this.graph('/me/drive?$select=quota');
    const quota = (payload.quota || {}) as JsonObject;
    return {
      totalSpace: Number(quota.total || this.account.totalSpace || 0),
      usedSpace: Number(quota.used || this.account.usedSpace || 0),
    };
  }

  private async simpleUpload(input: UploadStreamInput, parentId: string): Promise<JsonObject> {
    const url = `https://graph.microsoft.com/v1.0/me/drive/items/${encoded(parentId)}:/${encoded(validateCloudFileName(input.fileName))}:/content`;
    const response = await this.request(url, {
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType, 'Content-Length': String(input.size) },
      body: input.stream.pipe(this.progressStream(input.onProgress)),
      duplex: 'half',
    } as unknown as RequestInit & { duplex: 'half' });
    const payload = (await response.json().catch(() => null)) as JsonObject | null;
    if (!response.ok) throw new Error('OneDrive upload failed.');
    return payload || {};
  }

  private async sessionUpload(input: UploadStreamInput, parentId: string): Promise<JsonObject> {
    const session = await this.graph(
      `/me/drive/items/${encoded(parentId)}:/${encoded(validateCloudFileName(input.fileName))}:/createUploadSession`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
      },
    );
    const uploadUrl = String(session.uploadUrl || '');
    if (!uploadUrl) throw new Error('OneDrive did not create an upload session.');
    let offset = 0;
    let result: JsonObject = {};
    for await (const chunk of fixedChunks(input.stream, 10 * 1024 * 1024)) {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${offset}-${offset + chunk.length - 1}/${input.size}`,
        },
        body: chunk as unknown as BodyInit,
      });
      result = (await response.json().catch(() => null)) as JsonObject;
      if (!response.ok && response.status !== 202) throw new Error('OneDrive chunk upload failed.');
      offset += chunk.length;
      input.onProgress?.(offset);
    }
    if (offset !== input.size || !result.id) {
      throw new Error('OneDrive upload session ended before the complete file was committed.');
    }
    return result;
  }

  async upload(input: UploadStreamInput): Promise<UploadedCloudItem> {
    const parentId = await this.ensurePath(input.virtualPath);
    const payload =
      input.size <= 250_000_000
        ? await this.simpleUpload(input, parentId)
        : await this.sessionUpload(input, parentId);
    const file = (payload.file || {}) as JsonObject;
    const parent = (payload.parentReference || {}) as JsonObject;
    return {
      remoteFileId: String(payload.id),
      remoteParentId: String(parent.id || parentId),
      size: Number(payload.size || input.size),
      fileName: String(payload.name || input.fileName),
      mimeType: String(file.mimeType || input.mimeType),
      createdTime: String(payload.createdDateTime || '') || null,
      modifiedTime: String(payload.lastModifiedDateTime || '') || null,
    };
  }

  async createFolder(virtualPath: string, name: string): Promise<UploadedCloudItem> {
    const parentId = await this.ensurePath(virtualPath);
    const payload = await this.graph(
      parentId === 'root'
        ? '/me/drive/root/children'
        : `/me/drive/items/${encoded(parentId)}/children`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: validateCloudFileName(name),
          folder: {},
          '@microsoft.graph.conflictBehavior': 'rename',
        }),
      },
    );
    const parent = (payload.parentReference || {}) as JsonObject;
    return {
      remoteFileId: String(payload.id),
      remoteParentId: String(parent.id || parentId),
      size: 0,
      fileName: String(payload.name || name),
      mimeType: 'application/x-directory',
      createdTime: String(payload.createdDateTime || '') || null,
      modifiedTime: String(payload.lastModifiedDateTime || '') || null,
    };
  }

  async download(file: CloudFileRecord): Promise<Readable> {
    const response = await this.request(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encoded(file.remoteFileId)}/content`,
    );
    if (!response.ok || !response.body) throw new Error('OneDrive download failed.');
    return Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream);
  }

  async rename(file: CloudFileRecord, newName: string): Promise<void> {
    await this.graph(`/me/drive/items/${encoded(file.remoteFileId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: validateCloudFileName(newName) }),
    });
  }

  async trash(file: CloudFileRecord): Promise<void> {
    await this.deletePermanently(file);
  }

  async deletePermanently(file: CloudFileRecord): Promise<void> {
    const response = await this.request(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encoded(file.remoteFileId)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) throw new Error('OneDrive delete failed.');
  }
}
