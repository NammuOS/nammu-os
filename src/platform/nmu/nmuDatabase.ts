/** Durable package registry, immutable version metadata, and activation journal. */

import type { AppActiveVersionPointer, VFSSnapshot } from '../vfs/vfsContracts';
import type { InstalledAppRecord, InstalledVersionRecord } from './nappSpec';

export interface ActivationTransaction {
  appId: string;
  previous: InstalledAppRecord;
  candidate: InstalledAppRecord;
  previousPointer: AppActiveVersionPointer;
  deadline: number;
  status: 'activating' | 'committed';
  userDataSnapshot?: VFSSnapshot;
}

export interface NMUDatabase {
  ready(): Promise<void>;
  getApp(appId: string): Promise<InstalledAppRecord | null>;
  saveApp(record: InstalledAppRecord): Promise<void>;
  deleteApp(appId: string): Promise<void>;
  listApps(): Promise<InstalledAppRecord[]>;
  getVersion(appId: string, version: string): Promise<InstalledVersionRecord | null>;
  saveVersion(record: InstalledVersionRecord): Promise<void>;
  deleteVersions(appId: string): Promise<void>;
  getActivation(appId: string): Promise<ActivationTransaction | null>;
  saveActivation(transaction: ActivationTransaction): Promise<void>;
  deleteActivation(appId: string): Promise<void>;
  listActivations(): Promise<ActivationTransaction[]>;
}

const clone = <T>(value: T): T => structuredClone(value);
const versionKey = (appId: string, version: string) => `${appId}@${version}`;

export class InMemoryNMUDatabase implements NMUDatabase {
  protected records = new Map<string, InstalledAppRecord>();
  protected versions = new Map<string, InstalledVersionRecord>();
  protected activations = new Map<string, ActivationTransaction>();

  async ready(): Promise<void> {}
  async getApp(appId: string) {
    const value = this.records.get(appId);
    return value ? clone(value) : null;
  }
  async saveApp(record: InstalledAppRecord) {
    this.records.set(record.appId, clone(record));
  }
  async deleteApp(appId: string) {
    this.records.delete(appId);
  }
  async listApps() {
    return Array.from(this.records.values(), clone);
  }
  async getVersion(appId: string, version: string) {
    const value = this.versions.get(versionKey(appId, version));
    return value ? clone(value) : null;
  }
  async saveVersion(record: InstalledVersionRecord) {
    this.versions.set(versionKey(record.appId, record.version), clone(record));
  }
  async deleteVersions(appId: string) {
    for (const key of this.versions.keys())
      if (key.startsWith(`${appId}@`)) this.versions.delete(key);
  }
  async getActivation(appId: string) {
    const value = this.activations.get(appId);
    return value ? clone(value) : null;
  }
  async saveActivation(transaction: ActivationTransaction) {
    this.activations.set(transaction.appId, clone(transaction));
  }
  async deleteActivation(appId: string) {
    this.activations.delete(appId);
  }
  async listActivations() {
    return Array.from(this.activations.values(), clone);
  }
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDBNMUDatabase extends InMemoryNMUDatabase {
  private readonly readyPromise: Promise<void>;
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    super();
    this.dbPromise = this.openDatabase();
    this.readyPromise = this.hydrate();
  }

  override ready(): Promise<void> {
    return this.readyPromise;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('nammu_os_apps', 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('apps'))
          database.createObjectStore('apps', { keyPath: 'appId' });
        if (!database.objectStoreNames.contains('versions'))
          database.createObjectStore('versions', { keyPath: 'storageKey' });
        if (!database.objectStoreNames.contains('activations'))
          database.createObjectStore('activations', { keyPath: 'appId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Unable to open Nammu package database'));
    });
  }

  private async hydrate(): Promise<void> {
    const database = await this.dbPromise;
    const transaction = database.transaction(['apps', 'versions', 'activations'], 'readonly');
    const [apps, versions, activations] = await Promise.all([
      requestResult(transaction.objectStore('apps').getAll()),
      requestResult(transaction.objectStore('versions').getAll()),
      requestResult(transaction.objectStore('activations').getAll()),
    ]);
    await transactionDone(transaction);
    for (const record of apps as InstalledAppRecord[])
      this.records.set(record.appId, clone(record));
    for (const stored of versions as Array<InstalledVersionRecord & { storageKey: string }>) {
      const { storageKey: _, ...record } = stored;
      this.versions.set(versionKey(record.appId, record.version), clone(record));
    }
    for (const transactionRecord of activations as ActivationTransaction[]) {
      this.activations.set(transactionRecord.appId, clone(transactionRecord));
    }
  }

  private async put(storeName: string, value: unknown): Promise<void> {
    await this.ready();
    const database = await this.dbPromise;
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
  }

  private async remove(storeName: string, key: IDBValidKey): Promise<void> {
    await this.ready();
    const database = await this.dbPromise;
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  }

  override async getApp(appId: string) {
    await this.ready();
    return super.getApp(appId);
  }
  override async listApps() {
    await this.ready();
    return super.listApps();
  }
  override async getVersion(appId: string, version: string) {
    await this.ready();
    return super.getVersion(appId, version);
  }
  override async getActivation(appId: string) {
    await this.ready();
    return super.getActivation(appId);
  }
  override async listActivations() {
    await this.ready();
    return super.listActivations();
  }

  override async saveApp(record: InstalledAppRecord) {
    await this.put('apps', clone(record));
    await super.saveApp(record);
  }
  override async deleteApp(appId: string) {
    await this.remove('apps', appId);
    await super.deleteApp(appId);
  }
  override async saveVersion(record: InstalledVersionRecord) {
    await this.put('versions', {
      ...clone(record),
      storageKey: versionKey(record.appId, record.version),
    });
    await super.saveVersion(record);
  }
  override async deleteVersions(appId: string) {
    await this.ready();
    const keys = Array.from(this.versions.keys()).filter((key) => key.startsWith(`${appId}@`));
    const database = await this.dbPromise;
    const transaction = database.transaction('versions', 'readwrite');
    for (const key of keys) transaction.objectStore('versions').delete(key);
    await transactionDone(transaction);
    await super.deleteVersions(appId);
  }
  override async saveActivation(value: ActivationTransaction) {
    await this.put('activations', clone(value));
    await super.saveActivation(value);
  }
  override async deleteActivation(appId: string) {
    await this.remove('activations', appId);
    await super.deleteActivation(appId);
  }
}

let defaultDB: NMUDatabase | null = null;

export function getNMUDatabase(): NMUDatabase {
  if (!defaultDB) {
    defaultDB =
      typeof indexedDB === 'undefined' ? new InMemoryNMUDatabase() : new IndexedDBNMUDatabase();
  }
  return defaultDB;
}
