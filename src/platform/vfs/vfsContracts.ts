/**
 * Nammu Virtual Filesystem (VFS) Contracts and Security Scopes
 */

export type VFSNamespace = 'applications' | 'userdata' | 'cache' | 'home';

export interface VFSFileStat {
  path: string;
  size: number;
  isDirectory: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface VFSSnapshot {
  appId: string;
  schemaVersion: number;
  timestamp: number;
  files: Record<string, Uint8Array>;
}

export interface VFSWriteOptions {
  atomic?: boolean;
  createParents?: boolean;
}

export interface AppActiveVersionPointer {
  appId: string;
  activeVersion: string;
  activeVersionDir: string;
  packageHash: string;
  installedAt: number;
  lastUpdatedAt: number;
}

export interface NammuVFS {
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  writeFile(path: string, content: Uint8Array | string, options?: VFSWriteOptions): Promise<void>;
  deleteFile(path: string): Promise<void>;
  deleteDirectory(path: string, recursive?: boolean): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<VFSFileStat | null>;
  list(path: string): Promise<string[]>;
  createSnapshot(appId: string, namespace: VFSNamespace, schemaVersion: number): Promise<VFSSnapshot>;
  restoreSnapshot(snapshot: VFSSnapshot, namespace: VFSNamespace): Promise<void>;
  getAppStorageUsage(appId: string): Promise<{ applications: number; userdata: number; cache: number }>;
  getActiveAppVersion(appId: string): Promise<AppActiveVersionPointer | null>;
  setActiveAppVersion(pointer: AppActiveVersionPointer): Promise<void>;
  createScopedVFS(appId: string): ScopedVFS;
}

/**
 * Scoped VFS accessor granted to a specific sandboxed application
 */
export interface ScopedVFS {
  appId: string;
  getActiveVersion(): Promise<string | null>;
  readAppFile(subpath: string): Promise<Uint8Array>;
  readAppText(subpath: string): Promise<string>;
  readUserData(subpath: string): Promise<Uint8Array>;
  readUserDataText(subpath: string): Promise<string>;
  writeUserData(subpath: string, content: Uint8Array | string): Promise<void>;
  deleteUserData(subpath: string): Promise<void>;
  readCache(subpath: string): Promise<Uint8Array>;
  writeCache(subpath: string, content: Uint8Array | string): Promise<void>;
  clearCache(): Promise<void>;
  listUserData(subpath?: string): Promise<string[]>;
}
