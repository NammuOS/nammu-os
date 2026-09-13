import { describe, expect, it } from 'bun:test';
import { CapabilityBroker, type SandboxContext } from '@/platform/sandbox/capabilityBroker';
import { validateNammuAppManifest } from '@/platform/nmu/manifestValidator';
import { InMemoryNammuVFS } from '@/platform/vfs/nammuVFS';
import type { CapabilityDeclaration, PermissionIdentifier } from '@/platform/nmu/nappSpec';
import type {
  PackageLifecycleState,
  PackageSurfaceSnapshot,
} from '@/platform/sandbox/integrationContracts';
import { InMemoryNMUDatabase } from '@/platform/nmu/nmuDatabase';
import { NMUEngine } from '@/platform/nmu/nmuEngine';
import { PublisherKeyring } from '@/platform/nmu/packageSecurity';
import {
  createSignedHelloNammuPackage,
  TEST_NAMMU_KEY_ID,
  TEST_NAMMU_PUBLIC_KEY_HEX,
} from './fixtures/helloNammuFixture';
import { NammuSDKClient, type IPCTransport } from '@/sdk';
import { createPackageServiceRegistry } from '@/platform/sandbox/packageServiceRegistry';
import type { PlatformCapabilities } from '@/platform/contracts';

const capabilities: CapabilityDeclaration[] = [
  { type: 'service', name: 'core.runtime' },
  {
    type: 'web-surface',
    name: 'primary',
    navigation: { mode: 'approved-origins', origins: ['https://example.com'] },
    maxSurfaces: 2,
    persistentProfile: true,
  },
];

async function context(
  instanceId: string,
  permissions: PermissionIdentifier[] = [
    'integration.web-surfaces',
    'integration.services',
    'filesystem.user-selected.read',
    'filesystem.user-selected.write',
  ],
): Promise<SandboxContext> {
  const vfs = new InMemoryNammuVFS();
  await vfs.writeFile(
    `/applications/dev.fixture/versions/1.0.0/runtime/worker.js`,
    'postMessage(1)',
  );
  await vfs.writeFile(
    `/applications/dev.fixture/versions/1.0.0/runtime/module.wasm`,
    Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]),
  );
  await vfs.setActiveAppVersion({
    appId: 'dev.fixture',
    activeVersion: '1.0.0',
    activeVersionDir: '/applications/dev.fixture/versions/1.0.0',
    packageHash: 'a'.repeat(64),
    installedAt: 1,
    lastUpdatedAt: 1,
  });
  return {
    instanceId,
    appId: 'dev.fixture',
    grantedPermissions: new Set(permissions),
    requestedPermissions: new Set(permissions),
    capabilities,
    scopedVfs: vfs.createScopedVFS('dev.fixture'),
  };
}

async function call(broker: CapabilityBroker, ctx: SandboxContext, method: string, params = {}) {
  const response = await broker.handleRequest(ctx, { id: crypto.randomUUID(), method, params });
  if (response.error) throw Object.assign(new Error(response.error.message), response.error);
  return response.result;
}

describe('B0 generic packaged integration runtime', () => {
  it('persists signed integration capabilities as immutable installed authority', async () => {
    const vfs = new InMemoryNammuVFS();
    const db = new InMemoryNMUDatabase();
    const engine = new NMUEngine(
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
    const pkg = await createSignedHelloNammuPackage({
      appId: 'os.nammu.integration-fixture',
      runtime: 'integration',
      permissions: ['integration.web-surfaces', 'integration.services'],
      capabilities,
    });
    const installed = await engine.install(pkg, {
      approvedPermissions: ['integration.web-surfaces', 'integration.services'],
    });
    expect(installed.signatureVerified).toBe(true);
    expect(installed.capabilities).toEqual(capabilities);
    expect((await db.getApp(installed.appId))?.capabilities).toEqual(capabilities);
  });

  it('validates explicit surface policy and rejects ambiguous or local origins', () => {
    const base = {
      manifestVersion: 1 as const,
      id: 'dev.fixture',
      name: 'Fixture',
      version: '1.0.0',
      runtime: 'integration' as const,
      entry: 'app/index.html',
      minNammuVersion: '0.8.0',
      dataSchemaVersion: 1,
      permissions: ['integration.web-surfaces' as const],
      capabilities,
    };
    expect(validateNammuAppManifest(base).valid).toBe(true);
    expect(
      validateNammuAppManifest({
        ...base,
        capabilities: [
          {
            type: 'web-surface',
            name: 'primary',
            navigation: { mode: 'approved-origins', origins: ['http://127.0.0.1:3000'] },
          },
        ],
      }).valid,
    ).toBe(false);
    expect(
      validateNammuAppManifest({
        ...base,
        capabilities: [
          {
            type: 'web-surface',
            name: 'primary',
            navigation: { mode: 'approved-origins', origins: [] },
          },
        ],
      }).valid,
    ).toBe(false);
  });

  it('binds opaque surfaces to one authenticated instance and destroys them on teardown', async () => {
    const states = new Map<string, PackageSurfaceSnapshot>();
    const destroyed: string[] = [];
    const hostOperations: string[] = [];
    const broker = new CapabilityBroker({
      onWebSurfaceCreate: async () => {
        const state = {
          id: `surface_${states.size + 1}`,
          url: 'https://example.com/',
          title: 'Fixture',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          isAudioPlaying: false,
          isMuted: false,
          visible: true,
        };
        states.set(state.id, state);
        return state;
      },
      onWebSurfaceNavigate: async (_, id, url) => {
        states.get(id)!.url = url;
      },
      onWebSurfaceControl: async (_, id, control) => {
        hostOperations.push(`${id}:${control}`);
      },
      onWebSurfaceSetBounds: async (_, id) => {
        hostOperations.push(`${id}:bounds`);
      },
      onWebSurfaceSetVisible: async (_, id, visible) => {
        hostOperations.push(`${id}:visible:${visible}`);
      },
      onWebSurfaceSetZoom: async (_, id, zoom) => {
        hostOperations.push(`${id}:zoom:${zoom}`);
      },
      onWebSurfaceFocus: async (_, id) => {
        hostOperations.push(`${id}:focus`);
      },
      onWebSurfaceGetState: async (_, id) => states.get(id)!,
      onWebSurfaceDestroy: async (_, id) => {
        destroyed.push(id);
        states.delete(id);
      },
    });
    const owner = await context('instance-owner');
    const attacker = await context('instance-attacker');
    broker.registerContext(owner);
    broker.registerContext(attacker);
    owner.capabilities = [
      ...capabilities,
      {
        type: 'web-surface',
        name: 'secondary',
        navigation: { mode: 'public-web' },
        untrustedProxyRouting: true,
      },
    ];
    const surface = await call(broker, owner, 'webSurfaces.create', {
      capability: 'primary',
      profileKey: 'default',
      url: 'https://example.com/',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    await expect(
      call(broker, attacker, 'webSurfaces.getState', { id: surface.id }),
    ).rejects.toMatchObject({ code: 'SURFACE_NOT_OWNED' });
    await expect(
      call(broker, owner, 'webSurfaces.navigate', {
        id: surface.id,
        capability: 'primary',
        url: 'https://evil.example/',
      }),
    ).rejects.toMatchObject({ code: 'NAVIGATION_DENIED' });
    await expect(
      call(broker, owner, 'webSurfaces.navigate', {
        id: surface.id,
        capability: 'secondary',
        url: 'https://evil.example/',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_MISMATCH' });
    await call(broker, owner, 'webSurfaces.navigate', {
      id: surface.id,
      capability: 'primary',
      url: 'https://example.com/next',
    });
    expect((await call(broker, owner, 'webSurfaces.getState', { id: surface.id })).url).toBe(
      'https://example.com/next',
    );
    await call(broker, owner, 'webSurfaces.detach', { id: surface.id });
    await call(broker, owner, 'webSurfaces.attach', {
      id: surface.id,
      bounds: { x: 4, y: 8, width: 640, height: 360 },
    });
    await call(broker, owner, 'webSurfaces.focus', { id: surface.id });
    await call(broker, owner, 'webSurfaces.setZoom', { id: surface.id, zoom: 1.25 });
    await call(broker, owner, 'webSurfaces.control', { id: surface.id, control: 'reload' });
    expect(hostOperations).toEqual([
      `${surface.id}:visible:false`,
      `${surface.id}:bounds`,
      `${surface.id}:visible:true`,
      `${surface.id}:focus`,
      `${surface.id}:zoom:1.25`,
      `${surface.id}:reload`,
    ]);
    await broker.unregisterContext('instance-owner');
    expect(destroyed).toEqual([surface.id]);
  });

  it('keeps optional public-proxy routing capability-bound and rejects private endpoints', async () => {
    const applied: unknown[] = [];
    const ctx = await context('proxy-owner');
    ctx.capabilities = [
      {
        type: 'web-surface',
        name: 'proxy-surface',
        navigation: { mode: 'public-web' },
        untrustedProxyRouting: true,
      },
    ];
    const broker = new CapabilityBroker({
      onWebSurfaceCreate: async () => ({
        id: 'proxy-handle',
        url: 'https://example.com/',
        title: '',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isAudioPlaying: false,
        isMuted: false,
        visible: true,
      }),
      onWebSurfaceSetProxyRoute: async (_, id, scope, endpoints) => {
        applied.push({ id, scope, endpoints });
      },
    });
    broker.registerContext(ctx);
    const surface = await call(broker, ctx, 'webSurfaces.create', {
      capability: 'proxy-surface',
      url: 'https://example.com/',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    await call(broker, ctx, 'webSurfaces.setProxyRoute', {
      id: surface.id,
      scope: 'surface',
      endpoints: [{ protocol: 'https', host: '1.1.1.1', port: 443 }],
    });
    expect(applied).toHaveLength(1);
    await expect(
      call(broker, ctx, 'webSurfaces.setProxyRoute', {
        id: surface.id,
        scope: 'surface',
        endpoints: [{ protocol: 'http', host: '127.0.0.1', port: 3000 }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('denies undeclared permissions and service identities', async () => {
    const ctx = await context('instance', []);
    const broker = new CapabilityBroker({
      onServiceRequest: async () => ({ status: 200, data: { ok: true } }),
    });
    broker.registerContext(ctx);
    await expect(
      call(broker, ctx, 'services.request', { service: 'core.runtime', operation: 'describe' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    ctx.grantedPermissions.add('integration.services');
    await expect(
      call(broker, ctx, 'services.request', { service: 'secret.internal', operation: 'read' }),
    ).rejects.toMatchObject({ code: 'UNDECLARED_CAPABILITY' });
  });

  it('exposes Browser services as validated named operations rather than raw URLs', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const platform = {
      runtime: 'web',
      webSurfaces: { supported: true },
      services: {
        async ready() {
          return { runtime: 'web', origin: 'https://nammu.invalid', instanceId: null } as const;
        },
        async request(path: string, init?: RequestInit) {
          requests.push({ path, init });
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        async wispUrl() {
          throw new Error('Packages do not receive Wisp authority.');
        },
      },
    } as unknown as PlatformCapabilities;
    const registry = createPackageServiceRegistry(platform);

    await registry.request('browser.search', 'suggest', { query: 'nammu browser' });
    await registry.request('browser.public-proxies', 'discover', {
      protocol: 'https',
      country: 'in',
      limit: 20,
      refresh: true,
    });
    await registry.request('browser.public-proxies', 'check', {
      ids: ['proxy-one'],
      targetUrl: 'https://example.com',
    });

    expect(requests.map(({ path }) => path)).toEqual([
      '/api/browser/search?q=nammu%20browser',
      '/api/browser/public-proxies?protocol=https&country=IN&limit=20&refresh=1',
      '/api/browser/public-proxies/check',
    ]);
    expect(requests[2].init?.method).toBe('POST');
    await expect(
      registry.request('browser.public-proxies', 'check', {
        ids: ['proxy-one'],
        targetUrl: 'http://127.0.0.1:3000',
      }),
    ).rejects.toThrow('invalid');
    await expect(registry.request('browser.search', 'raw-fetch', {})).rejects.toThrow(
      'unavailable',
    );
  });

  it('enforces service request and response limits at the broker boundary', async () => {
    const ctx = await context('instance');
    const broker = new CapabilityBroker({
      onServiceRequest: async (_, __, request) => ({
        status: 200,
        data:
          request.operation === 'oversized-response'
            ? 'x'.repeat(4 * 1024 * 1024 + 1)
            : { ok: true },
      }),
    });
    broker.registerContext(ctx);
    await expect(
      call(broker, ctx, 'services.request', {
        service: 'core.runtime',
        operation: 'describe',
        payload: 'x'.repeat(256 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    await expect(
      call(broker, ctx, 'services.request', {
        service: 'core.runtime',
        operation: 'oversized-response',
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
  });

  it('delivers lifecycle only to the owning context', async () => {
    const ownerEvents: unknown[] = [];
    const otherEvents: unknown[] = [];
    const owner = await context('owner');
    const other = await context('other');
    owner.postMessage = (message) => ownerEvents.push(message);
    other.postMessage = (message) => otherEvents.push(message);
    const broker = new CapabilityBroker();
    broker.registerContext(owner);
    broker.registerContext(other);
    const state: PackageLifecycleState = {
      phase: 'background',
      visible: true,
      focused: false,
      active: false,
      suspended: false,
    };
    broker.updateLifecycle('owner', state);
    expect(await call(broker, owner, 'lifecycle.getState')).toEqual(state);
    broker.updateLifecycle('owner', {
      phase: 'suspended',
      visible: false,
      focused: false,
      active: false,
      suspended: true,
    });
    broker.updateLifecycle('owner', {
      phase: 'active',
      visible: true,
      focused: true,
      active: true,
      suspended: false,
    });
    expect(ownerEvents.map((event: any) => event.payload.phase)).toEqual([
      'background',
      'suspended',
      'active',
    ]);
    expect(otherEvents).toHaveLength(0);
  });

  it('loads worker/WASM assets only through the scoped package path', async () => {
    const ctx = await context('instance');
    const broker = new CapabilityBroker();
    broker.registerContext(ctx);
    const worker = await call(broker, ctx, 'assets.read', { path: 'runtime/worker.js' });
    expect(new TextDecoder().decode(worker.bytes)).toBe('postMessage(1)');
    const wasm = await call(broker, ctx, 'assets.read', { path: 'runtime/module.wasm' });
    await expect(WebAssembly.compile(wasm.bytes)).resolves.toBeDefined();
    await expect(
      call(broker, ctx, 'assets.read', { path: '../userdata/secrets' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('keeps binary pick/save user-mediated and bounded', async () => {
    let picks = 0;
    let saves = 0;
    const ctx = await context('instance');
    const broker = new CapabilityBroker({
      onPickBinaryFiles: async () => {
        picks += 1;
        return {
          cancelled: false,
          files: [
            {
              name: 'bookmarks.json',
              mimeType: 'application/json',
              size: 2,
              bytes: Uint8Array.of(123, 125),
            },
          ],
        };
      },
      onSaveBinaryFile: async () => {
        saves += 1;
        return { saved: true, fileName: 'download.bin' };
      },
    });
    broker.registerContext(ctx);
    expect((await call(broker, ctx, 'files.pickBinary')).files[0].name).toBe('bookmarks.json');
    await call(broker, ctx, 'files.saveBinary', {
      suggestedName: 'download.bin',
      bytes: Uint8Array.of(1, 2, 3),
    });
    expect({ picks, saves }).toEqual({ picks: 1, saves: 1 });
    await expect(
      call(broker, ctx, 'files.saveBinary', {
        suggestedName: 'too-large.bin',
        bytes: new Uint8Array(32 * 1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('exposes integration operations only through SDK RPC', async () => {
    let listener: ((message: any) => void) | undefined;
    const calls: Array<{ method: string; params: any }> = [];
    const transport: IPCTransport = {
      send(request) {
        calls.push({ method: request.method, params: request.params });
        queueMicrotask(() => {
          const result =
            request.method === 'webSurfaces.create'
              ? {
                  id: 'opaque',
                  url: request.params.url,
                  title: '',
                  isLoading: false,
                  canGoBack: false,
                  canGoForward: false,
                  isAudioPlaying: false,
                  isMuted: false,
                  visible: true,
                }
              : request.method === 'assets.read'
                ? { bytes: Uint8Array.of(1, 2), size: 2 }
                : { data: { runtime: 'web' } };
          listener?.({ id: request.id, result });
        });
      },
      onMessage(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    };
    const sdk = new NammuSDKClient({ appId: 'dev.fixture', instanceId: 'one', transport });
    expect(await sdk.assets.read('runtime/module.wasm')).toEqual(Uint8Array.of(1, 2));
    expect(await sdk.services.request<{ runtime: string }>('core.runtime', 'describe')).toEqual({
      runtime: 'web',
    });
    const surface = await sdk.webSurfaces.create({
      capability: 'primary',
      url: 'https://example.com/',
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    });
    const popupUrls: string[] = [];
    surface.onOpenRequest((url) => popupUrls.push(url));
    await surface.navigate('https://example.com/next');
    await surface.setZoom(1.2);
    listener?.({
      type: 'event',
      eventName: 'system.web-surface-open.opaque',
      payload: { id: 'opaque', url: 'https://example.com/popup' },
    });
    expect(popupUrls).toEqual(['https://example.com/popup']);
    expect(calls.map((call) => call.method)).toEqual([
      'assets.read',
      'services.request',
      'webSurfaces.create',
      'webSurfaces.navigate',
      'webSurfaces.setZoom',
    ]);
    expect(JSON.stringify(calls)).not.toContain('TAURI');
    sdk.dispose();
  });
});
