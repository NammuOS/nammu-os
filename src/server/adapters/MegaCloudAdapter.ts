import { Readable } from 'node:stream';
import { Storage, type File as MegaFile } from 'megajs';

import { normalizeVirtualPath, validateCloudFileName } from '@/server/services/googleDriveService';
import {
  BaseCloudAdapter,
  decodeAccountCredentials,
  guessMimeType,
  persistAccountCredentials,
  type CloudFileRecord,
  type RemoteCloudItem,
  type UploadedCloudItem,
  type UploadStreamInput,
} from './cloudAdapter';

type MegaNode = Omit<MegaFile, 'children' | 'parent'> & {
  children?: MegaNode[];
  parent?: MegaNode;
  delete(permanent?: boolean): Promise<void>;
  mkdir(name: string): Promise<MegaNode>;
  moveTo(target: MegaNode): Promise<void>;
  rename(name: string): Promise<void>;
  setFavorite(isFavorite?: boolean): Promise<void>;
  upload(options: { name: string; size: number }): NodeJS.WritableStream & {
    complete: Promise<MegaNode>;
  };
};

const globalMega = globalThis as unknown as {
  nammuMegaStorage?: Map<string, Promise<Storage>>;
  nammuMegaRefresh?: Map<string, Promise<Storage>>;
};
const storageCache = globalMega.nammuMegaStorage ?? new Map<string, Promise<Storage>>();
const refreshCache = globalMega.nammuMegaRefresh ?? new Map<string, Promise<Storage>>();
globalMega.nammuMegaStorage = storageCache;
globalMega.nammuMegaRefresh = refreshCache;

function hasAncestor(node: MegaNode, target: MegaNode): boolean {
  const visited = new Set<MegaNode>();
  let cursor = node.parent as MegaNode | undefined;
  while (cursor && !visited.has(cursor)) {
    if (cursor === target) return true;
    visited.add(cursor);
    cursor = cursor.parent as MegaNode | undefined;
  }
  return false;
}

function parentPath(node: MegaNode, root: MegaNode): string {
  const names: string[] = [];
  const visited = new Set<MegaNode>();
  let cursor = node.parent as MegaNode | undefined;
  while (cursor && cursor !== root && !visited.has(cursor)) {
    visited.add(cursor);
    if (cursor.name) names.unshift(cursor.name);
    cursor = cursor.parent as MegaNode | undefined;
  }
  return normalizeVirtualPath(names.length ? `/${names.join('/')}/` : '/');
}

export class MegaCloudAdapter extends BaseCloudAdapter {
  override readonly capabilities = {
    permanentDelete: true,
    restore: true,
    starred: true,
    trash: true,
  };

  private async storage(): Promise<Storage> {
    const cached = storageCache.get(this.account.id);
    if (cached) return cached;

    const credentials = decodeAccountCredentials(this.account);
    const storagePromise = (async () => {
      let storage: Storage;
      if (credentials.session) {
        try {
          storage = Storage.fromJSON(credentials.session as Parameters<typeof Storage.fromJSON>[0]);
          await storage.ready;
          await storage.reload(true);
          return storage;
        } catch (error) {
          if (!credentials.email || !credentials.password) throw error;
        }
      }

      if (!credentials.email || !credentials.password) {
        throw new Error('MEGA credentials are incomplete. Reconnect the account.');
      }
      storage = new Storage({
        email: String(credentials.email),
        password: String(credentials.password),
        secondFactorCode: credentials.secondFactorCode
          ? String(credentials.secondFactorCode)
          : undefined,
        autoload: true,
        keepalive: false,
      });
      await storage.ready;
      await persistAccountCredentials(this.account.id, {
        ...credentials,
        session: storage.toJSON(),
      });
      return storage;
    })();

    storageCache.set(this.account.id, storagePromise);
    storagePromise.catch(() => storageCache.delete(this.account.id));
    return storagePromise;
  }

  private async reload(): Promise<Storage> {
    const pending = refreshCache.get(this.account.id);
    if (pending) return pending;

    const refresh = (async () => {
      const credentials = decodeAccountCredentials(this.account);
      if (!credentials.session) {
        storageCache.delete(this.account.id);
        return this.storage();
      }

      // megajs reload() merges into its existing files map, which retains nodes
      // deleted by another session. Rehydrate from the session so every sync is
      // an authoritative snapshot of MEGA rather than an append-only cache.
      const storage = Storage.fromJSON(
        credentials.session as Parameters<typeof Storage.fromJSON>[0],
      );
      await storage.ready;
      await storage.reload(true);
      storageCache.set(this.account.id, Promise.resolve(storage));
      return storage;
    })();

    refreshCache.set(this.account.id, refresh);
    try {
      return await refresh;
    } finally {
      refreshCache.delete(this.account.id);
    }
  }

  private async node(file: CloudFileRecord): Promise<MegaNode> {
    const storage = await this.storage();
    const direct = storage.files?.[file.remoteFileId] as MegaNode | undefined;
    if (direct) return direct;

    const parent = await this.ensurePath(file.virtualPath);
    const match = parent.children?.find((child) => child.name === file.fileName);
    if (!match) throw new Error(`MEGA item not found: ${file.fileName}`);
    return match;
  }

  private async ensurePath(virtualPath: string): Promise<MegaNode> {
    const storage = await this.storage();
    const parts = normalizeVirtualPath(virtualPath).split('/').filter(Boolean);
    let current = storage.root as MegaNode;
    for (const part of parts) {
      let next = current.children?.find((child) => child.directory && child.name === part);
      if (!next) next = await current.mkdir(part);
      current = next;
    }
    return current;
  }

  async fetchStructure(): Promise<RemoteCloudItem[]> {
    const storage = await this.reload();
    const root = storage.root as MegaNode;
    const trash = storage.trash as MegaNode;
    const inbox = storage.inbox as MegaNode;
    return (Object.values(storage.files || {}) as MegaNode[])
      .filter(
        (node) =>
          node &&
          node !== root &&
          node !== trash &&
          node !== inbox &&
          Boolean(node.name) &&
          !hasAncestor(node, trash) &&
          !hasAncestor(node, inbox),
      )
      .map((node) => ({
        virtualPath: parentPath(node, root),
        fileName: node.name || 'Untitled',
        isFolder: Boolean(node.directory),
        isStarred: Boolean(node.favorited),
        size: node.directory ? 0 : Number(node.size || 0),
        mimeType: node.directory ? null : guessMimeType(node.name || ''),
        remoteFileId: node.nodeId || node.downloadId,
        remoteParentId: (node.parent as MegaNode | undefined)?.nodeId || null,
        remoteCreatedTime: node.timestamp ? new Date(node.timestamp * 1000).toISOString() : null,
        remoteModifiedTime: node.timestamp ? new Date(node.timestamp * 1000).toISOString() : null,
      }));
  }

  async getStorageSummary() {
    const info = await (await this.storage()).getAccountInfo();
    return {
      totalSpace: Number(info.spaceTotal || this.account.totalSpace || 0),
      usedSpace: Number(info.spaceUsed || this.account.usedSpace || 0),
    };
  }

  async upload(input: UploadStreamInput): Promise<UploadedCloudItem> {
    const parent = await this.ensurePath(input.virtualPath);
    const progress = this.progressStream(input.onProgress);
    const upload = parent.upload({
      name: validateCloudFileName(input.fileName),
      size: input.size,
    });
    input.stream.pipe(progress).pipe(upload);
    const file = await upload.complete;
    return {
      remoteFileId: file.nodeId || file.downloadId,
      remoteParentId: parent.nodeId || null,
      size: Number(file.size || input.size),
      fileName: file.name || input.fileName,
      mimeType: input.mimeType,
      createdTime: file.timestamp ? new Date(file.timestamp * 1000).toISOString() : null,
      modifiedTime: file.timestamp ? new Date(file.timestamp * 1000).toISOString() : null,
    };
  }

  async createFolder(virtualPath: string, name: string): Promise<UploadedCloudItem> {
    const parent = await this.ensurePath(virtualPath);
    const folder = await parent.mkdir(validateCloudFileName(name));
    return {
      remoteFileId: folder.nodeId || folder.downloadId,
      remoteParentId: parent.nodeId || null,
      size: 0,
      fileName: folder.name || name,
      mimeType: 'application/x-directory',
      createdTime: folder.timestamp ? new Date(folder.timestamp * 1000).toISOString() : null,
      modifiedTime: folder.timestamp ? new Date(folder.timestamp * 1000).toISOString() : null,
    };
  }

  async download(file: CloudFileRecord): Promise<Readable> {
    const node = await this.node(file);
    if (node.directory) throw new Error('Folders cannot be downloaded directly from MEGA.');
    return node.download({});
  }

  async rename(file: CloudFileRecord, newName: string): Promise<void> {
    await (await this.node(file)).rename(validateCloudFileName(newName));
  }

  async setStarred(file: CloudFileRecord, starred: boolean): Promise<void> {
    await (await this.node(file)).setFavorite(starred);
  }

  async trash(file: CloudFileRecord): Promise<void> {
    await (await this.node(file)).delete(false);
  }

  async restore(file: CloudFileRecord): Promise<void> {
    const storage = await this.reload();
    const node = storage.files?.[file.remoteFileId] as MegaNode | undefined;
    if (!node) throw new Error(`MEGA trash item not found: ${file.fileName}`);
    const parent =
      (file.remoteParentId
        ? (storage.files?.[file.remoteParentId] as MegaNode | undefined)
        : null) || (storage.root as MegaNode);
    await node.moveTo(parent);
  }

  async deletePermanently(file: CloudFileRecord): Promise<void> {
    try {
      await (await this.node(file)).delete(true);
    } catch (error) {
      // Deletion is idempotent: if the item was removed directly in MEGA, the
      // stale local index entry can still be cleared safely.
      if (error instanceof Error && error.message.startsWith('MEGA item not found:')) return;
      throw error;
    }
  }
}
