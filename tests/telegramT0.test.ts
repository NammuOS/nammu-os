import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { validateNammuAppManifest } from '@/platform/nmu/manifestValidator';
import { CapabilityBroker, type SandboxContext } from '@/platform/sandbox/capabilityBroker';
import { InMemoryNammuVFS } from '@/platform/vfs/nammuVFS';
import { createWebIntegrationProfiles } from '@/platform/web/integrationProfiles';
import { createGeckoWebSurfaces } from '@/platform/web/geckoWebSurfaces';
import {
  authorizeIntegrationProfileAdoption,
  integrationProfilePurgeNamespace,
} from '@/platform/integrationProfiles/profilePolicy';
import { OFFICIAL_NAMMU_KEY_ID } from '@/platform/nmu/packageSecurity';
import type { InstalledAppRecord, WebSurfaceCapability } from '@/platform/nmu/nappSpec';
import { InMemoryNMUDatabase } from '@/platform/nmu/nmuDatabase';
import { NMUEngine } from '@/platform/nmu/nmuEngine';
import { createHelloNammuPackage } from './fixtures/helloNammuFixture';

const telegramSurface: WebSurfaceCapability = {
  type: 'web-surface',
  name: 'telegram-web',
  navigation: { mode: 'approved-origins', origins: ['https://web.telegram.org'] },
  persistentProfile: true,
  maxSurfaces: 8,
  maxPartitions: 8,
};

function installedTelegram(overrides: Partial<InstalledAppRecord> = {}): InstalledAppRecord {
  return {
    appId: 'os.nammu.telegram',
    name: 'Telegram',
    version: '1.0.0',
    runtime: 'integration',
    entry: 'app/index.html',
    sourceRegistry: 'official',
    channel: 'stable',
    installedAt: 1,
    lastUpdatedAt: 1,
    packageHash: 'a'.repeat(64),
    publisher: 'nammu-official',
    publisherKeyId: OFFICIAL_NAMMU_KEY_ID,
    dataSchemaVersion: 1,
    requestedPermissions: ['integration.web-surfaces', 'migration.integration-profile'],
    grantedPermissions: ['integration.web-surfaces', 'migration.integration-profile'],
    capabilities: [telegramSurface],
    state: 'Installed',
    activeVersion: '1.0.0',
    activeVersionDir: '/applications/os.nammu.telegram/versions/1.0.0',
    signatureVerified: true,
    isOfficial: true,
    integrationProfileMigrations: [
      { id: 'telegram-core-v1', version: 1, capability: 'telegram-web', profileKey: 'telegram' },
    ],
    ...overrides,
  };
}

async function sandboxContext(instanceId: string): Promise<SandboxContext> {
  const vfs = new InMemoryNammuVFS();
  return {
    instanceId,
    appId: 'os.nammu.telegram',
    grantedPermissions: new Set(['integration.web-surfaces', 'migration.integration-profile']),
    requestedPermissions: new Set(['integration.web-surfaces', 'migration.integration-profile']),
    capabilities: [{ ...telegramSurface, maxPartitions: 2, maxSurfaces: 3 }],
    integrationProfileMigrations: [
      { id: 'telegram-core-v1', version: 1, capability: 'telegram-web', profileKey: 'telegram' },
    ],
    scopedVfs: vfs.createScopedVFS('os.nammu.telegram'),
  };
}

async function brokerCall(
  broker: CapabilityBroker,
  context: SandboxContext,
  method: string,
  params: Record<string, unknown>,
) {
  const response = await broker.handleRequest(context, {
    id: crypto.randomUUID(),
    method,
    params,
  });
  if (response.error) throw Object.assign(new Error(response.error.message), response.error);
  return response.result;
}

describe('Telegram T0 generic integration profiles', () => {
  it('validates bounded partition and official migration declarations', () => {
    const manifest = {
      manifestVersion: 1 as const,
      id: 'os.nammu.telegram',
      name: 'Telegram',
      version: '1.0.0',
      runtime: 'integration' as const,
      entry: 'app/index.html',
      minNammuVersion: '0.8.0',
      dataSchemaVersion: 1,
      permissions: ['integration.web-surfaces', 'migration.integration-profile'] as const,
      capabilities: [telegramSurface],
      integrationProfileMigrations: [
        { id: 'telegram-core-v1', version: 1, capability: 'telegram-web', profileKey: 'telegram' },
      ],
      publisher: 'nammu-official',
      publisherKeyId: OFFICIAL_NAMMU_KEY_ID,
    };
    expect(validateNammuAppManifest(manifest, { allowOfficialNamespace: true }).valid).toBe(true);
    expect(
      validateNammuAppManifest(
        {
          ...manifest,
          capabilities: [{ ...telegramSurface, maxPartitions: 17 }],
        },
        { allowOfficialNamespace: true },
      ).valid,
    ).toBe(false);
    expect(
      validateNammuAppManifest(
        { ...manifest, permissions: ['integration.web-surfaces'] },
        { allowOfficialNamespace: true },
      ).valid,
    ).toBe(false);
  });

  it('Core authorizes only the exact official Telegram migration and never accepts paths', async () => {
    const approved = await authorizeIntegrationProfileAdoption(installedTelegram(), {
      migrationId: 'telegram-core-v1',
      legacyProfileId: 'account-a',
      partitionKey: 'account-a',
    });
    expect(approved.legacyNamespace).toBe('telegram');
    expect(approved.destinationProfileKey).toMatch(/^pkg-[a-f0-9]{24}-telegram$/);
    expect(JSON.stringify(approved)).not.toContain('web-surfaces');
    await expect(
      authorizeIntegrationProfileAdoption(
        installedTelegram({ isOfficial: false, signatureVerified: false }),
        { migrationId: 'telegram-core-v1', legacyProfileId: 'account-a', partitionKey: 'account-a' },
      ),
    ).rejects.toThrow(/official package/);
    await expect(
      authorizeIntegrationProfileAdoption(
        installedTelegram({ appId: 'os.nammu.whatsapp' }),
        { migrationId: 'telegram-core-v1', legacyProfileId: 'account-a', partitionKey: 'account-a' },
      ),
    ).rejects.toThrow(/not approved/);
    await expect(
      authorizeIntegrationProfileAdoption(installedTelegram(), {
        migrationId: 'telegram-core-v1',
        legacyProfileId: '../browser',
        partitionKey: '../browser',
      }),
    ).rejects.toThrow(/identifiers are invalid/);
  });

  it('denies integration-profile adoption authority to developer packages', async () => {
    const engine = new NMUEngine(new InMemoryNammuVFS(), new InMemoryNMUDatabase());
    const developerPackage = createHelloNammuPackage({
      runtime: 'integration',
      permissions: ['integration.web-surfaces', 'migration.integration-profile'],
      capabilities: [telegramSurface],
      integrationProfileMigrations: [
        { id: 'telegram-core-v1', version: 1, capability: 'telegram-web', profileKey: 'telegram' },
      ],
    });
    await expect(engine.install(developerPackage)).rejects.toThrow(
      /requires an official package/,
    );
  });

  it('enforces partition declarations, limits and per-instance surface ownership', async () => {
    let index = 0;
    const created: Array<{ appId: string; profileKey: string; partitionKey?: string }> = [];
    const broker = new CapabilityBroker({
      onWebSurfaceCreate: async (_, appId, __, request) => {
        created.push({ appId, profileKey: request.profileKey, partitionKey: request.partitionKey });
        return {
          id: `surface-${++index}`,
          url: request.url,
          title: '',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          isAudioPlaying: false,
          isMuted: false,
          visible: request.visible,
        };
      },
      onWebSurfaceDestroy: async () => {},
    });
    const owner = await sandboxContext('owner');
    const attacker = await sandboxContext('attacker');
    broker.registerContext(owner);
    broker.registerContext(attacker);
    const create = (partitionKey?: string) =>
      brokerCall(broker, owner, 'webSurfaces.create', {
        capability: 'telegram-web',
        profileKey: 'telegram',
        partitionKey,
        url: 'https://web.telegram.org/',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      });
    const first = await create('account-a');
    await create('account-b');
    await expect(create('account-c')).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    await expect(create()).rejects.toMatchObject({ code: 'PARTITION_REQUIRED' });
    await expect(
      brokerCall(broker, attacker, 'webSurfaces.destroy', { id: first.id }),
    ).rejects.toMatchObject({ code: 'SURFACE_NOT_OWNED' });
    await brokerCall(broker, owner, 'webSurfaces.destroy', { id: first.id });
    await expect(create('account-c')).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    expect(created.map((item) => item.profileKey)).toEqual(['telegram', 'telegram']);
    expect(created.map((item) => item.partitionKey)).toEqual(['account-a', 'account-b']);
    await broker.unregisterContext('owner');
  });

  it('keeps authenticated-profile migration separate from legacy localStorage migration', async () => {
    const adopted: string[] = [];
    const broker = new CapabilityBroker({
      onIntegrationProfileAdopt: async (_, __, request) => {
        adopted.push(request.partitionKey);
        return { status: 'adopted' };
      },
    });
    const context = await sandboxContext('owner');
    broker.registerContext(context);
    expect(
      await brokerCall(broker, context, 'migration.adoptIntegrationProfile', {
        migrationId: 'telegram-core-v1',
        legacyProfileId: 'account-a',
        partitionKey: 'account-a',
      }),
    ).toEqual({ status: 'adopted' });
    expect(adopted).toEqual(['account-a']);
    context.grantedPermissions.delete('migration.integration-profile');
    context.grantedPermissions.add('migration.legacy-storage');
    await expect(
      brokerCall(broker, context, 'migration.adoptIntegrationProfile', {
        migrationId: 'telegram-core-v1',
        legacyProfileId: 'account-b',
        partitionKey: 'account-b',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('adopts Web container identity aliases idempotently and purges only one package', async () => {
    const values = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as unknown as Storage;
    const profiles = createWebIntegrationProfiles(
      () => ({ localStorage }) as unknown as Window,
    );
    const request = await authorizeIntegrationProfileAdoption(installedTelegram(), {
      migrationId: 'telegram-core-v1',
      legacyProfileId: 'account-a',
      partitionKey: 'account-a',
    });
    expect((await profiles.adopt(request)).status).toBe('success');
    expect((await profiles.adopt(request))).toMatchObject({
      status: 'success',
      value: { status: 'already-adopted' },
    });
    expect(profiles.identityName(request.destinationProfileKey, 'account-a')).toBe(
      'Nammu Telegram · account-a',
    );
    const reloadedProfiles = createWebIntegrationProfiles(
      () => ({ localStorage }) as unknown as Window,
    );
    expect(reloadedProfiles.identityName(request.destinationProfileKey, 'account-a')).toBe(
      'Nammu Telegram · account-a',
    );
    profiles.registerPurger(async () => {});
    expect(await profiles.purge(request.appNamespace)).toMatchObject({
      status: 'success',
      value: { removed: 1 },
    });
    expect(profiles.identityName(request.destinationProfileKey, 'account-a')).toBeUndefined();
  });

  it('retains integration profiles by default and purges before destructive uninstall', async () => {
    const vfs = new InMemoryNammuVFS();
    const db = new InMemoryNMUDatabase();
    let purgeCount = 0;
    const engine = new NMUEngine(vfs, db, undefined, {
      integrationProfilePurger: async () => {
        purgeCount += 1;
      },
    });
    const pkg = createHelloNammuPackage();
    await engine.install(pkg);
    await engine.uninstall('dev.nammu.hello', { purgeUserData: false });
    expect(purgeCount).toBe(0);
    await engine.install(pkg);
    await engine.uninstall('dev.nammu.hello', { purgeUserData: true });
    expect(purgeCount).toBe(1);

    const failing = new NMUEngine(vfs, db, undefined, {
      integrationProfilePurger: async () => {
        throw new Error('profile busy');
      },
    });
    await failing.install(pkg);
    await expect(
      failing.uninstall('dev.nammu.hello', { purgeUserData: true }),
    ).rejects.toThrow('profile busy');
    expect(await db.getApp('dev.nammu.hello')).not.toBeNull();
    expect(await vfs.exists('/applications/dev.nammu.hello')).toBe(true);
  });

  it('preserves integration profiles through update, rollback and repair', async () => {
    const vfs = new InMemoryNammuVFS();
    const db = new InMemoryNMUDatabase();
    let purgeCount = 0;
    const engine = new NMUEngine(vfs, db, undefined, {
      integrationProfilePurger: async () => {
        purgeCount += 1;
      },
    });
    const v1 = createHelloNammuPackage({ version: '1.0.0' });
    const v2 = createHelloNammuPackage({ version: '2.0.0' });
    await engine.install(v1);
    await engine.update('dev.nammu.hello', v2, { skipHealthCheck: true });
    await engine.rollback('dev.nammu.hello');
    await engine.repair('dev.nammu.hello', v1);
    expect(purgeCount).toBe(0);
  });

  it('keeps Browser profiles backward compatible while partitioning only opted-in apps', async () => {
    expect(await integrationProfilePurgeNamespace({ appId: 'os.nammu.telegram' })).toMatch(
      /^pkg-[a-f0-9]{24}$/,
    );
    const tauri = readFileSync('src-tauri/src/web_surface.rs', 'utf8');
    expect(tauri).toContain('if profile_key == "default"');
    expect(tauri).toContain('profile.join(partition)');
    const gecko = readFileSync('src/platform/web/geckoWebSurfaces.ts', 'utf8');
    expect(gecko).toContain('let session = sessions.get(options.profileKey)');
    expect(gecko).toContain('ContextualIdentityService.create');
    expect(gecko).toContain('userContextId');
  });

  it('pools two logical account partitions into one Web Gecko iframe', async () => {
    const appended: any[] = [];
    const fakeWindow = { addEventListener() {}, localStorage: undefined } as unknown as Window;
    const fakeDocument = {
      createElement() {
        return {
          style: {},
          sandbox: { add() {} },
          remove() {
            const index = appended.indexOf(this);
            if (index >= 0) appended.splice(index, 1);
          },
          contentWindow: null,
        };
      },
      body: { append: (node: unknown) => appended.push(node) },
    } as unknown as Document;
    const previousIsolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
    Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
    try {
      const surfaces = createGeckoWebSurfaces({
        getDocument: () => fakeDocument,
        getWindow: () => fakeWindow,
        getOrigin: () => 'https://nammu.test',
      });
      const create = (partitionKey: string) =>
        surfaces.create({
          owner: 'integration',
          profileKey: 'pkg-0123456789abcdef01234567-telegram',
          partitionKey,
          privateSession: false,
          url: 'https://web.telegram.org/',
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          visible: false,
          navigationPolicy: {
            allowPublicWeb: false,
            allowedOrigins: ['https://web.telegram.org'],
          },
        });
      const first = await create('account-a');
      const second = await create('account-b');
      expect(first.status).toBe('success');
      expect(second.status).toBe('success');
      expect(appended).toHaveLength(1);
      if (first.status === 'success') await surfaces.destroy(first.value.id);
      expect(appended).toHaveLength(1);
      if (second.status === 'success') await surfaces.destroy(second.value.id);
      expect(appended).toHaveLength(0);
    } finally {
      if (previousIsolation) Object.defineProperty(globalThis, 'crossOriginIsolated', previousIsolation);
      else delete (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
    }
  });
});
