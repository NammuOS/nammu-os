/** Hardened package lifecycle engine for Nammu applications. */

import { unpackNapp } from './nappArchive';
import { compareSemver, validateNammuAppManifest } from './manifestValidator';
import {
  KNOWN_PERMISSIONS,
  SAFE_PERMISSIONS,
  type InstalledAppRecord,
  type InstalledVersionRecord,
  type NammuAppManifest,
  type PermissionIdentifier,
  type ReleaseChannel,
} from './nappSpec';
import type { ActivationTransaction, NMUDatabase } from './nmuDatabase';
import { getNMUDatabase } from './nmuDatabase';
import type { AppActiveVersionPointer, NammuVFS } from '../vfs/vfsContracts';
import { getNammuVFS } from '../vfs/nammuVFS';
import { getPublisherKeyring, PublisherKeyring, type PackageTrustResult } from './packageSecurity';
import { getPlatformCapabilities } from '../index';
import { integrationProfilePurgeNamespace } from '../integrationProfiles/profilePolicy';

export interface InstallOptions {
  sourceRegistry?: 'official' | 'community' | 'developer' | 'local';
  sourceUrl?: string;
  channel?: ReleaseChannel;
  approvedPermissions?: PermissionIdentifier[];
  skipHealthCheck?: boolean;
}

export interface UninstallOptions {
  purgeUserData?: boolean;
  purgeCache?: boolean;
}
export interface NMUEngineOptions {
  healthCheckTimeoutMs?: number;
  now?: () => number;
  integrationProfilePurger?: (record: InstalledAppRecord) => Promise<void>;
}

const versionDirectory = (appId: string, version: string) =>
  `/applications/${appId}/versions/${version}`;

function asVersionRecord(record: InstalledAppRecord): InstalledVersionRecord {
  return {
    appId: record.appId,
    version: record.version,
    name: record.name,
    runtime: record.runtime,
    entry: record.entry,
    packageHash: record.packageHash,
    publisher: record.publisher,
    publisherKeyId: record.publisherKeyId,
    dataSchemaVersion: record.dataSchemaVersion,
    requestedPermissions: [...record.requestedPermissions],
    grantedPermissions: [...record.grantedPermissions],
    capabilities: record.capabilities ? structuredClone(record.capabilities) : undefined,
    activeVersionDir: record.activeVersionDir,
    installedAt: record.lastUpdatedAt,
    signatureVerified: record.signatureVerified,
    isOfficial: record.isOfficial,
    legacyStorageKeys: record.legacyStorageKeys ? [...record.legacyStorageKeys] : undefined,
    integrationProfileMigrations: record.integrationProfileMigrations
      ? structuredClone(record.integrationProfileMigrations)
      : undefined,
  };
}

export class NMUEngine {
  private readonly healthCheckTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly recoveryPromise: Promise<void>;
  private readonly healthCheckTimeoutMs: number;
  private readonly now: () => number;
  private readonly integrationProfilePurger: (record: InstalledAppRecord) => Promise<void>;

  constructor(
    private readonly vfs: NammuVFS = getNammuVFS(),
    private readonly db: NMUDatabase = getNMUDatabase(),
    private readonly keyring: PublisherKeyring = getPublisherKeyring(),
    options: NMUEngineOptions = {},
  ) {
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs ?? 5_000;
    this.now = options.now ?? Date.now;
    this.integrationProfilePurger = options.integrationProfilePurger ?? (async () => {});
    this.recoveryPromise = this.recoverActivations();
  }

  ready(): Promise<void> {
    return this.recoveryPromise;
  }

  private async recoverActivations(): Promise<void> {
    await this.db.ready();
    for (const transaction of await this.db.listActivations()) {
      if (transaction.status !== 'activating') continue;
      const app = await this.db.getApp(transaction.appId);
      if (!app || app.state !== 'Activating' || this.now() >= transaction.deadline) {
        await this.restoreActivation(transaction);
      } else {
        this.scheduleHealthCheckRollback(transaction.appId, transaction.deadline - this.now());
      }
    }
  }

  private async verifyTrust(
    manifest: NammuAppManifest,
    files: Map<string, Uint8Array>,
    signature: Parameters<PublisherKeyring['verifyPackageTrust']>[2],
    operation: string,
  ) {
    const trust = await this.keyring.verifyPackageTrust(manifest, files, signature);
    if (manifest.id.startsWith('os.nammu.') && (!trust.verified || !trust.isOfficial)) {
      throw new Error(
        `[nmu ${operation}] Unauthorized official package: ${trust.error ?? 'untrusted signer'}`,
      );
    }
    if (signature && !trust.verified) {
      throw new Error(`[nmu ${operation}] Signature verification failed: ${trust.error}`);
    }
    return trust;
  }

  private assertSignerContinuity(
    existing: InstalledAppRecord,
    trust: PackageTrustResult,
    operation: string,
  ): void {
    if (!existing.signatureVerified) return;
    if (
      !trust.verified ||
      !trust.keyId ||
      trust.keyId !== existing.publisherKeyId ||
      trust.publisher !== existing.publisher
    ) {
      throw new Error(
        `[nmu ${operation}] Verified publisher identity changed for "${existing.appId}"`,
      );
    }
  }

  private grantedPermissions(
    manifest: NammuAppManifest,
    approved: PermissionIdentifier[] = [],
    existing: PermissionIdentifier[] = [],
    isOfficial = false,
  ) {
    const approvedSet = new Set(approved);
    const existingSet = new Set(existing);
    return manifest.permissions.filter(
      (permission) =>
        existingSet.has(permission) ||
        SAFE_PERMISSIONS.has(permission) ||
        ((permission === 'migration.legacy-storage' ||
          permission === 'migration.integration-profile') &&
          isOfficial) ||
        approvedSet.has(permission),
    );
  }

  private async writeImmutableVersion(
    appId: string,
    version: string,
    files: Map<string, Uint8Array>,
  ): Promise<string> {
    const destination = versionDirectory(appId, version);
    if (await this.vfs.exists(destination)) {
      throw new Error(
        `[nmu update] Immutable version ${appId}@${version} already exists; use repair for same-version recovery.`,
      );
    }
    const staging = `/applications/${appId}/.staging/${version}`;
    await this.vfs.deleteDirectory(staging);
    try {
      for (const [path, data] of files)
        await this.vfs.writeFile(`${staging}/${path}`, data, { atomic: true });
      for (const [path, data] of files)
        await this.vfs.writeFile(`${destination}/${path}`, data, { atomic: true });
      return destination;
    } catch (error) {
      await this.vfs.deleteDirectory(destination);
      throw error;
    } finally {
      await this.vfs.deleteDirectory(staging);
    }
  }

  async install(
    packageBytes: Uint8Array,
    options: InstallOptions = {},
  ): Promise<InstalledAppRecord> {
    await this.ready();
    const unpacked = await unpackNapp(packageBytes);
    const validation = validateNammuAppManifest(unpacked.manifest, {
      allowOfficialNamespace: true,
    });
    if (!validation.valid || !validation.manifest)
      throw new Error(
        `[nmu install] Manifest validation failed:\n- ${validation.errors.join('\n- ')}`,
      );
    const manifest = validation.manifest;
    const trust = await this.verifyTrust(manifest, unpacked.files, unpacked.signature, 'install');
    if (manifest.legacyStorageKeys?.length && !trust.isOfficial) {
      throw new Error(
        '[nmu install] Legacy Core storage migration is restricted to official packages.',
      );
    }
    if (manifest.integrationProfileMigrations?.length && !trust.isOfficial) {
      throw new Error('[nmu install] Integration-profile adoption requires an official package.');
    }
    const existing = await this.db.getApp(manifest.id);
    if (existing) {
      if (compareSemver(manifest.version, existing.version) > 0)
        return this.update(manifest.id, packageBytes, options);
      throw new Error(
        `[nmu install] Application "${manifest.id}" is already installed at version ${existing.version}. Use update or repair.`,
      );
    }

    const dir = await this.writeImmutableVersion(manifest.id, manifest.version, unpacked.files);
    const now = this.now();
    const record: InstalledAppRecord = {
      appId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      runtime: manifest.runtime,
      entry: manifest.entry,
      sourceRegistry: options.sourceRegistry ?? (trust.isOfficial ? 'official' : 'local'),
      sourceUrl: options.sourceUrl,
      channel: options.channel ?? 'stable',
      installedAt: now,
      lastUpdatedAt: now,
      packageHash: unpacked.packageHash,
      publisher: trust.verified ? trust.publisher : undefined,
      publisherKeyId: trust.verified ? trust.keyId : undefined,
      dataSchemaVersion: manifest.dataSchemaVersion,
      requestedPermissions: [...manifest.permissions],
      grantedPermissions: this.grantedPermissions(
        manifest,
        options.approvedPermissions,
        [],
        trust.isOfficial,
      ),
      capabilities: manifest.capabilities ? structuredClone(manifest.capabilities) : undefined,
      state: 'Installed',
      activeVersion: manifest.version,
      activeVersionDir: dir,
      installedSize: packageBytes.length,
      signatureVerified: trust.verified,
      isOfficial: trust.isOfficial,
      legacyStorageKeys: manifest.legacyStorageKeys ? [...manifest.legacyStorageKeys] : undefined,
      integrationProfileMigrations: manifest.integrationProfileMigrations
        ? structuredClone(manifest.integrationProfileMigrations)
        : undefined,
    };
    const pointer = this.pointerFor(record);
    await this.db.saveVersion(asVersionRecord(record));
    await this.vfs.setActiveAppVersion(pointer);
    await this.db.saveApp(record);
    return record;
  }

  async update(
    appId: string,
    packageBytes: Uint8Array,
    options: InstallOptions = {},
  ): Promise<InstalledAppRecord> {
    await this.ready();
    const existing = await this.db.getApp(appId);
    if (!existing)
      throw new Error(`[nmu update] Cannot update "${appId}": application is not installed.`);
    const unpacked = await unpackNapp(packageBytes);
    const validation = validateNammuAppManifest(unpacked.manifest, {
      allowOfficialNamespace: true,
    });
    if (!validation.valid || !validation.manifest)
      throw new Error(
        `[nmu update] Manifest validation failed:\n- ${validation.errors.join('\n- ')}`,
      );
    const manifest = validation.manifest;
    if (manifest.id !== appId)
      throw new Error(
        `[nmu update] Package ID mismatch: expected "${appId}", got "${manifest.id}"`,
      );
    if (compareSemver(manifest.version, existing.version) <= 0) {
      throw new Error(
        `[nmu update] Version ${manifest.version} is not newer than installed version ${existing.version}; use repair or explicit rollback.`,
      );
    }
    const trust = await this.verifyTrust(manifest, unpacked.files, unpacked.signature, 'update');
    if (manifest.legacyStorageKeys?.length && !trust.isOfficial) {
      throw new Error(
        '[nmu update] Legacy Core storage migration is restricted to official packages.',
      );
    }
    if (manifest.integrationProfileMigrations?.length && !trust.isOfficial) {
      throw new Error('[nmu update] Integration-profile adoption requires an official package.');
    }
    this.assertSignerContinuity(existing, trust, 'update');
    const retainedVersion = await this.db.getVersion(appId, manifest.version);
    let dir: string;
    if (retainedVersion) {
      if (
        retainedVersion.packageHash !== unpacked.packageHash ||
        retainedVersion.publisher !== (trust.verified ? trust.publisher : undefined) ||
        retainedVersion.publisherKeyId !== (trust.verified ? trust.keyId : undefined) ||
        !(await this.vfs.exists(retainedVersion.activeVersionDir))
      ) {
        throw new Error(
          `[nmu update] Retained version ${appId}@${manifest.version} does not match the verified package.`,
        );
      }
      dir = retainedVersion.activeVersionDir;
    } else {
      dir = await this.writeImmutableVersion(appId, manifest.version, unpacked.files);
    }
    const snapshot =
      manifest.dataSchemaVersion > existing.dataSchemaVersion
        ? await this.vfs.createSnapshot(appId, 'userdata', existing.dataSchemaVersion)
        : undefined;
    const now = this.now();
    const candidate: InstalledAppRecord = {
      ...existing,
      name: manifest.name,
      version: manifest.version,
      runtime: manifest.runtime,
      entry: manifest.entry,
      sourceRegistry: options.sourceRegistry ?? existing.sourceRegistry,
      sourceUrl: options.sourceUrl ?? existing.sourceUrl,
      channel: options.channel ?? existing.channel,
      lastUpdatedAt: now,
      packageHash: unpacked.packageHash,
      publisher: trust.verified ? trust.publisher : undefined,
      publisherKeyId: trust.verified ? trust.keyId : undefined,
      dataSchemaVersion: manifest.dataSchemaVersion,
      requestedPermissions: [...manifest.permissions],
      grantedPermissions: this.grantedPermissions(
        manifest,
        options.approvedPermissions,
        existing.grantedPermissions,
        trust.isOfficial,
      ),
      capabilities: manifest.capabilities ? structuredClone(manifest.capabilities) : undefined,
      activeVersion: manifest.version,
      activeVersionDir: dir,
      lastKnownGoodVersion: existing.version,
      state: options.skipHealthCheck ? 'Installed' : 'Activating',
      signatureVerified: trust.verified,
      isOfficial: trust.isOfficial,
      installedSize: packageBytes.length,
      legacyStorageKeys: manifest.legacyStorageKeys ? [...manifest.legacyStorageKeys] : undefined,
      integrationProfileMigrations: manifest.integrationProfileMigrations
        ? structuredClone(manifest.integrationProfileMigrations)
        : undefined,
    };
    const previousPointer =
      (await this.vfs.getActiveAppVersion(appId)) ?? this.pointerFor(existing);
    const activation: ActivationTransaction = {
      appId,
      previous: existing,
      candidate,
      previousPointer,
      deadline: now + this.healthCheckTimeoutMs,
      status: options.skipHealthCheck ? 'committed' : 'activating',
      userDataSnapshot: snapshot,
    };
    await this.db.saveVersion(asVersionRecord(candidate));
    await this.db.saveActivation(activation);
    try {
      await this.vfs.setActiveAppVersion(this.pointerFor(candidate));
      await this.db.saveApp(candidate);
    } catch (error) {
      await this.restoreActivation(activation);
      throw error;
    }
    if (!options.skipHealthCheck)
      this.scheduleHealthCheckRollback(appId, this.healthCheckTimeoutMs);
    return candidate;
  }

  async acknowledgeActivation(appId: string): Promise<void> {
    await this.ready();
    this.clearHealthTimer(appId);
    const app = await this.db.getApp(appId);
    if (app?.state === 'Activating') {
      app.state = 'Installed';
      await this.db.saveApp(app);
      const activation = await this.db.getActivation(appId);
      if (activation)
        await this.db.saveActivation({ ...activation, candidate: app, status: 'committed' });
    }
  }

  private scheduleHealthCheckRollback(appId: string, timeoutMs: number): void {
    this.clearHealthTimer(appId);
    const timer = setTimeout(
      () => {
        this.healthCheckTimeouts.delete(appId);
        void this.rollbackIfStillActivating(appId);
      },
      Math.max(0, timeoutMs),
    );
    this.healthCheckTimeouts.set(appId, timer);
  }

  private async rollbackIfStillActivating(appId: string): Promise<void> {
    const app = await this.db.getApp(appId);
    const activation = await this.db.getActivation(appId);
    if (app?.state === 'Activating' && activation?.status === 'activating') {
      await this.restoreActivation(activation);
    }
  }

  private async restoreActivation(activation: ActivationTransaction): Promise<InstalledAppRecord> {
    this.clearHealthTimer(activation.appId);
    await this.vfs.setActiveAppVersion(activation.previousPointer);
    if (activation.userDataSnapshot)
      await this.vfs.restoreSnapshot(activation.userDataSnapshot, 'userdata');
    const restored = {
      ...activation.previous,
      lastKnownGoodVersion: undefined,
      state: 'Installed' as const,
      lastUpdatedAt: this.now(),
    };
    await this.db.saveApp(restored);
    await this.db.deleteActivation(activation.appId);
    return restored;
  }

  async rollback(appId: string): Promise<InstalledAppRecord> {
    await this.ready();
    const activation = await this.db.getActivation(appId);
    if (activation) return this.restoreActivation(activation);
    const existing = await this.db.getApp(appId);
    if (!existing?.lastKnownGoodVersion)
      throw new Error(`[nmu rollback] No previous version available for "${appId}".`);
    const previous = await this.db.getVersion(appId, existing.lastKnownGoodVersion);
    if (!previous)
      throw new Error(`[nmu rollback] Previous version metadata is unavailable for "${appId}".`);
    return this.activateStoredVersion(existing, previous);
  }

  private async activateStoredVersion(
    existing: InstalledAppRecord,
    version: InstalledVersionRecord,
  ) {
    if (!(await this.vfs.exists(version.activeVersionDir)))
      throw new Error(`[nmu rollback] Version payload is missing: ${version.activeVersionDir}`);
    const restored: InstalledAppRecord = {
      ...existing,
      ...version,
      version: version.version,
      activeVersion: version.version,
      activeVersionDir: version.activeVersionDir,
      state: 'Installed',
      lastKnownGoodVersion: undefined,
      lastUpdatedAt: this.now(),
    };
    await this.vfs.setActiveAppVersion(this.pointerFor(restored));
    await this.db.saveApp(restored);
    return restored;
  }

  async downgrade(appId: string, targetVersion: string): Promise<InstalledAppRecord> {
    await this.ready();
    const existing = await this.db.getApp(appId);
    if (!existing) throw new Error(`[nmu downgrade] Application "${appId}" is not installed.`);
    if (compareSemver(targetVersion, existing.version) >= 0)
      throw new Error('[nmu downgrade] Target must be older than the active version.');
    const version = await this.db.getVersion(appId, targetVersion);
    if (!version) throw new Error(`[nmu downgrade] Version ${targetVersion} is not installed.`);
    return this.activateStoredVersion(existing, version);
  }

  async repair(appId: string, packageBytes: Uint8Array): Promise<InstalledAppRecord> {
    await this.ready();
    const existing = await this.db.getApp(appId);
    if (!existing)
      throw new Error(`[nmu repair] Cannot repair "${appId}": application is not installed.`);
    const unpacked = await unpackNapp(packageBytes);
    const validation = validateNammuAppManifest(unpacked.manifest, {
      allowOfficialNamespace: true,
    });
    if (!validation.valid || !validation.manifest)
      throw new Error(
        `[nmu repair] Manifest validation failed:\n- ${validation.errors.join('\n- ')}`,
      );
    const manifest = validation.manifest;
    if (manifest.id !== appId || manifest.version !== existing.version)
      throw new Error(
        '[nmu repair] Repair package must match the installed application ID and active version.',
      );
    const trust = await this.verifyTrust(manifest, unpacked.files, unpacked.signature, 'repair');
    this.assertSignerContinuity(existing, trust, 'repair');
    const dir = versionDirectory(appId, manifest.version);
    await this.vfs.deleteDirectory(dir);
    try {
      for (const [path, data] of unpacked.files)
        await this.vfs.writeFile(`${dir}/${path}`, data, { atomic: true });
    } catch (error) {
      await this.vfs.deleteDirectory(dir);
      throw error;
    }
    const repaired = {
      ...existing,
      packageHash: unpacked.packageHash,
      lastUpdatedAt: this.now(),
      state: 'Installed' as const,
    };
    await this.db.saveVersion(asVersionRecord(repaired));
    await this.vfs.setActiveAppVersion(this.pointerFor(repaired));
    await this.db.saveApp(repaired);
    return repaired;
  }

  async grantRuntimePermission(appId: string, permission: PermissionIdentifier): Promise<void> {
    await this.ready();
    const existing = await this.db.getApp(appId);
    if (!existing) throw new Error(`[nmu] App "${appId}" not found.`);
    if (!KNOWN_PERMISSIONS.has(permission) || !existing.requestedPermissions.includes(permission)) {
      throw new Error(`[nmu] Permission "${permission}" was not declared by "${appId}".`);
    }
    if (!existing.grantedPermissions.includes(permission)) {
      existing.grantedPermissions.push(permission);
      await this.db.saveApp(existing);
    }
  }

  async uninstall(appId: string, options: UninstallOptions = {}): Promise<void> {
    await this.ready();
    const record = await this.db.getApp(appId);
    if (!record)
      throw new Error(`[nmu uninstall] Application "${appId}" is not installed.`);
    // Profile purge is intentionally completed before package records/files are
    // removed. A native failure leaves the app installed and recoverable.
    if (options.purgeUserData) await this.integrationProfilePurger(record);
    this.clearHealthTimer(appId);
    await this.vfs.deleteDirectory(`/applications/${appId}`);
    if (options.purgeUserData) await this.vfs.deleteDirectory(`/userdata/${appId}`);
    if (options.purgeCache) await this.vfs.deleteDirectory(`/cache/${appId}`);
    await this.db.deleteActivation(appId);
    await this.db.deleteVersions(appId);
    await this.db.deleteApp(appId);
  }

  async enable(appId: string) {
    await this.setState(appId, 'Installed');
  }
  async disable(appId: string) {
    await this.setState(appId, 'Disabled');
  }
  private async setState(appId: string, state: 'Installed' | 'Disabled') {
    await this.ready();
    const app = await this.db.getApp(appId);
    if (!app) throw new Error(`[nmu] Application "${appId}" not found.`);
    app.state = state;
    await this.db.saveApp(app);
  }
  async list() {
    await this.ready();
    return this.db.listApps();
  }
  async info(appId: string) {
    await this.ready();
    const app = await this.db.getApp(appId);
    if (!app) throw new Error(`[nmu info] Application "${appId}" not found.`);
    return { app, storage: await this.vfs.getAppStorageUsage(appId) };
  }

  private clearHealthTimer(appId: string) {
    const timer = this.healthCheckTimeouts.get(appId);
    if (timer) clearTimeout(timer);
    this.healthCheckTimeouts.delete(appId);
  }

  private pointerFor(record: InstalledAppRecord): AppActiveVersionPointer {
    return {
      appId: record.appId,
      activeVersion: record.activeVersion,
      activeVersionDir: record.activeVersionDir,
      packageHash: record.packageHash,
      installedAt: record.installedAt,
      lastUpdatedAt: record.lastUpdatedAt,
    };
  }
}

let defaultEngine: NMUEngine | null = null;
export function getNMUEngine(): NMUEngine {
  defaultEngine ??= new NMUEngine(undefined, undefined, undefined, {
    integrationProfilePurger: async (record) => {
      const result = await getPlatformCapabilities().integrationProfiles.purge(
        await integrationProfilePurgeNamespace(record),
      );
      if (result.status !== 'success') {
        const detail =
          'message' in result
            ? result.message
            : 'reason' in result
              ? result.reason
              : 'Integration-profile purge was cancelled.';
        throw new Error(detail);
      }
    },
  });
  return defaultEngine;
}
