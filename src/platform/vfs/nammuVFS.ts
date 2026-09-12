/**
 * Nammu Virtual Filesystem (VFS) Core Implementation
 *
 * Provides partitioned virtual filesystem paths, versioned application
 * directories, atomic active-version pointers, and optional IndexedDB persistence.
 */

import type {
  AppActiveVersionPointer,
  NammuVFS,
  ScopedVFS,
  VFSFileStat,
  VFSNamespace,
  VFSSnapshot,
  VFSWriteOptions,
} from './vfsContracts';

function normalizePath(rawPath: string): string {
  const parts = rawPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }
  return '/' + stack.join('/');
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class InMemoryNammuVFS implements NammuVFS {
  protected files = new Map<string, { bytes: Uint8Array; createdAt: number; updatedAt: number }>();

  protected async ensureReady(): Promise<void> {}

  async readFile(path: string): Promise<Uint8Array> {
    await this.ensureReady();
    const normalized = normalizePath(path);
    const entry = this.files.get(normalized);
    if (!entry) {
      throw new Error(`[VFS] File not found: ${normalized}`);
    }
    return new Uint8Array(entry.bytes);
  }

  async readText(path: string): Promise<string> {
    const bytes = await this.readFile(path);
    return new TextDecoder().decode(bytes);
  }

  async writeFile(
    path: string,
    content: Uint8Array | string,
    options: VFSWriteOptions = {},
  ): Promise<void> {
    await this.ensureReady();
    const normalized = normalizePath(path);
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const now = Date.now();

    if (options.atomic) {
      // Atomic write staging
      const tempPath = `${normalized}.staging.${Math.random().toString(36).slice(2)}`;
      this.files.set(tempPath, {
        bytes: new Uint8Array(bytes),
        createdAt: now,
        updatedAt: now,
      });
      // Swap
      const staged = this.files.get(tempPath)!;
      this.files.delete(tempPath);
      const existing = this.files.get(normalized);
      this.files.set(normalized, {
        bytes: staged.bytes,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    } else {
      const existing = this.files.get(normalized);
      this.files.set(normalized, {
        bytes: new Uint8Array(bytes),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }
  }

  async deleteFile(path: string): Promise<void> {
    await this.ensureReady();
    const normalized = normalizePath(path);
    this.files.delete(normalized);
  }

  async deleteDirectory(path: string, _recursive: boolean = true): Promise<void> {
    await this.ensureReady();
    const normalized = normalizePath(path);
    const prefix =
      normalized === '/' ? '/' : normalized.endsWith('/') ? normalized : `${normalized}/`;

    const toDelete: string[] = [];
    for (const key of this.files.keys()) {
      if (key === normalized || key.startsWith(prefix)) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.files.delete(key);
    }
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureReady();
    const normalized = normalizePath(path);
    if (this.files.has(normalized)) return true;

    // Check if directory exists
    const prefix =
      normalized === '/' ? '/' : normalized.endsWith('/') ? normalized : `${normalized}/`;
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  async stat(path: string): Promise<VFSFileStat | null> {
    await this.ensureReady();
    const normalized = normalizePath(path);
    const entry = this.files.get(normalized);
    if (entry) {
      return {
        path: normalized,
        size: entry.bytes.length,
        isDirectory: false,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
    }

    const prefix =
      normalized === '/' ? '/' : normalized.endsWith('/') ? normalized : `${normalized}/`;
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        return {
          path: normalized,
          size: 0,
          isDirectory: true,
          createdAt: 0,
          updatedAt: 0,
        };
      }
    }
    return null;
  }

  async list(path: string): Promise<string[]> {
    await this.ensureReady();
    const normalized = normalizePath(path);
    const prefix =
      normalized === '/' ? '/' : normalized.endsWith('/') ? normalized : `${normalized}/`;
    const results = new Set<string>();

    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const remainder = key.slice(prefix.length);
        const [segment] = remainder.split('/');
        if (segment) results.add(segment);
      }
    }
    return Array.from(results).sort();
  }

  async createSnapshot(
    appId: string,
    namespace: VFSNamespace,
    schemaVersion: number,
  ): Promise<VFSSnapshot> {
    await this.ensureReady();
    const prefix = `/${namespace}/${appId}/`;
    const snapshotFiles: Record<string, Uint8Array> = {};

    for (const [key, value] of this.files.entries()) {
      if (key.startsWith(prefix)) {
        const subpath = key.slice(prefix.length);
        snapshotFiles[subpath] = new Uint8Array(value.bytes);
      }
    }

    return {
      appId,
      schemaVersion,
      timestamp: Date.now(),
      files: snapshotFiles,
    };
  }

  async restoreSnapshot(snapshot: VFSSnapshot, namespace: VFSNamespace): Promise<void> {
    const prefix = `/${namespace}/${snapshot.appId}/`;
    await this.deleteDirectory(prefix);

    for (const [subpath, bytes] of Object.entries(snapshot.files)) {
      await this.writeFile(`${prefix}${subpath}`, bytes, { atomic: true });
    }
  }

  async getAppStorageUsage(appId: string): Promise<{
    applications: number;
    userdata: number;
    cache: number;
  }> {
    await this.ensureReady();
    let applications = 0;
    let userdata = 0;
    let cache = 0;

    const appPrefix = `/applications/${appId}/`;
    const userPrefix = `/userdata/${appId}/`;
    const cachePrefix = `/cache/${appId}/`;

    for (const [key, value] of this.files.entries()) {
      if (key.startsWith(appPrefix)) applications += value.bytes.length;
      else if (key.startsWith(userPrefix)) userdata += value.bytes.length;
      else if (key.startsWith(cachePrefix)) cache += value.bytes.length;
    }

    return { applications, userdata, cache };
  }

  async getActiveAppVersion(appId: string): Promise<AppActiveVersionPointer | null> {
    const pointerPath = `/applications/${appId}/active.json`;
    if (!(await this.exists(pointerPath))) return null;
    try {
      const text = await this.readText(pointerPath);
      return JSON.parse(text) as AppActiveVersionPointer;
    } catch {
      return null;
    }
  }

  async setActiveAppVersion(pointer: AppActiveVersionPointer): Promise<void> {
    const pointerPath = `/applications/${pointer.appId}/active.json`;
    await this.writeFile(pointerPath, JSON.stringify(pointer, null, 2), { atomic: true });
  }

  createScopedVFS(appId: string): ScopedVFS {
    const userPrefix = `/userdata/${appId}`;
    const cachePrefix = `/cache/${appId}`;

    const resolveSubpath = (base: string, subpath: string) => {
      const clean = subpath.replace(/\\/g, '/').replace(/^\/+/, '');
      if (clean.includes('..')) {
        throw new Error(`[VFS Security] Relative directory traversal prohibited: ${subpath}`);
      }
      return base ? `${base}/${clean}` : clean;
    };

    const resolveActiveAppPath = async (subpath: string): Promise<string> => {
      const clean = resolveSubpath('', subpath);
      const pointer = await this.getActiveAppVersion(appId);
      if (pointer) {
        return `${pointer.activeVersionDir}/${clean}`;
      }
      return `/applications/${appId}/${clean}`;
    };

    return {
      appId,
      getActiveVersion: async () => {
        const pointer = await this.getActiveAppVersion(appId);
        return pointer?.activeVersion ?? null;
      },
      readAppFile: async (subpath) => {
        const fullPath = await resolveActiveAppPath(subpath);
        return this.readFile(fullPath);
      },
      readAppText: async (subpath) => {
        const fullPath = await resolveActiveAppPath(subpath);
        return this.readText(fullPath);
      },
      readUserData: async (subpath) => this.readFile(resolveSubpath(userPrefix, subpath)),
      readUserDataText: async (subpath) => this.readText(resolveSubpath(userPrefix, subpath)),
      writeUserData: async (subpath, content) =>
        this.writeFile(resolveSubpath(userPrefix, subpath), content, { atomic: true }),
      deleteUserData: async (subpath) => this.deleteFile(resolveSubpath(userPrefix, subpath)),
      readCache: async (subpath) => this.readFile(resolveSubpath(cachePrefix, subpath)),
      writeCache: async (subpath, content) =>
        this.writeFile(resolveSubpath(cachePrefix, subpath), content),
      clearCache: async () => this.deleteDirectory(cachePrefix),
      listUserData: async (subpath = '') => this.list(resolveSubpath(userPrefix, subpath)),
    };
  }
}

/**
 * Persistent VFS backed by browser IndexedDB
 */
export class IndexedDBNammuVFS extends InMemoryNammuVFS {
  private readonly dbPromise: Promise<IDBDatabase>;
  private readonly readyPromise: Promise<void>;

  constructor() {
    super();
    this.dbPromise = this.openDatabase();
    this.readyPromise = this.hydrateFromIDB();
  }

  protected override ensureReady(): Promise<void> {
    return this.readyPromise;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('nammu_os_vfs', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('files')) {
          request.result.createObjectStore('files', { keyPath: 'path' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to open Nammu VFS'));
    });
  }

  private async hydrateFromIDB(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('files', 'readonly');
    const request = tx.objectStore('files').getAll();
    const records = await new Promise<
      Array<{ path: string; bytes: Uint8Array; createdAt: number; updatedAt: number }>
    >((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to hydrate Nammu VFS'));
    });
    await waitForTransaction(tx);
    for (const record of records) {
      this.files.set(record.path, {
        bytes: new Uint8Array(record.bytes),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }
  }

  private async persistFile(
    path: string,
    bytes: Uint8Array,
    createdAt: number,
    updatedAt: number,
  ): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put({ path, bytes, createdAt, updatedAt });
    await waitForTransaction(tx);
  }

  private async removeFile(path: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(path);
    await waitForTransaction(tx);
  }

  override async writeFile(
    path: string,
    content: Uint8Array | string,
    _options: VFSWriteOptions = {},
  ): Promise<void> {
    await this.ensureReady();
    const normalized = normalizePath(path);
    const bytes =
      typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
    const now = Date.now();
    const entry = {
      bytes,
      createdAt: this.files.get(normalized)?.createdAt ?? now,
      updatedAt: now,
    };
    await this.persistFile(normalized, entry.bytes, entry.createdAt, entry.updatedAt);
    this.files.set(normalized, entry);
  }

  override async deleteFile(path: string): Promise<void> {
    await this.ensureReady();
    const normalized = normalizePath(path);
    await this.removeFile(normalized);
    this.files.delete(normalized);
  }

  override async deleteDirectory(path: string, recursive: boolean = true): Promise<void> {
    const normalized = normalizePath(path);
    const prefix =
      normalized === '/' ? '/' : normalized.endsWith('/') ? normalized : `${normalized}/`;
    const toDelete: string[] = [];
    for (const key of this.files.keys()) {
      if (key === normalized || key.startsWith(prefix)) {
        toDelete.push(key);
      }
    }
    if (toDelete.length > 0) {
      const db = await this.dbPromise;
      const tx = db.transaction('files', 'readwrite');
      for (const key of toDelete) tx.objectStore('files').delete(key);
      await waitForTransaction(tx);
    }
    await super.deleteDirectory(path, recursive);
  }
}

let defaultVFS: NammuVFS | null = null;

export function getNammuVFS(): NammuVFS {
  if (!defaultVFS) {
    if (typeof indexedDB !== 'undefined') {
      defaultVFS = new IndexedDBNammuVFS();
    } else {
      defaultVFS = new InMemoryNammuVFS();
    }
  }
  return defaultVFS;
}
