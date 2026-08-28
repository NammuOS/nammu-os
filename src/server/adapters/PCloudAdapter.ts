import crypto from 'node:crypto';
import { Readable } from 'node:stream';

import { normalizeVirtualPath, validateCloudFileName } from '@/server/services/googleDriveService';
import {
  BaseCloudAdapter,
  decodeAccountCredentials,
  persistAccountCredentials,
  toIsoDate,
  type CloudFileRecord,
  type RemoteCloudItem,
  type UploadedCloudItem,
  type UploadStreamInput,
} from './cloudAdapter';

type JsonObject = Record<string, unknown>;
const PCLOUD_HOSTS = ['api.pcloud.com', 'eapi.pcloud.com'];

function sha1(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

async function pcloudGet(
  host: string,
  method: string,
  params: JsonObject = {},
): Promise<JsonObject> {
  const url = new URL(`https://${host}/${method}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  const response = await fetch(url);
  const payload = (await response.json().catch(() => null)) as JsonObject | null;
  if (!payload) throw new Error('pCloud returned an invalid response.');
  if (Number(payload.result) !== 0) {
    const error = new Error(String(payload.error || `pCloud error ${payload.result}`));
    Object.assign(error, { result: Number(payload.result) });
    throw error;
  }
  return payload;
}

async function login(username: string, password: string) {
  let lastError: unknown;
  for (const host of PCLOUD_HOSTS) {
    try {
      const digestPayload = await pcloudGet(host, 'getdigest');
      const digest = String(digestPayload.digest);
      const passwordDigest = sha1(`${password}${sha1(username.toLowerCase())}${digest}`);
      const payload = await pcloudGet(host, 'login', {
        getauth: 1,
        logout: 0,
        username,
        digest,
        passworddigest: passwordDigest,
      });
      if (!payload.auth) throw new Error('pCloud login did not return an auth token.');
      return { host, auth: String(payload.auth), payload };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Unable to log in to pCloud.');
}

function idParams(file: CloudFileRecord): JsonObject {
  if (file.remoteFileId.startsWith('f')) return { fileid: file.remoteFileId.slice(1) };
  if (file.remoteFileId.startsWith('d')) return { folderid: file.remoteFileId.slice(1) };
  return { path: `${normalizeVirtualPath(file.virtualPath).replace(/\/+$/, '')}/${file.fileName}` };
}

export class PCloudAdapter extends BaseCloudAdapter {
  override readonly capabilities = {
    permanentDelete: true,
    restore: false,
    starred: false,
    trash: false,
  };

  private sessionValue: { host: string; auth: string } | null = null;

  private async session(force = false) {
    if (this.sessionValue && !force) return this.sessionValue;
    const credentials = decodeAccountCredentials(this.account);
    if (credentials.auth && credentials.host && !force) {
      this.sessionValue = { host: String(credentials.host), auth: String(credentials.auth) };
      return this.sessionValue;
    }
    const username = String(credentials.username || credentials.email || '');
    const password = String(credentials.password || '');
    if (!username || !password) throw new Error('pCloud credentials are incomplete.');
    const result = await login(username, password);
    this.sessionValue = { host: result.host, auth: result.auth };
    await persistAccountCredentials(this.account.id, {
      ...credentials,
      username,
      host: result.host,
      auth: result.auth,
    });
    return this.sessionValue;
  }

  private async call(method: string, params: JsonObject = {}): Promise<JsonObject> {
    const current = await this.session();
    try {
      return await pcloudGet(current.host, method, { ...params, auth: current.auth });
    } catch (error) {
      if (![1000, 2000, 2094].includes((error as { result?: number }).result || -1)) throw error;
      const fresh = await this.session(true);
      return pcloudGet(fresh.host, method, { ...params, auth: fresh.auth });
    }
  }

  async fetchStructure(): Promise<RemoteCloudItem[]> {
    const records: RemoteCloudItem[] = [];
    const queue: Array<{ folderId: number; path: string }> = [{ folderId: 0, path: '/' }];
    while (queue.length) {
      const current = queue.shift()!;
      const payload = await this.call('listfolder', { folderid: current.folderId });
      const metadata = (payload.metadata || {}) as JsonObject;
      for (const item of (metadata.contents || []) as JsonObject[]) {
        const isFolder = Boolean(item.isfolder);
        const name = String(item.name || 'Untitled');
        records.push({
          virtualPath: normalizeVirtualPath(current.path),
          fileName: name,
          isFolder,
          size: isFolder ? 0 : Number(item.size || 0),
          mimeType: isFolder
            ? 'application/x-directory'
            : String(item.contenttype || 'application/octet-stream'),
          remoteFileId: isFolder ? `d${item.folderid}` : `f${item.fileid}`,
          remoteParentId: `d${current.folderId}`,
          remoteCreatedTime: toIsoDate(item.created as string | number),
          remoteModifiedTime: toIsoDate(item.modified as string | number),
        });
        if (isFolder) {
          queue.push({
            folderId: Number(item.folderid),
            path: `${normalizeVirtualPath(current.path)}${name}/`,
          });
        }
      }
    }
    return records;
  }

  async getStorageSummary() {
    const payload = await this.call('userinfo');
    return {
      totalSpace: Number(payload.quota || this.account.totalSpace || 0),
      usedSpace: Number(payload.usedquota || this.account.usedSpace || 0),
    };
  }

  private async ensurePath(virtualPath: string): Promise<number> {
    const path = normalizeVirtualPath(virtualPath);
    if (path === '/') return 0;
    const payload = await this.call('createfolderifnotexists', { path: path.replace(/\/+$/, '') });
    const metadata = (payload.metadata || {}) as JsonObject;
    return Number(metadata.folderid || 0);
  }

  async upload(input: UploadStreamInput): Promise<UploadedCloudItem> {
    const { host, auth } = await this.session();
    await this.ensurePath(input.virtualPath);
    const boundary = `----nammu-${crypto.randomUUID()}`;
    const fields = [
      ['auth', auth],
      ['path', normalizeVirtualPath(input.virtualPath).replace(/\/+$/, '') || '/'],
      ['filename', validateCloudFileName(input.fileName)],
      ['nopartial', '1'],
    ];
    const fieldHeader = fields
      .map(
        ([name, value]) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      )
      .join('');
    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${input.fileName.replace(/"/g, '_')}"\r\nContent-Type: ${input.mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const prefix = Buffer.from(fieldHeader + fileHeader);
    const suffix = Buffer.from(footer);
    const progress = this.progressStream(input.onProgress);
    const body = Readable.from(
      (async function* () {
        yield prefix;
        for await (const chunk of input.stream.pipe(progress)) yield chunk;
        yield suffix;
      })(),
    );
    const response = await fetch(`https://${host}/uploadfile`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(prefix.length + input.size + suffix.length),
      },
      body,
      duplex: 'half',
    } as unknown as RequestInit & { duplex: 'half' });
    const payload = (await response.json().catch(() => null)) as JsonObject | null;
    if (!payload || Number(payload.result) !== 0) {
      throw new Error(String(payload?.error || 'pCloud upload failed.'));
    }
    const meta = (((payload.metadata || []) as JsonObject[])[0] || {}) as JsonObject;
    return {
      remoteFileId: `f${meta.fileid}`,
      remoteParentId: normalizeVirtualPath(input.virtualPath),
      size: Number(meta.size || input.size),
      fileName: String(meta.name || input.fileName),
      mimeType: input.mimeType,
      createdTime: toIsoDate(meta.created as string | number),
      modifiedTime: toIsoDate(meta.modified as string | number),
    };
  }

  async createFolder(virtualPath: string, name: string): Promise<UploadedCloudItem> {
    const path = `${normalizeVirtualPath(virtualPath).replace(/\/+$/, '')}/${validateCloudFileName(name)}`;
    const payload = await this.call('createfolderifnotexists', { path });
    const metadata = (payload.metadata || {}) as JsonObject;
    return {
      remoteFileId: `d${metadata.folderid}`,
      remoteParentId: normalizeVirtualPath(virtualPath),
      size: 0,
      fileName: String(metadata.name || name),
      mimeType: 'application/x-directory',
      createdTime: toIsoDate(metadata.created as string | number),
      modifiedTime: toIsoDate(metadata.modified as string | number),
    };
  }

  async download(file: CloudFileRecord): Promise<Readable> {
    const payload = await this.call('getfilelink', idParams(file));
    const host = String(((payload.hosts || []) as string[])[0] || '');
    const path = String(payload.path || '');
    if (!host || !path) throw new Error('pCloud did not return a download location.');
    const response = await fetch(`https://${host}${path}`);
    if (!response.ok || !response.body) throw new Error('pCloud download failed.');
    return Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream);
  }

  async rename(file: CloudFileRecord, newName: string): Promise<void> {
    await this.call(file.isFolder ? 'renamefolder' : 'renamefile', {
      ...idParams(file),
      toname: validateCloudFileName(newName),
    });
  }

  async trash(file: CloudFileRecord): Promise<void> {
    await this.deletePermanently(file);
  }

  async deletePermanently(file: CloudFileRecord): Promise<void> {
    await this.call(file.isFolder ? 'deletefolderrecursive' : 'deletefile', idParams(file));
  }
}
