import type { InstalledAppRecord } from '../nmu/nappSpec';
import type { NMUDatabase } from '../nmu/nmuDatabase';
import { getNMUDatabase } from '../nmu/nmuDatabase';
import type { NMUEngine } from '../nmu/nmuEngine';
import { getNMUEngine } from '../nmu/nmuEngine';
import {
  prepareStorePackage,
  type PreparedStorePackage,
  type StorePackageFetcher,
} from './storeDistribution';
import type { NammuStoreApp } from './storeRegistry';
import { getPlatformCapabilities } from '..';

export type StorePackageAction = 'install' | 'update' | 'repair';

export class NammuStoreService {
  constructor(
    private readonly engine: NMUEngine = getNMUEngine(),
    private readonly database: NMUDatabase = getNMUDatabase(),
    private readonly fetchPackage?: StorePackageFetcher,
  ) {}

  async listInstalled(): Promise<InstalledAppRecord[]> {
    await this.database.ready();
    return this.database.listApps();
  }

  prepare(app: NammuStoreApp): Promise<PreparedStorePackage> {
    const fetchPackage =
      this.fetchPackage ??
      ((_input: URL, init: RequestInit) =>
        getPlatformCapabilities().services.request(
          `/api/app-store/packages/${encodeURIComponent(app.id)}/${encodeURIComponent(app.release.version)}`,
          init,
        ));
    return prepareStorePackage(app, fetchPackage);
  }

  async commit(
    action: StorePackageAction,
    prepared: PreparedStorePackage,
  ): Promise<InstalledAppRecord> {
    const options = {
      sourceRegistry: 'official' as const,
      sourceUrl: prepared.app.release.packageUrl,
      approvedPermissions: [...prepared.manifest.permissions],
    };
    if (action === 'install') return this.engine.install(prepared.bytes, options);
    if (action === 'update') return this.engine.update(prepared.app.id, prepared.bytes, options);
    return this.engine.repair(prepared.app.id, prepared.bytes);
  }

  rollback(appId: string): Promise<InstalledAppRecord> {
    return this.engine.rollback(appId);
  }

  uninstallKeepingData(appId: string): Promise<void> {
    return this.engine.uninstall(appId, { purgeUserData: false, purgeCache: true });
  }
}

let defaultStoreService: NammuStoreService | null = null;

export function getNammuStoreService(): NammuStoreService {
  defaultStoreService ??= new NammuStoreService();
  return defaultStoreService;
}
