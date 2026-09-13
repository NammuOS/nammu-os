import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { OFFICIAL_NAMMU_REGISTRY, type NammuStoreApp } from '@/platform/store/storeRegistry';
import { prepareStorePackage, type StorePackageFetcher } from '@/platform/store/storeDistribution';
import { NammuStoreService } from '@/platform/store/storeService';
import { InMemoryNMUDatabase } from '@/platform/nmu/nmuDatabase';
import { NMUEngine } from '@/platform/nmu/nmuEngine';
import { PublisherKeyring } from '@/platform/nmu/packageSecurity';
import { InMemoryNammuVFS } from '@/platform/vfs/nammuVFS';
import {
  createSignedHelloNammuPackage,
  TEST_NAMMU_KEY_ID,
  TEST_NAMMU_PUBLIC_KEY_HEX,
} from './fixtures/helloNammuFixture';

async function hash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function appFor(bytes: Uint8Array, version = '1.0.0'): Promise<NammuStoreApp> {
  return {
    id: 'os.nammu.notes',
    name: 'Notes',
    tagline: 'Private notes',
    description: 'Test release',
    developer: 'Nammu',
    category: 'Productivity',
    repository: 'https://github.com/NammuOS/nammu-notes',
    license: 'Test',
    icon: 'notes',
    screenshots: [],
    permissions: ['filesystem.appdata.read', 'filesystem.appdata.write'],
    release: {
      version,
      packageUrl: `http://127.0.0.1:43119/os.nammu.notes-${version}.napp`,
      sha256: await hash(bytes),
      size: bytes.length,
      publishedAt: '2026-09-13',
      releaseNotes: 'Test',
    },
  };
}

const responseFor =
  (bytes: Uint8Array): StorePackageFetcher =>
  async () =>
    new Response(Uint8Array.from(bytes), {
      status: 200,
      headers: { 'content-length': String(bytes.length) },
    });

describe('Nammu Store distribution boundary', () => {
  test('publishes only Nammu registry metadata and a pinned Notes release', () => {
    expect(OFFICIAL_NAMMU_REGISTRY.id).toBe('nammu-official');
    expect(OFFICIAL_NAMMU_REGISTRY.apps.map((app) => app.id)).toEqual(['os.nammu.notes']);
    expect(OFFICIAL_NAMMU_REGISTRY.apps[0].repository).toBe(
      'https://github.com/NammuOS/nammu-notes',
    );
    expect(OFFICIAL_NAMMU_REGISTRY.apps[0].release.packageUrl).toBe(
      'https://github.com/NammuOS/nammu-notes/releases/download/v1.0.0/os.nammu.notes-1.0.0-signed.napp',
    );
    expect(OFFICIAL_NAMMU_REGISTRY.apps[0].screenshots).toEqual([
      '/store/os.nammu.notes/notes-workspace.png',
    ]);
    expect(existsSync('public/store/os.nammu.notes/notes-workspace.png')).toBe(true);
    expect(OFFICIAL_NAMMU_REGISTRY.apps[0].release.sha256).toBe(
      'e535510bbde478a0d76d6656c2d0f48d7f743fc8bc513e51870d8e3043674927',
    );
  });

  test('downloads, hashes, and inspects the real package manifest before permission review', async () => {
    const bytes = await createSignedHelloNammuPackage({
      appId: 'os.nammu.notes',
      version: '1.0.0',
      permissions: ['filesystem.appdata.read', 'filesystem.appdata.write'],
    });
    const app = await appFor(bytes);
    const prepared = await prepareStorePackage(app, responseFor(bytes));
    expect(prepared.manifest.id).toBe(app.id);
    expect(prepared.manifest.permissions).toEqual(app.permissions);
    expect(prepared.sha256).toBe(app.release.sha256);
  });

  test('fails closed for tampering, insecure sources, and mismatched package identity', async () => {
    const bytes = await createSignedHelloNammuPackage({ appId: 'os.nammu.notes' });
    const app = await appFor(bytes);
    const tampered = Uint8Array.from(bytes);
    tampered[tampered.length - 1] ^= 1;
    await expect(prepareStorePackage(app, responseFor(tampered))).rejects.toThrow(/integrity/i);
    await expect(
      prepareStorePackage(
        {
          ...app,
          release: { ...app.release, packageUrl: 'http://packages.example.test/app.napp' },
        },
        responseFor(bytes),
      ),
    ).rejects.toThrow(/HTTPS/i);

    const otherBytes = await createSignedHelloNammuPackage({ appId: 'os.nammu.other' });
    const mismatched = await appFor(otherBytes);
    await expect(prepareStorePackage(mismatched, responseFor(otherBytes))).rejects.toThrow(
      /identity/i,
    );
  });

  test('keeps Store orchestration above the existing nmu trust and data-retention engine', async () => {
    const bytes = await createSignedHelloNammuPackage({
      appId: 'os.nammu.notes',
      permissions: ['filesystem.appdata.read', 'filesystem.appdata.write'],
    });
    const app = await appFor(bytes);
    const vfs = new InMemoryNammuVFS();
    const database = new InMemoryNMUDatabase();
    const engine = new NMUEngine(
      vfs,
      database,
      new PublisherKeyring([
        {
          keyId: TEST_NAMMU_KEY_ID,
          publisher: 'nammu-official',
          publicKeyRawHex: TEST_NAMMU_PUBLIC_KEY_HEX,
          authorizedNamespaces: ['os.nammu.*'],
        },
      ]),
    );
    const service = new NammuStoreService(engine, database, responseFor(bytes));
    const prepared = await service.prepare(app);
    const installed = await service.commit('install', prepared);
    expect(installed.signatureVerified).toBe(true);
    expect(installed.sourceRegistry).toBe('official');
    await vfs.writeFile('/userdata/os.nammu.notes/notes.json', new TextEncoder().encode('{}'));
    await service.uninstallKeepingData(app.id);
    expect(await database.getApp(app.id)).toBeNull();
    expect(await vfs.exists('/userdata/os.nammu.notes/notes.json')).toBe(true);
  });
});
