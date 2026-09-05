import { describe, expect, test } from 'bun:test';
import { getPlatformCapabilities } from '../src/platform';
import {
  createTauriPlatformCapabilities,
  createTauriPlatformServices,
  type TauriCapabilityEnvironment,
} from '../src/platform/tauri';
import { createWebPlatformCapabilities, type WebPlatformEnvironment } from '../src/platform/web';

const unavailableWebEnvironment: WebPlatformEnvironment = {
  getWindow: () => undefined,
  getDocument: () => undefined,
  getNavigator: () => undefined,
  getNotification: () => undefined,
  getUrl: () => undefined,
};

function tauriEnvironment(
  overrides: Partial<TauriCapabilityEnvironment> = {},
): TauriCapabilityEnvironment {
  return {
    listNativeFileRoots: async () => ({
      status: 'success',
      value: { roots: [], durationMs: 0 },
    }),
    listNativeDirectory: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'The requested item no longer exists.' },
    }),
    statNativeFile: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'The requested item no longer exists.' },
    }),
    createNativeDirectory: async () => ({
      status: 'error',
      error: { code: 'ACCESS_DENIED', message: 'The folder could not be created.' },
    }),
    createNativeFile: async () => ({
      status: 'error',
      error: { code: 'ACCESS_DENIED', message: 'The file could not be created.' },
    }),
    renameNativeFile: async () => ({
      status: 'error',
      error: { code: 'ACCESS_DENIED', message: 'The item could not be renamed.' },
    }),
    startNativeCopy: async () => ({
      status: 'error',
      error: { code: 'ACCESS_DENIED', message: 'The item could not be copied.' },
    }),
    startNativeMove: async () => ({
      status: 'error',
      error: { code: 'ACCESS_DENIED', message: 'The item could not be moved.' },
    }),
    startNativeDuplicate: async () => ({
      status: 'error',
      error: { code: 'ACCESS_DENIED', message: 'The item could not be duplicated.' },
    }),
    getNativeFileOperation: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'The operation is unavailable.' },
    }),
    cancelNativeFileOperation: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'The operation is unavailable.' },
    }),
    startNativeTrash: async () => ({
      status: 'error',
      error: { code: 'ACCESS_DENIED', message: 'The item could not be recycled.' },
    }),
    startNativePermanentDelete: async () => ({
      status: 'error',
      error: { code: 'ACCESS_DENIED', message: 'The item could not be deleted.' },
    }),
    startNativeRestore: async () => ({
      status: 'error',
      error: { code: 'UNDO_UNAVAILABLE', message: 'The operation is unavailable.' },
    }),
    getNativeDeletionOperation: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'The operation is unavailable.' },
    }),
    cancelNativeDeletionOperation: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'The operation is unavailable.' },
    }),
    pickFile: async () => null,
    saveFile: async () => null,
    readFile: async () => new Uint8Array(),
    writeFile: async () => undefined,
    openUrl: async () => undefined,
    readClipboardText: async () => '',
    writeClipboardText: async () => undefined,
    isNotificationPermissionGranted: async () => false,
    requestNotificationPermission: async () => 'denied',
    sendNotification: () => undefined,
    minimizeWindow: async () => undefined,
    toggleMaximizeWindow: async () => undefined,
    closeWindow: async () => undefined,
    ...overrides,
  };
}

describe('platform capabilities', () => {
  test('selects stable providers with the same capability shape', () => {
    const firstWeb = getPlatformCapabilities('web');
    const secondWeb = getPlatformCapabilities('web');
    const tauri = getPlatformCapabilities('tauri');

    expect(firstWeb).toBe(secondWeb);
    expect(firstWeb.runtime).toBe('web');
    expect(tauri.runtime).toBe('tauri');
    expect(Object.keys(firstWeb).sort()).toEqual(Object.keys(tauri).sort());
    expect(Object.keys(firstWeb.services).sort()).toEqual(['ready', 'request', 'wispUrl']);
    expect(Object.keys(firstWeb.webSurfaces).sort()).toEqual(Object.keys(tauri.webSurfaces).sort());
    expect(Object.keys(firstWeb.filesystem).sort()).toEqual([
      'cancelDeletionOperation',
      'cancelOperation',
      'copy',
      'createDirectory',
      'createFile',
      'duplicate',
      'getDeletionOperation',
      'getOperation',
      'listDirectory',
      'listRoots',
      'move',
      'permanentlyDelete',
      'rename',
      'restore',
      'stat',
      'supported',
      'trash',
    ]);
    expect(Object.keys(firstWeb.files).sort()).toEqual(['pick', 'save']);
    expect(Object.keys(firstWeb.external)).toEqual(['openUrl']);
    expect(Object.keys(firstWeb.clipboard).sort()).toEqual(['readText', 'writeText']);
    expect(Object.keys(firstWeb.notifications).sort()).toEqual(['requestPermission', 'show']);
    expect(Object.keys(firstWeb.window).sort()).toEqual(['close', 'minimize', 'toggleMaximize']);
  });

  test('uses same-origin web services without desktop authorization', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const platform = createWebPlatformCapabilities({
      ...unavailableWebEnvironment,
      getLocationOrigin: () => 'https://nammu.example',
      getFetch: () => async (input, init) => {
        requests.push({ input, init });
        return new Response('{}', { status: 200 });
      },
    });

    expect(await platform.services.ready()).toEqual({
      runtime: 'web',
      origin: 'https://nammu.example',
      instanceId: null,
    });
    await platform.services.request('/api/health');
    expect(requests[0]?.input).toBe('/api/health');
    expect(requests[0]?.init?.credentials).toBe('same-origin');
    expect(new Headers(requests[0]?.init?.headers).has('x-nammu-request')).toBe(false);
  });

  test('keeps the reusable desktop capability inside Rust and attaches only a request proof', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const origin = 'http://127.0.0.1:43127';
    const services = createTauriPlatformServices({
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        commands.push({ command, args });
        if (command === 'get_local_service_info') {
          return { origin, instanceId: 'a'.repeat(32) } as T;
        }
        return { origin, token: 'one-time-proof', expiresAt: Date.now() + 10_000 } as T;
      },
      fetch: async (input, init) => {
        requests.push({ input, init });
        return { url: String(input), status: 200 } as Response;
      },
    });

    await services.ready();
    await services.request('/api/health', {
      headers: { 'x-nammu-request': 'caller-controlled-value' },
    });

    expect(commands).toEqual([
      { command: 'get_local_service_info', args: undefined },
      {
        command: 'authorize_local_request',
        args: { method: 'GET', pathAndQuery: '/api/health' },
      },
    ]);
    expect(requests[0]?.input).toBe(`${origin}/api/health`);
    expect(requests[0]?.init?.credentials).toBe('omit');
    expect(requests[0]?.init?.redirect).toBe('error');
    expect(new Headers(requests[0]?.init?.headers).get('x-nammu-request')).toBe('one-time-proof');
  });

  test('fails closed instead of exposing a Desktop Wisp endpoint', async () => {
    const commands: string[] = [];
    const services = createTauriPlatformServices({
      invoke: async <T>(command: string) => {
        commands.push(command);
        throw new Error(`Unexpected command: ${command}`);
      },
      fetch: async () => {
        throw new Error('Wisp discovery must not use HTTP.');
      },
    });

    await expect(services.wispUrl()).rejects.toThrow('unavailable in the Desktop runtime');
    expect(commands).toEqual([]);
  });

  test('rejects absolute or non-API service targets before invoking a transport', async () => {
    const services = createTauriPlatformServices({
      invoke: async () => {
        throw new Error('IPC should not be called for an invalid target.');
      },
      fetch: async () => {
        throw new Error('Fetch should not be called for an invalid target.');
      },
    });

    await expect(services.request('https://example.com/api/health')).rejects.toThrow(
      'relative /api/ path',
    );
    await expect(services.request('/firefox-wisp/secret')).rejects.toThrow('relative /api/ path');
    await expect(services.request('/api/health#fragment')).rejects.toThrow('relative /api/ path');
  });

  test('returns deterministic unsupported results without browser globals', async () => {
    const platform = createWebPlatformCapabilities(unavailableWebEnvironment);

    expect(await platform.files.pick()).toEqual({
      status: 'unsupported',
      reason: 'File selection requires a browser document.',
    });
    expect(await platform.filesystem.listRoots()).toEqual({
      status: 'unsupported',
      reason: 'This PC is available only in the Nammu desktop application.',
    });
    expect(await platform.filesystem.createDirectory('C:\\', 'Folder')).toEqual({
      status: 'unsupported',
      reason: 'This PC is available only in the Nammu desktop application.',
    });
    expect(await platform.filesystem.trash(['C:\\fixture.txt'])).toEqual({
      status: 'unsupported',
      reason: 'This PC is available only in the Nammu desktop application.',
    });
    expect(await platform.filesystem.permanentlyDelete(['C:\\fixture.txt'], true)).toEqual({
      status: 'unsupported',
      reason: 'This PC is available only in the Nammu desktop application.',
    });
    expect(await platform.clipboard.readText()).toEqual({
      status: 'unsupported',
      reason: 'Clipboard reading is not available.',
    });
    expect(await platform.notifications.requestPermission()).toEqual({
      status: 'unsupported',
      reason: 'Notifications are not available.',
    });
    expect(await platform.window.minimize()).toEqual({
      status: 'unsupported',
      reason: 'Browsers cannot minimize their containing window.',
    });
  });

  test('uses the browser clipboard implementation when available', async () => {
    let clipboardText = 'initial';
    const platform = createWebPlatformCapabilities({
      ...unavailableWebEnvironment,
      getNavigator: () =>
        ({
          clipboard: {
            readText: async () => clipboardText,
            writeText: async (text: string) => {
              clipboardText = text;
            },
          },
        }) as Navigator,
    });

    expect(await platform.clipboard.writeText('Nammu OS')).toEqual({
      status: 'success',
      value: undefined,
    });
    expect(await platform.clipboard.readText()).toEqual({
      status: 'success',
      value: 'Nammu OS',
    });
  });

  test('keeps native dialog paths private while handling selection, save, and cancellation', async () => {
    const pickedOptions: unknown[] = [];
    const savedOptions: unknown[] = [];
    const writes: Array<{ path: string; bytes: number[] }> = [];
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        pickFile: async (options) => {
          pickedOptions.push(options);
          return ['C:\\Users\\Test\\one.json', 'D:\\two.txt'];
        },
        readFile: async (path) =>
          path.endsWith('one.json') ? new Uint8Array([1, 2, 3]) : new Uint8Array([4, 5]),
        saveFile: async (options) => {
          savedOptions.push(options);
          return 'C:\\Users\\Test\\backup.json';
        },
        writeFile: async (path, bytes) => {
          writes.push({ path, bytes: [...bytes] });
        },
      }),
      getPlatformCapabilities('web').services,
    );

    const picked = await platform.files.pick({
      multiple: true,
      filters: [{ name: 'Data', extensions: ['.json', 'txt'] }],
    });
    expect(picked.status).toBe('success');
    if (picked.status === 'success') {
      expect(picked.value.files.map(({ name, size }) => ({ name, size }))).toEqual([
        { name: 'one.json', size: 3 },
        { name: 'two.txt', size: 2 },
      ]);
      expect(JSON.stringify(picked.value)).not.toContain('C:\\Users');
    }
    expect(pickedOptions).toEqual([
      {
        directory: false,
        multiple: true,
        filters: [{ name: 'Data', extensions: ['json', 'txt'] }],
      },
    ]);

    expect(await platform.files.save({ suggestedName: 'backup.json', contents: 'Nammu' })).toEqual({
      status: 'success',
      value: { fileName: 'backup.json' },
    });
    expect(savedOptions).toEqual([{ defaultPath: 'backup.json' }]);
    expect(writes).toEqual([
      { path: 'C:\\Users\\Test\\backup.json', bytes: [...new TextEncoder().encode('Nammu')] },
    ]);

    const cancelled = createTauriPlatformCapabilities(
      tauriEnvironment(),
      getPlatformCapabilities('web').services,
    );
    expect(await cancelled.files.pick()).toEqual({ status: 'cancelled' });
    expect(await cancelled.files.save({ suggestedName: 'x.txt', contents: '' })).toEqual({
      status: 'cancelled',
    });
  });

  test('uses the native text clipboard, validated opener, and host window operations', async () => {
    let clipboard = 'initial';
    const opened: string[] = [];
    const windowOperations: string[] = [];
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        readClipboardText: async () => clipboard,
        writeClipboardText: async (text) => {
          clipboard = text;
        },
        openUrl: async (url) => {
          opened.push(url);
        },
        minimizeWindow: async () => {
          windowOperations.push('minimize');
        },
        toggleMaximizeWindow: async () => {
          windowOperations.push('toggle-maximize');
        },
        closeWindow: async () => {
          windowOperations.push('close');
        },
      }),
      getPlatformCapabilities('web').services,
    );

    expect(await platform.clipboard.writeText('Nammu OS')).toEqual({
      status: 'success',
      value: undefined,
    });
    expect(await platform.clipboard.readText()).toEqual({
      status: 'success',
      value: 'Nammu OS',
    });
    expect(await platform.external.openUrl('https://example.com')).toEqual({
      status: 'success',
      value: undefined,
    });
    expect(opened).toEqual(['https://example.com/']);
    await platform.window.minimize();
    await platform.window.toggleMaximize();
    await platform.window.close();
    expect(windowOperations).toEqual(['minimize', 'toggle-maximize', 'close']);
  });

  test('validates native filesystem responses and preserves structured errors', async () => {
    const calls: Array<{ operation: string; path?: string }> = [];
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        listNativeFileRoots: async () => ({
          status: 'success',
          value: {
            roots: [
              {
                path: 'C:\\',
                name: 'Local Disk (C:)',
                kind: 'local',
                label: null,
                fileSystem: 'NTFS',
                totalBytes: 1000,
                freeBytes: 400,
                accessible: true,
              },
            ],
            durationMs: 2,
          },
        }),
        listNativeDirectory: async (path) => {
          calls.push({ operation: 'list', path });
          return {
            status: 'error',
            error: { code: 'ACCESS_DENIED', message: 'Windows denied access.' },
          };
        },
        statNativeFile: async (path) => {
          calls.push({ operation: 'stat', path });
          return {
            status: 'success',
            value: {
              name: 'notes.txt',
              path,
              kind: 'file',
              sizeBytes: 7,
              createdAtMs: null,
              modifiedAtMs: 10,
              extension: 'txt',
              hidden: false,
              system: false,
              readOnly: false,
              readable: true,
              navigable: false,
            },
          };
        },
      }),
      getPlatformCapabilities('web').services,
    );

    expect(await platform.filesystem.listRoots()).toMatchObject({ status: 'success' });
    expect(await platform.filesystem.listDirectory('C:\\System Volume Information')).toEqual({
      status: 'error',
      error: { code: 'ACCESS_DENIED', message: 'Windows denied access.' },
    });
    expect(await platform.filesystem.stat('C:\\notes.txt')).toMatchObject({
      status: 'success',
      value: { name: 'notes.txt', sizeBytes: 7 },
    });
    expect(calls).toEqual([
      { operation: 'list', path: 'C:\\System Volume Information' },
      { operation: 'stat', path: 'C:\\notes.txt' },
    ]);
  });

  test('routes only typed filesystem mutations and validates operation snapshots', async () => {
    const calls: string[] = [];
    const metadata = {
      name: 'Folder',
      path: 'C:\\Folder',
      kind: 'directory',
      sizeBytes: null,
      createdAtMs: null,
      modifiedAtMs: 10,
      extension: null,
      hidden: false,
      system: false,
      readOnly: false,
      readable: true,
      navigable: true,
    };
    const snapshot = {
      id: 'a'.repeat(32),
      operation: 'copy',
      state: 'queued',
      sources: ['C:\\source.txt'],
      destinationPath: 'D:\\',
      currentItem: null,
      filesCompleted: 0,
      filesTotal: null,
      bytesProcessed: 0,
      bytesTotal: null,
      successes: [],
      failures: [],
    };
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        createNativeDirectory: async (parentPath, name) => {
          calls.push(`mkdir:${parentPath}:${name}`);
          return {
            status: 'success',
            value: { entry: metadata, affectedDirectories: [parentPath] },
          };
        },
        startNativeCopy: async (sources, destinationPath, strategy) => {
          calls.push(`copy:${sources.join(',')}:${destinationPath}:${strategy}`);
          return { status: 'success', value: snapshot };
        },
        getNativeFileOperation: async (id) => {
          calls.push(`get:${id}`);
          return { status: 'success', value: { ...snapshot, state: 'completed' } };
        },
      }),
      getPlatformCapabilities('web').services,
    );

    expect(await platform.filesystem.createDirectory('C:\\', 'Folder')).toMatchObject({
      status: 'success',
      value: { entry: { path: 'C:\\Folder' } },
    });
    expect(await platform.filesystem.copy(['C:\\source.txt'], 'D:\\')).toMatchObject({
      status: 'success',
      value: { operation: 'copy', state: 'queued' },
    });
    expect(await platform.filesystem.getOperation('a'.repeat(32))).toMatchObject({
      status: 'success',
      value: { state: 'completed' },
    });
    expect(calls).toEqual([
      'mkdir:C:\\:Folder',
      'copy:C:\\source.txt:D:\\:cancel',
      `get:${'a'.repeat(32)}`,
    ]);
  });

  test('keeps recycle, permanent deletion, and restore behind distinct typed commands', async () => {
    const calls: string[] = [];
    const snapshot = {
      id: 'b'.repeat(32),
      operation: 'trash',
      state: 'queued',
      sources: ['C:\\fixture.txt'],
      currentItem: null,
      filesCompleted: 0,
      filesTotal: 1,
      successes: [],
      failures: [],
      undoId: null,
      reversible: false,
      cancellationMode: 'recoverable-between-items',
    };
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        startNativeTrash: async (sources) => {
          calls.push(`trash:${sources.join(',')}`);
          return { status: 'success', value: snapshot };
        },
        startNativePermanentDelete: async (sources, confirmed) => {
          calls.push(`permanent:${sources.join(',')}:${confirmed}`);
          return {
            status: 'success',
            value: {
              ...snapshot,
              operation: 'permanent-delete',
              cancellationMode: 'stop-remaining-only',
            },
          };
        },
        startNativeRestore: async (undoId) => {
          calls.push(`restore:${undoId}`);
          return { status: 'success', value: { ...snapshot, operation: 'restore' } };
        },
      }),
      getPlatformCapabilities('web').services,
    );

    expect(await platform.filesystem.trash(['C:\\fixture.txt'])).toMatchObject({
      status: 'success',
      value: { operation: 'trash' },
    });
    expect(await platform.filesystem.permanentlyDelete(['C:\\fixture.txt'], false)).toEqual({
      status: 'error',
      error: {
        code: 'CONFIRMATION_REQUIRED',
        message: 'Permanent deletion requires explicit confirmation.',
      },
    });
    expect(await platform.filesystem.permanentlyDelete(['C:\\fixture.txt'], true)).toMatchObject({
      status: 'success',
      value: { operation: 'permanent-delete' },
    });
    expect(await platform.filesystem.restore('c'.repeat(32))).toMatchObject({
      status: 'success',
      value: { operation: 'restore' },
    });
    expect(calls).toEqual([
      'trash:C:\\fixture.txt',
      'permanent:C:\\fixture.txt:true',
      `restore:${'c'.repeat(32)}`,
    ]);
  });

  test('fails closed on malformed native filesystem IPC and invalid paths', async () => {
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        listNativeFileRoots: async () => ({ status: 'success', value: { roots: 'bad' } }),
      }),
      getPlatformCapabilities('web').services,
    );
    expect(await platform.filesystem.listRoots()).toEqual({
      status: 'error',
      error: { code: 'IO_ERROR', message: 'The native filesystem returned invalid data.' },
    });
    expect(await platform.filesystem.listDirectory('')).toEqual({
      status: 'error',
      error: { code: 'INVALID_PATH', message: 'The filesystem path is invalid.' },
    });
    expect(await platform.filesystem.stat('C:\\bad\0path')).toEqual({
      status: 'error',
      error: { code: 'INVALID_PATH', message: 'The filesystem path is invalid.' },
    });
  });

  test('honors native notification permission and never delivers after denial', async () => {
    let granted = false;
    let requested: 'granted' | 'denied' = 'denied';
    const delivered: string[] = [];
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        isNotificationPermissionGranted: async () => granted,
        requestNotificationPermission: async () => requested,
        sendNotification: ({ title }) => {
          delivered.push(title);
        },
      }),
      getPlatformCapabilities('web').services,
    );

    expect(await platform.notifications.requestPermission()).toEqual({
      status: 'success',
      value: 'denied',
    });
    expect(await platform.notifications.show({ title: 'Blocked' })).toEqual({
      status: 'denied',
      reason: 'Notification permission has not been granted.',
    });
    expect(delivered).toEqual([]);

    requested = 'granted';
    expect(await platform.notifications.requestPermission()).toEqual({
      status: 'success',
      value: 'granted',
    });
    granted = true;
    expect(await platform.notifications.show({ title: 'Now playing' })).toEqual({
      status: 'success',
      value: undefined,
    });
    expect(delivered).toEqual(['Now playing']);
  });

  test('opens validated web URLs through a controlled noopener link', async () => {
    const opened: Array<{ href: string; target: string; rel: string }> = [];
    const anchor = {
      href: '',
      target: '',
      rel: '',
      hidden: false,
      click() {
        opened.push({ href: this.href, target: this.target, rel: this.rel });
      },
      remove() {},
    };
    const platform = createWebPlatformCapabilities({
      ...unavailableWebEnvironment,
      getDocument: () =>
        ({
          createElement: () => anchor,
          body: { append() {} },
        }) as unknown as Document,
    });

    expect(await platform.external.openUrl('https://nammu-os.vercel.app/projects')).toEqual({
      status: 'success',
      value: undefined,
    });
    expect(opened).toEqual([
      {
        href: 'https://nammu-os.vercel.app/projects',
        target: '_blank',
        rel: 'noopener noreferrer external',
      },
    ]);
  });

  test('rejects unsafe external URL schemes before invoking a runtime API', async () => {
    for (const runtime of ['web', 'tauri'] as const) {
      expect(
        await getPlatformCapabilities(runtime).external.openUrl('javascript:alert(1)'),
      ).toEqual({
        status: 'error',
        code: 'invalid-input',
        message: 'Only credential-free HTTP, HTTPS, mailto, and tel URLs are allowed.',
      });
      expect(
        await getPlatformCapabilities(runtime).external.openUrl('https://user:secret@test.dev'),
      ).toEqual({
        status: 'error',
        code: 'invalid-input',
        message: 'Only credential-free HTTP, HTTPS, mailto, and tel URLs are allowed.',
      });
    }
  });

  test('rejects path-like save names without opening a dialog', async () => {
    for (const runtime of ['web', 'tauri'] as const) {
      expect(
        await getPlatformCapabilities(runtime).files.save({
          suggestedName: '../backup.json',
          contents: '{}',
        }),
      ).toEqual({
        status: 'error',
        code: 'invalid-input',
        message: 'A safe file name is required.',
      });
    }
  });
});
