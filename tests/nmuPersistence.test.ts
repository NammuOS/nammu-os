import { beforeEach, describe, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBNMUDatabase } from '@/platform/nmu/nmuDatabase';
import { NMUEngine } from '@/platform/nmu/nmuEngine';
import { IndexedDBNammuVFS } from '@/platform/vfs/nammuVFS';
import { createHelloNammuPackage } from './fixtures/helloNammuFixture';

describe('Nammu package persistence', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    });
  });

  test('immediate reads wait for IndexedDB hydration and survive re-instantiation', async () => {
    const firstDb = new IndexedDBNMUDatabase();
    const firstVfs = new IndexedDBNammuVFS();
    const firstEngine = new NMUEngine(firstVfs, firstDb);
    await firstEngine.install(createHelloNammuPackage());
    await firstVfs.createScopedVFS('dev.nammu.hello').writeUserData('state.txt', 'durable');

    const reloadedDb = new IndexedDBNMUDatabase();
    const reloadedVfs = new IndexedDBNammuVFS();
    const [app, state] = await Promise.all([
      reloadedDb.getApp('dev.nammu.hello'),
      reloadedVfs.createScopedVFS('dev.nammu.hello').readUserDataText('state.txt'),
    ]);

    expect(app?.version).toBe('1.0.0');
    expect(state).toBe('durable');
    expect((await reloadedVfs.getActiveAppVersion('dev.nammu.hello'))?.activeVersion).toBe('1.0.0');
  });

  test('persists activation journal and restores it from fresh database and VFS instances', async () => {
    const firstDb = new IndexedDBNMUDatabase();
    const firstVfs = new IndexedDBNammuVFS();
    const firstEngine = new NMUEngine(firstVfs, firstDb, undefined, {
      healthCheckTimeoutMs: 60_000,
    });
    await firstEngine.install(createHelloNammuPackage({ version: '1.0.0', dataSchemaVersion: 1 }));
    await firstVfs.createScopedVFS('dev.nammu.hello').writeUserData('schema.txt', 'version-one');
    await firstEngine.update(
      'dev.nammu.hello',
      createHelloNammuPackage({ version: '2.0.0', dataSchemaVersion: 2 }),
    );
    const activation = await firstDb.getActivation('dev.nammu.hello');
    expect(activation?.status).toBe('activating');

    const reloadedDb = new IndexedDBNMUDatabase();
    const reloadedVfs = new IndexedDBNammuVFS();
    const recoveredEngine = new NMUEngine(reloadedVfs, reloadedDb, undefined, {
      now: () => (activation?.deadline ?? 0) + 1,
    });
    await recoveredEngine.ready();

    const recovered = await reloadedDb.getApp('dev.nammu.hello');
    expect(recovered?.version).toBe('1.0.0');
    expect(
      await reloadedVfs.createScopedVFS('dev.nammu.hello').readUserDataText('schema.txt'),
    ).toBe('version-one');
    expect(await reloadedDb.getActivation('dev.nammu.hello')).toBeNull();
  });
});
