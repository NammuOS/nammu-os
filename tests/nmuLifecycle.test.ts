import { describe, it, expect, beforeEach } from 'bun:test';
import { validateNammuAppManifest, compareSemver } from '@/platform/nmu/manifestValidator';
import { unpackNapp } from '@/platform/nmu/nappArchive';
import { InMemoryNammuVFS } from '@/platform/vfs/nammuVFS';
import { InMemoryNMUDatabase } from '@/platform/nmu/nmuDatabase';
import { NMUEngine } from '@/platform/nmu/nmuEngine';
import { CapabilityBroker, type SandboxContext } from '@/platform/sandbox/capabilityBroker';
import { NammuSDKClient, type IPCTransport } from '@/sdk/index';
import {
  createHelloNammuPackage,
  createHelloNammuManifest,
  createSignedHelloNammuPackage,
  TEST_NAMMU_KEY_ID,
  TEST_NAMMU_PUBLIC_KEY_HEX,
} from './fixtures/helloNammuFixture';
import { PublisherKeyring } from '@/platform/nmu/packageSecurity';
import type { PermissionIdentifier } from '@/platform/nmu/nappSpec';
import {
  createSandboxBridgeScript,
  materializeSandboxDocument,
} from '@/platform/sandbox/sandboxBridge';

describe('Nammu Package Manager (nmu) & Runtime Lifecycle', () => {
  let vfs: InMemoryNammuVFS;
  let db: InMemoryNMUDatabase;
  let nmu: NMUEngine;

  beforeEach(() => {
    vfs = new InMemoryNammuVFS();
    db = new InMemoryNMUDatabase();
    nmu = new NMUEngine(
      vfs,
      db,
      new PublisherKeyring([
        {
          keyId: TEST_NAMMU_KEY_ID,
          publisher: 'nammu-official',
          publicKeyRawHex: TEST_NAMMU_PUBLIC_KEY_HEX,
          authorizedNamespaces: ['os.nammu.*'],
        },
      ]),
    );
  });

  describe('1. Manifest Specification & SemVer Parsing', () => {
    it('validates a well-formed manifest with manifestVersion 1', () => {
      const manifest = createHelloNammuManifest();
      const result = validateNammuAppManifest(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.manifest?.id).toBe('dev.nammu.hello');
    });

    it('rejects manifests lacking manifestVersion or having version != 1', () => {
      const manifest: any = createHelloNammuManifest();
      delete manifest.manifestVersion;
      const result = validateNammuAppManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('manifestVersion'))).toBe(true);

      const invalidVersionManifest = createHelloNammuManifest({ manifestVersion: 2 });
      const res2 = validateNammuAppManifest(invalidVersionManifest);
      expect(res2.valid).toBe(false);
    });

    it('rejects invalid or non-semantic versions', () => {
      const manifest = createHelloNammuManifest({ version: '1.0' });
      const result = validateNammuAppManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.toLowerCase().includes('semantic version'))).toBe(true);
    });

    it('enforces namespace protection for os.nammu.* on unauthorized packages', () => {
      const manifest = createHelloNammuManifest({ appId: 'os.nammu.systemtool' });
      const result = validateNammuAppManifest(manifest, { allowOfficialNamespace: false });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Reserved namespace'))).toBe(true);

      const officialResult = validateNammuAppManifest(manifest, { allowOfficialNamespace: true });
      expect(officialResult.valid).toBe(true);
    });

    it('correctly compares SemVer versions using full SemVer 2.0.0 precedence rules', () => {
      expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
      expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
      expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
      expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBe(-1);
      // Numeric precedence in prerelease: 10 > 2
      expect(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1);
      // Numeric identifier has lower precedence than non-numeric identifier
      expect(compareSemver('1.0.0-9', '1.0.0-alpha')).toBe(-1);
    });
  });

  describe('2. .napp Archive Packaging & Verification', () => {
    it('packs and unpacks an archive with magic bytes and correct canonical digest', async () => {
      const pkgBytes = createHelloNammuPackage();
      expect(pkgBytes.length).toBeGreaterThan(50);

      // Verify Magic "NAPP" (0x4E, 0x41, 0x50, 0x50) and Format Version 0x01
      expect(pkgBytes[0]).toBe(0x4e); // N
      expect(pkgBytes[1]).toBe(0x41); // A
      expect(pkgBytes[2]).toBe(0x50); // P
      expect(pkgBytes[3]).toBe(0x50); // P
      expect(pkgBytes[4]).toBe(0x01); // Version 1

      const unpacked = await unpackNapp(pkgBytes);
      expect(unpacked.manifest.id).toBe('dev.nammu.hello');
      expect(unpacked.manifest.version).toBe('1.0.0');
      expect(unpacked.files.has('app/index.html')).toBe(true);
      expect(unpacked.files.has('app/main.js')).toBe(true);
      expect(unpacked.digest).toBeTruthy();
    });

    it('rejects invalid or corrupted archive buffers', async () => {
      const corruptedBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      await expect(unpackNapp(corruptedBytes)).rejects.toThrow(/Corrupt package|Invalid package/);
    });
  });

  describe('3. NMU Installation & Virtual Filesystem (VFS)', () => {
    it('transactionally installs package into versioned directory and writes active pointer', async () => {
      const pkgBytes = createHelloNammuPackage();
      const record = await nmu.install(pkgBytes, {
        approvedPermissions: ['notifications.send'],
      });

      expect(record.appId).toBe('dev.nammu.hello');
      expect(record.version).toBe('1.0.0');
      expect(record.state).toBe('Installed');
      expect(record.grantedPermissions).toContain('notifications.send');
      expect(record.grantedPermissions).toContain('filesystem.appdata.write');

      // Verify versioned layout in VFS
      expect(await vfs.exists('/applications/dev.nammu.hello/active.json')).toBe(true);
      expect(await vfs.exists('/applications/dev.nammu.hello/versions/1.0.0/nammu.app.json')).toBe(
        true,
      );
      expect(await vfs.exists('/applications/dev.nammu.hello/versions/1.0.0/app/index.html')).toBe(
        true,
      );

      // Verify ScopedVFS resolves versioned app files seamlessly
      const scoped = vfs.createScopedVFS('dev.nammu.hello');
      expect(await scoped.readAppText('nammu.app.json')).toContain('Hello Nammu');

      // Verify database record
      const dbApp = await db.getApp('dev.nammu.hello');
      expect(dbApp).not.toBeNull();
      expect(dbApp?.version).toBe('1.0.0');
      expect(dbApp?.activeVersion).toBe('1.0.0');
    });

    it('prevents re-installing existing version without update', async () => {
      const pkgBytes = createHelloNammuPackage();
      await nmu.install(pkgBytes);

      await expect(nmu.install(pkgBytes)).rejects.toThrow('already installed at version 1.0.0');
    });
  });

  describe('4. Sandboxed Runtime Boundary & Capability Broker (@nammu/sdk)', () => {
    it('queues bootstrap RPC exactly once and refuses channel rebinding', () => {
      const listeners = new Map<string, (event: any) => void>();
      let fallbackPosts = 0;
      const parent = { postMessage: () => fallbackPosts++ };
      const fakeWindow: any = {
        parent,
        addEventListener: (name: string, listener: (event: any) => void) =>
          listeners.set(name, listener),
      };
      const script = createSandboxBridgeScript('dev.nammu.hello', 'instance-1', 'nonce-1')
        .replace(/^<script>/, '')
        .replace(/<\/script>$/, '');
      new Function('window', script)(fakeWindow);

      const request = { id: 'once', method: 'settings.set', params: { key: 'x', value: 1 } };
      fakeWindow.__NAMMU_IPC_TRANSPORT__.send(request);
      expect(fallbackPosts).toBe(0);
      const firstPort = {
        posted: [] as any[],
        postMessage(value: any) {
          this.posted.push(value);
        },
        onmessage: null,
      };
      listeners.get('message')?.({
        source: parent,
        data: { type: 'nammu:bootstrap', instanceId: 'instance-1', instanceNonce: 'nonce-1' },
        ports: [firstPort],
      });
      expect(firstPort.posted).toEqual([request]);

      const replacementPort = {
        posted: [] as any[],
        postMessage(value: any) {
          this.posted.push(value);
        },
        onmessage: null,
      };
      listeners.get('message')?.({
        source: parent,
        data: { type: 'nammu:bootstrap', instanceId: 'instance-1', instanceNonce: 'nonce-1' },
        ports: [replacementPort],
      });
      fakeWindow.__NAMMU_IPC_TRANSPORT__.send({ id: 'second' });
      expect(firstPort.posted).toHaveLength(2);
      expect(replacementPort.posted).toHaveLength(0);
    });

    it('materializes packaged scripts and styles into srcDoc while rejecting remote assets', async () => {
      const html =
        '<html><head><link rel="stylesheet" href="styles.css"></head><body><script src="main.js"></script></body></html>';
      const materialized = await materializeSandboxDocument(html, 'app/index.html', async (path) =>
        path === 'app/main.js'
          ? 'window.referenceAppExecuted = true;'
          : path === 'app/styles.css'
            ? '.reference-app { color: orange; }'
            : '',
      );
      expect(materialized).toContain('window.referenceAppExecuted = true;');
      expect(materialized).toContain('.reference-app { color: orange; }');
      expect(materialized).not.toContain('src="main.js"');
      expect(materialized).not.toContain('href="styles.css"');
      await expect(
        materializeSandboxDocument(
          '<script src="https://attacker.example/payload.js"></script>',
          'app/index.html',
          async () => '',
        ),
      ).rejects.toThrow(/External or absolute/);
      await expect(
        materializeSandboxDocument(
          '<link href="https://attacker.example/payload.css" rel="stylesheet">',
          'app/index.html',
          async () => '',
        ),
      ).rejects.toThrow(/External or absolute/);
    });

    it('exercises complete capability broker IPC message lifecycle over instance context', async () => {
      // 1. Install Hello Nammu with sensitive permission approved
      const pkgBytes = createHelloNammuPackage();
      await nmu.install(pkgBytes, { approvedPermissions: ['notifications.send'] });

      // 2. Setup host hooks and broker
      let lastWindowTitle = '';
      let deliveredNotification: any = null;
      let appReadySignaled = false;
      let clipboardText = '';
      let savedTextFile: { suggestedName: string; content: string; mimeType: string } | null = null;
      const legacyStorage = new Map([['nammu-notes', '[{"id":"legacy"}]']]);

      const broker = new CapabilityBroker({
        onWindowTitleChange: (_, __, title) => {
          lastWindowTitle = title;
        },
        onNotification: (_, notification) => {
          deliveredNotification = notification;
        },
        onAppReady: () => {
          appReadySignaled = true;
        },
        onClipboardWriteText: async (text) => {
          clipboardText = text;
        },
        onSaveTextFile: async (suggestedName, content, mimeType) => {
          savedTextFile = { suggestedName, content, mimeType };
          return { saved: true, fileName: suggestedName };
        },
        onLegacyStorageRead: async (key) => legacyStorage.get(key) ?? null,
        onLegacyStorageComplete: async (key) => {
          legacyStorage.delete(key);
        },
      });

      const scopedVfs = vfs.createScopedVFS('dev.nammu.hello');
      const grantedPermissions = new Set<PermissionIdentifier>([
        'notifications.send',
        'filesystem.appdata.read',
        'filesystem.appdata.write',
        'clipboard.write',
        'filesystem.user-selected.write',
        'migration.legacy-storage',
      ]);

      // 3. Connect SDK client to CapabilityBroker via instance-keyed transport
      const instanceId = 'inst_dev.nammu.hello_win1';
      let sdkMessageListener: ((msg: any) => void) | null = null;

      const hostContext: SandboxContext = {
        instanceId,
        appId: 'dev.nammu.hello',
        grantedPermissions,
        requestedPermissions: new Set<PermissionIdentifier>([
          ...grantedPermissions,
          'clipboard.read',
        ]),
        legacyStorageKeys: new Set(['nammu-notes']),
        scopedVfs,
        postMessage: (msg) => {
          if (sdkMessageListener) sdkMessageListener(msg);
        },
      };

      broker.registerContext(hostContext);

      const loopbackTransport: IPCTransport = {
        send: async (req) => {
          const res = await broker.handleRequest(hostContext, req);
          if (sdkMessageListener) sdkMessageListener(res);
        },
        onMessage: (listener) => {
          sdkMessageListener = listener;
          return () => {
            sdkMessageListener = null;
          };
        },
      };

      const app = new NammuSDKClient({
        appId: 'dev.nammu.hello',
        instanceId,
        transport: loopbackTransport,
      });

      // (a) Window API: set title
      const titleRes = await app.window.setTitle('Hello Nammu - Interactive Workspace');
      expect(titleRes.success).toBe(true);
      expect(lastWindowTitle).toBe('Hello Nammu - Interactive Workspace');

      // (b) Settings API: write & read isolated settings
      await app.settings.set('themeMode', 'cyberpunk');
      await app.settings.set('fontSize', 14);

      const themeSetting = await app.settings.get('themeMode');
      const fontSetting = await app.settings.get('fontSize');
      expect(themeSetting).toBe('cyberpunk');
      expect(fontSetting).toBe(14);

      // Verify settings are persisted in VFS /userdata/dev.nammu.hello/settings.json
      const settingsContent = await scopedVfs.readUserDataText('settings.json');
      expect(JSON.parse(settingsContent).themeMode).toBe('cyberpunk');

      // (c) Notifications API: send notification with permission
      const notifRes = await app.notifications.send({
        title: 'Welcome',
        body: 'Hello Nammu is initialized!',
      });
      expect(notifRes.delivered).toBe(true);
      expect(deliveredNotification).toEqual({
        title: 'Welcome',
        body: 'Hello Nammu is initialized!',
        icon: undefined,
      });

      // (d) Files API: write & read file inside scoped userdata directory
      await app.files.writeText('documents/welcome.txt', 'Hello from isolated sandbox!');
      const readContent = await app.files.readText('documents/welcome.txt');
      expect(readContent).toBe('Hello from isolated sandbox!');
      expect(await vfs.exists('/userdata/dev.nammu.hello/documents/welcome.txt')).toBe(true);

      // (e) Explicit host capabilities: clipboard and user-selected save.
      expect(await app.clipboard.writeText('A private note')).toEqual({ written: true });
      expect(clipboardText).toBe('A private note');
      expect(await app.files.saveText('note.md', '# Note', 'text/markdown')).toEqual({
        saved: true,
        fileName: 'note.md',
      });
      expect(
        savedTextFile as { suggestedName: string; content: string; mimeType: string } | null,
      ).toEqual({
        suggestedName: 'note.md',
        content: '# Note',
        mimeType: 'text/markdown',
      });
      expect(await app.migration.readLegacyStorage('nammu-notes')).toBe('[{"id":"legacy"}]');
      await app.migration.completeLegacyStorage('nammu-notes');
      expect(legacyStorage.has('nammu-notes')).toBe(false);
      await expect(app.migration.readLegacyStorage('other-app-data')).rejects.toThrow(
        /not declared by this app/,
      );

      // (f) Permissions API: check granted vs ungranted
      expect(await app.permissions.check('notifications.send')).toBe(true);
      expect(await app.permissions.check('clipboard.read')).toBe(false);

      // (g) Startup readiness signal
      const readyRes = await app.ready();
      expect(readyRes.ready).toBe(true);
      expect(appReadySignaled).toBe(true);

      // (h) Events API: namespaced event broadcast
      let receivedEventPayload: any = null;
      app.events.on('app.dev.nammu.hello.ping', (payload) => {
        receivedEventPayload = payload;
      });

      await app.events.emit('ping', { time: 12345 });
      expect(receivedEventPayload).toEqual({ time: 12345 });

      app.dispose();
      broker.unregisterContext(instanceId);
    });

    it('enforces permission denial when privileged APIs are called without grant', async () => {
      const broker = new CapabilityBroker();
      const scopedVfs = vfs.createScopedVFS('dev.nammu.unprivileged');
      const hostContext: SandboxContext = {
        instanceId: 'inst_unprivileged_1',
        appId: 'dev.nammu.unprivileged',
        grantedPermissions: new Set<PermissionIdentifier>(),
        requestedPermissions: new Set<PermissionIdentifier>(),
        scopedVfs,
      };
      broker.registerContext(hostContext);

      let sdkMessageListener: ((msg: any) => void) | null = null;
      const loopbackTransport: IPCTransport = {
        send: async (req) => {
          const res = await broker.handleRequest(hostContext, req);
          if (sdkMessageListener) sdkMessageListener(res);
        },
        onMessage: (listener) => {
          sdkMessageListener = listener;
          return () => {
            sdkMessageListener = null;
          };
        },
      };

      const app = new NammuSDKClient({
        appId: 'dev.nammu.unprivileged',
        instanceId: 'inst_unprivileged_1',
        transport: loopbackTransport,
      });

      // Attempting to send notification without notifications.send permission
      await expect(app.notifications.send({ title: 'Spam', body: 'Blocked' })).rejects.toThrow(
        "lacks required permission 'notifications.send'",
      );

      // Attempting to write file without filesystem.appdata.write permission
      await expect(app.files.writeText('test.txt', 'Blocked')).rejects.toThrow(
        "lacks required permission 'filesystem.appdata.write'",
      );

      app.dispose();
    });
  });

  describe('5. Transactional Update & Data Schema Migration Snapshot', () => {
    it('creates pre-migration snapshot, writes new versioned directory and swaps active pointer', async () => {
      // 1. Install v1.0.0 with dataSchemaVersion 1
      const v1Pkg = createHelloNammuPackage({ version: '1.0.0', dataSchemaVersion: 1 });
      await nmu.install(v1Pkg, { approvedPermissions: ['notifications.send'] });

      // 2. Populate app userdata
      const scopedVfs = vfs.createScopedVFS('dev.nammu.hello');
      await scopedVfs.writeUserData('database.db', 'legacy-v1-schema-data');

      // 3. Update to v1.1.0 with dataSchemaVersion 2 (skip health check for immediate activation)
      const v2Pkg = createHelloNammuPackage({ version: '1.1.0', dataSchemaVersion: 2 });
      const updatedRecord = await nmu.update('dev.nammu.hello', v2Pkg, {
        skipHealthCheck: true,
      });

      expect(updatedRecord.version).toBe('1.1.0');
      expect(updatedRecord.dataSchemaVersion).toBe(2);
      expect(updatedRecord.lastKnownGoodVersion).toBe('1.0.0');
      expect(updatedRecord.activeVersion).toBe('1.1.0');

      // Verify active version pointer points to v1.1.0
      const activePointer = await vfs.getActiveAppVersion('dev.nammu.hello');
      expect(activePointer?.activeVersion).toBe('1.1.0');
      expect(activePointer?.activeVersionDir).toBe('/applications/dev.nammu.hello/versions/1.1.0');

      // Verify old v1.0.0 directory is STILL preserved in VFS (no in-place deletion)
      expect(await vfs.exists('/applications/dev.nammu.hello/versions/1.0.0/nammu.app.json')).toBe(
        true,
      );

      // Verify userdata is intact
      const existingData = await scopedVfs.readUserDataText('database.db');
      expect(existingData).toBe('legacy-v1-schema-data');
    });

    it('rolls back active version pointer and restores pre-migration userdata snapshot upon rollback', async () => {
      // 1. Install v1.0.0 with dataSchemaVersion 1
      const v1Pkg = createHelloNammuPackage({ version: '1.0.0', dataSchemaVersion: 1 });
      await nmu.install(v1Pkg);

      const scopedVfs = vfs.createScopedVFS('dev.nammu.hello');
      await scopedVfs.writeUserData('state.json', JSON.stringify({ items: [1, 2, 3] }));

      // 2. Update to v2.0.0 with dataSchemaVersion 2
      const v2Pkg = createHelloNammuPackage({ version: '2.0.0', dataSchemaVersion: 2 });
      await nmu.update('dev.nammu.hello', v2Pkg, { skipHealthCheck: true });

      // Simulate a buggy migration that corrupted state.json
      await scopedVfs.writeUserData('state.json', 'CORRUPTED_MIGRATION');

      // 3. Trigger rollback
      const rolledBack = await nmu.rollback('dev.nammu.hello');
      expect(rolledBack.version).toBe('1.0.0');
      expect(rolledBack.activeVersion).toBe('1.0.0');
      expect(rolledBack.dataSchemaVersion).toBe(1);

      // Verify active pointer is back at 1.0.0
      const activePointer = await vfs.getActiveAppVersion('dev.nammu.hello');
      expect(activePointer?.activeVersion).toBe('1.0.0');

      // Verify userdata snapshot restored
      const restoredState = await scopedVfs.readUserDataText('state.json');
      expect(JSON.parse(restoredState)).toEqual({ items: [1, 2, 3] });
    });
  });

  describe('6. Uninstall and Granular Data Purge Policies', () => {
    it('uninstalls package but preserves userdata by default for clean reinstall', async () => {
      const pkg = createHelloNammuPackage();
      await nmu.install(pkg);

      const scopedVfs = vfs.createScopedVFS('dev.nammu.hello');
      await scopedVfs.writeUserData('saved_file.txt', 'User work to keep');

      // Uninstall without purgeUserData
      await nmu.uninstall('dev.nammu.hello', { purgeUserData: false });

      // Binary removed
      expect(await vfs.exists('/applications/dev.nammu.hello')).toBe(false);
      // Registry cleared
      expect(await db.getApp('dev.nammu.hello')).toBeNull();
      // Userdata preserved
      expect(await vfs.exists('/userdata/dev.nammu.hello/saved_file.txt')).toBe(true);

      // Re-installing app immediately has access to its previous userdata
      await nmu.install(pkg);
      expect(await scopedVfs.readUserDataText('saved_file.txt')).toBe('User work to keep');
    });

    it('completely purges all binaries, userdata, and cache when requested', async () => {
      const pkg = createHelloNammuPackage();
      await nmu.install(pkg);

      const scopedVfs = vfs.createScopedVFS('dev.nammu.hello');
      await scopedVfs.writeUserData('data.txt', 'Temporary');
      await scopedVfs.writeCache('cache.tmp', 'Cache data');

      await nmu.uninstall('dev.nammu.hello', { purgeUserData: true, purgeCache: true });

      expect(await vfs.exists('/applications/dev.nammu.hello')).toBe(false);
      expect(await vfs.exists('/userdata/dev.nammu.hello')).toBe(false);
      expect(await vfs.exists('/cache/dev.nammu.hello')).toBe(false);
      expect(await db.getApp('dev.nammu.hello')).toBeNull();
    });
  });

  describe('7. App Enable, Disable, and Information Queries', () => {
    it('toggles app enabled/disabled state', async () => {
      const pkg = createHelloNammuPackage();
      await nmu.install(pkg);

      await nmu.disable('dev.nammu.hello');
      let app = await db.getApp('dev.nammu.hello');
      expect(app?.state).toBe('Disabled');

      await nmu.enable('dev.nammu.hello');
      app = await db.getApp('dev.nammu.hello');
      expect(app?.state).toBe('Installed');
    });

    it('reports accurate package metadata and storage usage', async () => {
      const pkg = createHelloNammuPackage();
      await nmu.install(pkg);

      const scopedVfs = vfs.createScopedVFS('dev.nammu.hello');
      await scopedVfs.writeUserData('data.txt', '12345'); // 5 bytes
      await scopedVfs.writeCache('temp.bin', '1234567890'); // 10 bytes

      const info = await nmu.info('dev.nammu.hello');
      expect(info.app.appId).toBe('dev.nammu.hello');
      expect(info.storage.userdata).toBe(5);
      expect(info.storage.cache).toBe(10);
      expect(info.storage.applications).toBeGreaterThan(0);
    });
  });

  describe('8. Cryptographic Package Signing', () => {
    it('installs a valid Ed25519-signed official package', async () => {
      const signedBytes = await createSignedHelloNammuPackage({
        appId: 'os.nammu.officialapp',
        name: 'Nammu Official App',
      });

      const record = await nmu.install(signedBytes);
      expect(record.appId).toBe('os.nammu.officialapp');
      expect(record.signatureVerified).toBe(true);
      expect(record.isOfficial).toBe(true);
    });
  });
});
