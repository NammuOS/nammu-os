import { describe, it, expect, beforeEach } from 'bun:test';
import { packNapp, unpackNapp } from '@/platform/nmu/nappArchive';
import { InMemoryNammuVFS } from '@/platform/vfs/nammuVFS';
import { InMemoryNMUDatabase } from '@/platform/nmu/nmuDatabase';
import { NMUEngine } from '@/platform/nmu/nmuEngine';
import {
  getPublisherKeyring,
  OFFICIAL_NAMMU_KEY_ID,
  OFFICIAL_NAMMU_PUBLIC_KEY_HEX,
  PublisherKeyring,
} from '@/platform/nmu/packageSecurity';
import { CapabilityBroker, type SandboxContext } from '@/platform/sandbox/capabilityBroker';
import {
  createHelloNammuPackage,
  createSignedHelloNammuPackage,
  createHelloNammuManifest,
  TEST_NAMMU_KEY_ID,
  TEST_NAMMU_PUBLIC_KEY_HEX,
} from './fixtures/helloNammuFixture';
import type { PermissionIdentifier } from '@/platform/nmu/nappSpec';

describe('Nammu Package Manager - Adversarial & Failure Injection Suite', () => {
  let vfs: InMemoryNammuVFS;
  let db: InMemoryNMUDatabase;
  let keyring: PublisherKeyring;
  let nmu: NMUEngine;

  beforeEach(() => {
    vfs = new InMemoryNammuVFS();
    db = new InMemoryNMUDatabase();
    keyring = new PublisherKeyring([
      {
        keyId: TEST_NAMMU_KEY_ID,
        publisher: 'nammu-official',
        publicKeyRawHex: TEST_NAMMU_PUBLIC_KEY_HEX,
        authorizedNamespaces: ['os.nammu.*'],
      },
    ]);
    nmu = new NMUEngine(vfs, db, keyring);
  });

  describe('1. Zip-Slip & Path Traversal Protections', () => {
    it('rejects archives containing relative directory traversal (..)', async () => {
      const encoder = new TextEncoder();
      const manifest = createHelloNammuManifest();

      expect(() => {
        packNapp([
          { path: 'nammu.app.json', data: encoder.encode(JSON.stringify(manifest)) },
          { path: '../../userdata/dev.nammu.hello/escaped.txt', data: encoder.encode('PWNED') },
        ]);
      }).toThrow(/Directory traversal segment "\.\." prohibited/);
    });

    it('rejects archives containing absolute paths or leading slashes', () => {
      const encoder = new TextEncoder();
      const manifest = createHelloNammuManifest();

      expect(() => {
        packNapp([
          { path: 'nammu.app.json', data: encoder.encode(JSON.stringify(manifest)) },
          { path: '/etc/shadow', data: encoder.encode('PWNED') },
        ]);
      }).toThrow(/Absolute path prohibited/);
    });

    it('rejects archives containing Windows drive letter paths', () => {
      const encoder = new TextEncoder();
      const manifest = createHelloNammuManifest();

      expect(() => {
        packNapp([
          { path: 'nammu.app.json', data: encoder.encode(JSON.stringify(manifest)) },
          { path: 'C:/Windows/System32/evil.dll', data: encoder.encode('PWNED') },
        ]);
      }).toThrow(/Drive letter specification prohibited/);
    });

    it('rejects archives with duplicate file paths', () => {
      const encoder = new TextEncoder();
      const manifest = createHelloNammuManifest();

      expect(() => {
        packNapp([
          { path: 'nammu.app.json', data: encoder.encode(JSON.stringify(manifest)) },
          { path: 'app/main.js', data: encoder.encode('v1') },
          { path: 'app/main.js', data: encoder.encode('v2') },
        ]);
      }).toThrow(/Duplicate file path/);
    });

    it('rejects archives with trailing injected garbage data', async () => {
      const validPkg = createHelloNammuPackage();
      const maliciousPkg = new Uint8Array(validPkg.length + 32);
      maliciousPkg.set(validPkg, 0);
      maliciousPkg.set(
        new TextEncoder().encode('INJECTED_TRAILING_PAYLOAD_BYTES!'),
        validPkg.length,
      );

      await expect(unpackNapp(maliciousPkg)).rejects.toThrow(/archive size mismatch/);
    });
  });

  describe('2. Cryptographic Trust & Namespace Authorization', () => {
    it('ships only the rotated official public verification identity', () => {
      const officialKey = getPublisherKeyring().getKey(OFFICIAL_NAMMU_KEY_ID);

      expect(OFFICIAL_NAMMU_KEY_ID).toBe('nammu-official-2026-09');
      expect(OFFICIAL_NAMMU_PUBLIC_KEY_HEX).toMatch(/^[a-f0-9]{64}$/);
      expect(officialKey).toEqual({
        keyId: OFFICIAL_NAMMU_KEY_ID,
        publisher: 'nammu-official',
        publicKeyRawHex: OFFICIAL_NAMMU_PUBLIC_KEY_HEX,
        authorizedNamespaces: ['os.nammu.*'],
      });
    });

    it('rejects unsigned packages attempting to register under os.nammu.*', async () => {
      const unsignedOfficialPkg = createHelloNammuPackage({
        appId: 'os.nammu.privileged',
        name: 'Spoofed Official App',
      });

      await expect(nmu.install(unsignedOfficialPkg)).rejects.toThrow(
        /Unauthorized official package/,
      );
    });

    it('rejects packages with tampered file content or forged signature digest', async () => {
      const signedBytes = await createSignedHelloNammuPackage({
        appId: 'os.nammu.terminal',
        name: 'Official Terminal',
      });

      const unpacked = await unpackNapp(signedBytes);
      // Tamper with index.html content
      unpacked.files.set('app/index.html', new TextEncoder().encode('TAMPERED_CONTENT_MALICIOUS'));

      const fileEntries = Array.from(unpacked.files.entries()).map(([path, data]) => ({
        path,
        data,
      }));
      // Repack with original signature.json but modified content
      const tamperedPkg = packNapp(fileEntries);

      await expect(nmu.install(tamperedPkg)).rejects.toThrow(/Signature digest mismatch/i);
    });

    it('rejects unauthorized publisher key claiming official namespace', async () => {
      // Key that is not registered for os.nammu.*
      const fakeSignedBytes = await createSignedHelloNammuPackage({
        appId: 'os.nammu.browser',
        publisherKeyId: 'unauthorized-random-key',
      });

      await expect(nmu.install(fakeSignedBytes)).rejects.toThrow(/Unauthorized official package/);
    });

    it('binds manifest publisher identity to the verified signature envelope', async () => {
      const signed = await createSignedHelloNammuPackage({
        appId: 'os.nammu.identity',
        publisher: 'nammu-official',
      });
      const unpacked = await unpackNapp(signed);
      const signature = JSON.parse(new TextDecoder().decode(unpacked.files.get('signature.json')!));
      signature.publisher = 'attacker-controlled';
      unpacked.files.set('signature.json', new TextEncoder().encode(JSON.stringify(signature)));
      const repacked = packNapp(Array.from(unpacked.files, ([path, data]) => ({ path, data })));

      await expect(nmu.install(repacked)).rejects.toThrow(/publisher identity does not match/i);
    });
  });

  describe('3. Publisher Key Continuity on Update', () => {
    it('blocks update if the package publisherKeyId changes without authorization', async () => {
      // 1. Install official app signed with official key
      const initialBytes = await createSignedHelloNammuPackage({
        appId: 'os.nammu.notes',
        version: '1.0.0',
      });
      await nmu.install(initialBytes);

      // 2. Attempt update signed with a different key ID
      const tamperedUpdateBytes = await createSignedHelloNammuPackage({
        appId: 'os.nammu.notes',
        version: '1.1.0',
        publisherKeyId: 'rogue-key-id',
      });

      await expect(nmu.update('os.nammu.notes', tamperedUpdateBytes)).rejects.toThrow(
        /Unauthorized official package|Verified publisher identity changed/,
      );
    });
  });

  describe('4. Permission Escalation Prevention on Update', () => {
    it('does not automatically grant newly requested sensitive permissions during update', async () => {
      // 1. Install v1.0.0 requesting only appdata filesystem
      const v1Pkg = createHelloNammuPackage({
        version: '1.0.0',
        permissions: ['filesystem.appdata.write', 'filesystem.appdata.read'],
      });
      await nmu.install(v1Pkg);

      // 2. Update to v1.1.0 requesting new sensitive permissions: notifications and clipboard
      const v2Pkg = createHelloNammuPackage({
        version: '1.1.0',
        permissions: [
          'filesystem.appdata.write',
          'filesystem.appdata.read',
          'notifications.send',
          'clipboard.read',
        ],
      });

      // Update without explicit approval for sensitive permissions
      const updated = await nmu.update('dev.nammu.hello', v2Pkg, { skipHealthCheck: true });

      expect(updated.requestedPermissions).toContain('notifications.send');
      expect(updated.requestedPermissions).toContain('clipboard.read');
      // Crucial: granted permissions MUST NOT include the newly requested sensitive permissions
      expect(updated.grantedPermissions).not.toContain('notifications.send');
      expect(updated.grantedPermissions).not.toContain('clipboard.read');
      expect(updated.grantedPermissions).toContain('filesystem.appdata.write');
    });
  });

  describe('5. Health-Check Activation Timeout & Automatic Rollback', () => {
    it('automatically triggers rollback if application fails to acknowledge startup readiness', async () => {
      // 1. Install v1.0.0
      const v1Pkg = createHelloNammuPackage({ version: '1.0.0', dataSchemaVersion: 1 });
      await nmu.install(v1Pkg);
      nmu = new NMUEngine(vfs, db, keyring, { healthCheckTimeoutMs: 10 });
      await nmu.ready();

      const scopedVfs = vfs.createScopedVFS('dev.nammu.hello');
      await scopedVfs.writeUserData('app.state', 'v1_stable_data');

      // 2. Update to v2.0.0 with dataSchemaVersion 2 (entering 'Activating' state)
      const v2Pkg = createHelloNammuPackage({ version: '2.0.0', dataSchemaVersion: 2 });
      const updatingRecord = await nmu.update('dev.nammu.hello', v2Pkg, {
        skipHealthCheck: false,
      });

      expect(updatingRecord.state).toBe('Activating');
      expect(updatingRecord.version).toBe('2.0.0');

      // The production timer must perform rollback without a direct rollback call.
      await new Promise((resolve) => setTimeout(resolve, 30));

      const appAfterRollback = await db.getApp('dev.nammu.hello');
      expect(appAfterRollback?.version).toBe('1.0.0');
      expect(appAfterRollback?.activeVersion).toBe('1.0.0');

      // Verify active version pointer restored
      const activePointer = await vfs.getActiveAppVersion('dev.nammu.hello');
      expect(activePointer?.activeVersion).toBe('1.0.0');

      // Verify userdata was restored
      expect(await scopedVfs.readUserDataText('app.state')).toBe('v1_stable_data');
    });

    it('recovers an unfinished activation after a runtime restart with complete metadata', async () => {
      await nmu.install(createHelloNammuPackage({ version: '1.0.0', entry: 'app/index.html' }));
      const previous = await db.getApp('dev.nammu.hello');
      const update = createHelloNammuPackage({
        version: '2.0.0',
        entry: 'app/v2.html',
        customFiles: { 'app/v2.html': '<h1>candidate</h1>' },
      });
      await nmu.update('dev.nammu.hello', update);
      const journal = await db.getActivation('dev.nammu.hello');
      expect(journal?.status).toBe('activating');

      const restarted = new NMUEngine(vfs, db, keyring, {
        now: () => (journal?.deadline ?? 0) + 1,
      });
      await restarted.ready();
      const recovered = await db.getApp('dev.nammu.hello');
      const pointer = await vfs.getActiveAppVersion('dev.nammu.hello');
      expect(recovered?.version).toBe('1.0.0');
      expect(recovered?.entry).toBe(previous?.entry);
      expect(recovered?.packageHash).toBe(previous?.packageHash);
      expect(pointer?.packageHash).toBe(previous?.packageHash);
      expect(await db.getActivation('dev.nammu.hello')).toBeNull();
    });
  });

  describe('6. Multi-Window Independence at CapabilityBroker Level', () => {
    it('maintains independent context lifecycles for multiple windows of the same app', async () => {
      const broker = new CapabilityBroker();
      const scopedVfs = vfs.createScopedVFS('os.nammu.browser');

      const window1Ctx: SandboxContext = {
        instanceId: 'inst_browser_window_1',
        appId: 'os.nammu.browser',
        windowId: 'win_1',
        grantedPermissions: new Set<PermissionIdentifier>(['window.manage']),
        requestedPermissions: new Set<PermissionIdentifier>(['window.manage']),
        scopedVfs,
      };

      const window2Ctx: SandboxContext = {
        instanceId: 'inst_browser_window_2',
        appId: 'os.nammu.browser',
        windowId: 'win_2',
        grantedPermissions: new Set<PermissionIdentifier>(['window.manage']),
        requestedPermissions: new Set<PermissionIdentifier>(['window.manage']),
        scopedVfs,
      };

      broker.registerContext(window1Ctx);
      broker.registerContext(window2Ctx);

      expect(broker.getInstancesForApp('os.nammu.browser').length).toBe(2);

      // Close window 1
      broker.unregisterContext('inst_browser_window_1');

      // Window 1 context is gone
      expect(broker.getContext('inst_browser_window_1')).toBeUndefined();
      // Window 2 context is STILL intact and active!
      expect(broker.getContext('inst_browser_window_2')).toBeDefined();
      expect(broker.getInstancesForApp('os.nammu.browser').length).toBe(1);

      // Window 2 can still execute IPC calls
      const res = await broker.handleRequest(window2Ctx, {
        id: 'req_1',
        method: 'window.setTitle',
        params: { title: 'Window 2 Tab' },
      });
      expect(res.result?.success).toBe(true);
    });
  });

  describe('7. Event System Security & Namespace Enforcement', () => {
    it('strictly prevents sandboxed applications from emitting into reserved system.* namespace', async () => {
      const broker = new CapabilityBroker();
      const scopedVfs = vfs.createScopedVFS('dev.evil.app');
      const evilCtx: SandboxContext = {
        instanceId: 'inst_evil_1',
        appId: 'dev.evil.app',
        grantedPermissions: new Set<PermissionIdentifier>(),
        requestedPermissions: new Set<PermissionIdentifier>(),
        scopedVfs,
      };
      broker.registerContext(evilCtx);

      const spoofAttempt = await broker.handleRequest(evilCtx, {
        id: 'req_spoof',
        method: 'events.emit',
        params: {
          eventName: 'system.theme.change',
          payload: { malicious: true },
        },
      });

      expect(spoofAttempt.error?.code).toBe('RESERVED_EVENT_NAMESPACE');
      expect(spoofAttempt.error?.message).toContain(
        'prohibited from emitting into the reserved "system.*" namespace',
      );
    });

    it('automatically scopes app-emitted events to app.<appId>.*', async () => {
      const broker = new CapabilityBroker();
      const scopedVfs = vfs.createScopedVFS('dev.author.notes');
      const notesCtx: SandboxContext = {
        instanceId: 'inst_notes_1',
        appId: 'dev.author.notes',
        grantedPermissions: new Set<PermissionIdentifier>(),
        requestedPermissions: new Set<PermissionIdentifier>(),
        scopedVfs,
      };
      broker.registerContext(notesCtx);

      const res = await broker.handleRequest(notesCtx, {
        id: 'req_emit',
        method: 'events.emit',
        params: {
          eventName: 'noteCreated',
          payload: { id: 1 },
        },
      });

      expect(res.result?.emitted).toBe(true);
      expect(res.result?.eventName).toBe('app.dev.author.notes.noteCreated');
    });

    it('denies system and cross-application subscriptions without declared grants', async () => {
      const broker = new CapabilityBroker();
      const context: SandboxContext = {
        instanceId: 'inst_subscriber',
        appId: 'dev.reader.app',
        grantedPermissions: new Set(),
        requestedPermissions: new Set(),
        scopedVfs: vfs.createScopedVFS('dev.reader.app'),
      };
      broker.registerContext(context);
      const system = await broker.handleRequest(context, {
        id: 'system',
        method: 'events.subscribe',
        params: { eventName: 'system.account.changed' },
      });
      const foreign = await broker.handleRequest(context, {
        id: 'foreign',
        method: 'events.subscribe',
        params: { eventName: 'app.dev.other.private' },
      });
      expect(system.error?.code).toBe('PERMISSION_DENIED');
      expect(foreign.error?.code).toBe('PERMISSION_DENIED');
    });

    it('allows own-app subscriptions and explicitly granted event capabilities', async () => {
      const broker = new CapabilityBroker();
      const permissions = new Set<PermissionIdentifier>([
        'events.system.subscribe',
        'events.cross-app.subscribe',
      ]);
      const context: SandboxContext = {
        instanceId: 'inst_allowed',
        appId: 'dev.reader.app',
        grantedPermissions: permissions,
        requestedPermissions: new Set(permissions),
        scopedVfs: vfs.createScopedVFS('dev.reader.app'),
      };
      broker.registerContext(context);
      for (const eventName of ['own-event', 'system.account.changed', 'app.dev.other.public']) {
        const response = await broker.handleRequest(context, {
          id: eventName,
          method: 'events.subscribe',
          params: { eventName },
        });
        expect(response.error).toBeUndefined();
      }
    });
  });

  describe('8. Runtime permission declaration boundary', () => {
    it('rejects unknown and undeclared runtime permission requests', async () => {
      await nmu.install(createHelloNammuPackage({ permissions: ['filesystem.appdata.read'] }));
      await expect(
        nmu.grantRuntimePermission('dev.nammu.hello', 'clipboard.write'),
      ).rejects.toThrow(/was not declared/);

      const broker = new CapabilityBroker({ onRequestPermission: async () => true });
      const context: SandboxContext = {
        instanceId: 'inst_permissions',
        appId: 'dev.nammu.hello',
        grantedPermissions: new Set(),
        requestedPermissions: new Set(['filesystem.appdata.read']),
        scopedVfs: vfs.createScopedVFS('dev.nammu.hello'),
      };
      expect(
        (
          await broker.handleRequest(context, {
            id: 'unknown',
            method: 'permissions.request',
            params: { permission: 'shell.execute' },
          })
        ).error?.code,
      ).toBe('UNKNOWN_PERMISSION');
      expect(
        (
          await broker.handleRequest(context, {
            id: 'undeclared',
            method: 'permissions.request',
            params: { permission: 'clipboard.write' },
          })
        ).error?.code,
      ).toBe('UNDECLARED_PERMISSION');
    });
  });

  describe('9. Hardened Repair Verification', () => {
    it('rejects repair when package ID does not match installed application', async () => {
      const pkgBytes = createHelloNammuPackage();
      await nmu.install(pkgBytes);

      const foreignPkg = createHelloNammuPackage({
        appId: 'dev.other.app',
        name: 'Other App',
      });

      await expect(nmu.repair('dev.nammu.hello', foreignPkg)).rejects.toThrow(
        /match the installed application ID/,
      );
    });
  });

  describe('10. Immutable versions and explicit downgrade', () => {
    it('rejects equal/older updates and preserves immutable version payloads', async () => {
      await nmu.install(createHelloNammuPackage({ version: '1.0.0' }));
      await expect(
        nmu.update('dev.nammu.hello', createHelloNammuPackage({ version: '1.0.0' })),
      ).rejects.toThrow(/not newer/);
      await nmu.update('dev.nammu.hello', createHelloNammuPackage({ version: '2.0.0' }), {
        skipHealthCheck: true,
      });
      await expect(
        nmu.update('dev.nammu.hello', createHelloNammuPackage({ version: '1.0.0' })),
      ).rejects.toThrow(/not newer/);
      expect(await vfs.exists('/applications/dev.nammu.hello/versions/1.0.0/app/index.html')).toBe(
        true,
      );
      const downgraded = await nmu.downgrade('dev.nammu.hello', '1.0.0');
      expect(downgraded.version).toBe('1.0.0');
    });
  });
});
