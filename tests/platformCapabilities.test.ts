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
    readNativeFileClipboard: async () => ({
      status: 'success',
      value: { available: false, operation: null, paths: [], sequence: 0 },
    }),
    writeNativeFileClipboard: async (operation, paths) => ({
      status: 'success',
      value: { available: true, operation, paths, sequence: 1 },
    }),
    completeNativeFileClipboard: async (_sequence, _operation) => ({
      status: 'success',
      value: { reported: true, sequence: 2 },
    }),
    getNativeFileClipboardDiagnostics: async () => ({
      status: 'success',
      value: {
        openClipboardGuards: 0,
        reads: 0,
        writes: 0,
        completions: 0,
        maxPaths: 10_000,
        maxUtf16Bytes: 4_194_304,
      },
    }),
    refreshNativeFileDropTargets: async () => ({ status: 'success', value: true }),
    releaseNativeFileDropTargets: async () => ({ status: 'success', value: true }),
    startNativeFileDrag: async (operation, paths) => ({
      status: 'success',
      value: {
        dropped: false,
        operation: operation === 'auto' ? null : operation,
        itemCount: paths.length,
        prepareDurationMs: 0,
      },
    }),
    setNativeFileDropEffect: async () => ({ status: 'success', value: true }),
    getNativeFileDragDropDiagnostics: async () => ({
      status: 'success',
      value: {
        registeredTargets: 1,
        activeInboundSessions: 0,
        activeOutboundSessions: 0,
        inboundEnters: 0,
        inboundDrops: 0,
        inboundLeaves: 0,
        outboundStarted: 0,
        outboundDropped: 0,
        outboundCancelled: 0,
        maxPaths: 10_000,
        maxUtf16Bytes: 4_194_304,
      },
    }),
    listenNativeFileDragEvents: async () => () => {},
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
    startNativeDirectoryWatch: async () => ({
      status: 'error',
      error: { code: 'WATCH_UNSUPPORTED', message: 'Watching is unavailable.' },
    }),
    stopNativeDirectoryWatch: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'The watcher is unavailable.' },
    }),
    getNativeDirectoryWatchDiagnostics: async () => ({
      status: 'success',
      value: { activeWatchers: 0, rawEvents: 0, emittedInvalidations: 0, droppedSignals: 0 },
    }),
    listenNativeFilesystemEvents: async () => () => undefined,
    startNativeFileSearch: async () => ({
      status: 'error',
      error: { code: 'ACCESS_DENIED', message: 'Native search is unavailable.' },
    }),
    getNativeFileSearch: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'The search is unavailable.' },
    }),
    cancelNativeFileSearch: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'The search is unavailable.' },
    }),
    releaseNativeFileSearch: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'The search is unavailable.' },
    }),
    getNativeFileSearchDiagnostics: async () => ({
      status: 'success',
      value: { activeSearches: 0, retainedSearches: 0, retainedResults: 0 },
    }),
    startNativeFilePreview: async () => ({
      status: 'error',
      error: { code: 'PREVIEW_UNSUPPORTED', message: 'Preview unavailable.' },
    }),
    getNativeFilePreview: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'Preview unavailable.' },
    }),
    takeNativeFilePreviewBytes: async () => new Uint8Array(),
    cancelNativeFilePreview: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'Preview unavailable.' },
    }),
    releaseNativeFilePreview: async () => ({ status: 'success', value: { released: true } }),
    getNativeFilePreviewDiagnostics: async () => ({
      status: 'success',
      value: {
        activeJobs: 0,
        retainedJobs: 0,
        retainedResultBytes: 0,
        cacheEntries: 0,
        cacheBytes: 0,
        maxActiveJobs: 4,
        cacheMaxEntries: 256,
        cacheMaxBytes: 33554432,
      },
    }),
    getNativeFileProperties: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'Properties unavailable.' },
    }),
    startNativeDirectoryMeasurement: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'Measurement unavailable.' },
    }),
    getNativeDirectoryMeasurement: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'Measurement unavailable.' },
    }),
    cancelNativeDirectoryMeasurement: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'Measurement unavailable.' },
    }),
    releaseNativeDirectoryMeasurement: async () => ({
      status: 'success',
      value: { released: true },
    }),
    getNativeDirectoryMeasurementDiagnostics: async () => ({
      status: 'success',
      value: { activeJobs: 0, retainedJobs: 0, maxActiveJobs: 2 },
    }),
    openNativeArchive: async () => ({
      status: 'error',
      error: { code: 'ARCHIVE_INVALID', message: 'Invalid archive.' },
    }),
    getNativeArchiveEntries: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'Archive is not open.' },
    }),
    releaseNativeArchive: async () => ({ status: 'success', value: { released: false } }),
    startNativeArchiveExtract: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'Archive is not open.' },
    }),
    startNativeZipCreate: async () => ({
      status: 'error',
      error: { code: 'ACCESS_DENIED', message: 'Cannot create archive.' },
    }),
    getNativeArchiveOperation: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'Archive operation is not available.' },
    }),
    cancelNativeArchiveOperation: async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: 'Archive operation is not available.' },
    }),
    releaseNativeArchiveOperation: async () => ({
      status: 'success',
      value: { released: false },
    }),
    getNativeArchiveDiagnostics: async () => ({
      status: 'success',
      value: {
        openArchives: 0,
        activeJobs: 0,
        retainedJobs: 0,
        maxActiveJobs: 2,
        maxArchiveEntries: 100000,
        maxTotalUncompressedBytes: 274877906944,
      },
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
      'cancelArchiveOperation',
      'cancelDeletionOperation',
      'cancelDirectoryMeasurement',
      'cancelOperation',
      'cancelPreview',
      'cancelSearch',
      'copy',
      'createDirectory',
      'createFile',
      'createZip',
      'duplicate',
      'extractArchive',
      'getArchiveDiagnostics',
      'getArchiveOperation',
      'getDeletionOperation',
      'getDirectoryMeasurement',
      'getDirectoryMeasurementDiagnostics',
      'getOperation',
      'getPreview',
      'getPreviewDiagnostics',
      'getProperties',
      'getSearch',
      'getSearchDiagnostics',
      'getWatchDiagnostics',
      'listArchiveEntries',
      'listDirectory',
      'listRoots',
      'move',
      'openArchive',
      'permanentlyDelete',
      'pickArchiveDestination',
      'pickZipDestination',
      'releaseArchive',
      'releaseArchiveOperation',
      'releaseDirectoryMeasurement',
      'releasePreview',
      'releaseSearch',
      'rename',
      'restore',
      'startDirectoryMeasurement',
      'startPreview',
      'startSearch',
      'stat',
      'supported',
      'takePreviewBytes',
      'trash',
      'watchDirectory',
    ]);
    expect(Object.keys(firstWeb.files).sort()).toEqual(['pick', 'save']);
    expect(Object.keys(firstWeb.fileClipboard).sort()).toEqual([
      'complete',
      'getDiagnostics',
      'read',
      'supported',
      'write',
    ]);
    expect(Object.keys(firstWeb.fileDragDrop).sort()).toEqual([
      'getDiagnostics',
      'setDropEffect',
      'start',
      'subscribe',
      'supported',
    ]);
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
      invoke: async <_T>(command: string) => {
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
    expect(await platform.filesystem.watchDirectory('C:\\', () => undefined)).toEqual({
      status: 'unsupported',
      reason: 'This PC is available only in the Nammu desktop application.',
    });
    expect(await platform.fileClipboard.read()).toEqual({
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

  test('keeps Windows file clipboard IPC typed, validated, and separate from text clipboard', async () => {
    const calls: Array<{ operation: string; value?: unknown }> = [];
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        readNativeFileClipboard: async () => ({
          status: 'success',
          value: {
            available: true,
            operation: 'move',
            paths: ['C:\\source folder\\résumé.txt'],
            sequence: 42,
          },
        }),
        writeNativeFileClipboard: async (operation, paths) => {
          calls.push({ operation: 'write', value: { operation, paths } });
          return {
            status: 'success',
            value: { available: true, operation, paths, sequence: 43 },
          };
        },
        completeNativeFileClipboard: async (sequence, operation) => {
          calls.push({ operation: 'complete', value: { sequence, operation } });
          return { status: 'success', value: { reported: true, sequence: 44 } };
        },
      }),
      getPlatformCapabilities('web').services,
    );

    expect(await platform.fileClipboard.read()).toEqual({
      status: 'success',
      value: {
        available: true,
        operation: 'move',
        paths: ['C:\\source folder\\résumé.txt'],
        sequence: 42,
      },
    });
    expect(
      await platform.fileClipboard.write('copy', ['D:\\one.txt', 'D:\\two.txt']),
    ).toMatchObject({ status: 'success', value: { sequence: 43 } });
    expect(await platform.fileClipboard.complete(43, 'copy')).toEqual({
      status: 'success',
      value: { reported: true, sequence: 44 },
    });
    expect(calls).toEqual([
      {
        operation: 'write',
        value: { operation: 'copy', paths: ['D:\\one.txt', 'D:\\two.txt'] },
      },
      { operation: 'complete', value: { sequence: 43, operation: 'copy' } },
    ]);

    const malformed = createTauriPlatformCapabilities(
      tauriEnvironment({
        readNativeFileClipboard: async () => ({
          status: 'success',
          value: { available: true, operation: 'copy', paths: 'C:\\bad.txt', sequence: 1 },
        }),
      }),
      getPlatformCapabilities('web').services,
    );
    expect(await malformed.fileClipboard.read()).toEqual({
      status: 'error',
      error: { code: 'IO_ERROR', message: 'The native filesystem returned invalid data.' },
    });
  });

  test('keeps Windows file drag/drop typed, event-driven, and unavailable on Web', async () => {
    const calls: unknown[] = [];
    const listener: { current: ((payload: unknown) => void) | null } = { current: null };
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        releaseNativeFileDropTargets: async () => {
          calls.push({ operation: 'release-drop-target' });
          return { status: 'success', value: true };
        },
        startNativeFileDrag: async (operation, paths) => {
          calls.push({ operation, paths });
          return {
            status: 'success',
            value: {
              dropped: true,
              operation: 'copy',
              itemCount: paths.length,
              prepareDurationMs: 1.5,
            },
          };
        },
        setNativeFileDropEffect: async (session, operation) => {
          calls.push({ session, operation });
          return { status: 'success', value: true };
        },
        listenNativeFileDragEvents: async (next) => {
          listener.current = next;
          return () => {
            listener.current = null;
          };
        },
      }),
      getPlatformCapabilities('web').services,
    );
    const events: unknown[] = [];
    const unlisten = await platform.fileDragDrop.subscribe((event) => events.push(event));
    listener.current?.({
      phase: 'enter',
      session: 7,
      paths: ['C:\\资料\\one.txt'],
      x: 10,
      y: 20,
      modifiers: { control: true, shift: false },
      operation: 'copy',
    });
    listener.current?.({ phase: 'drop', paths: 'invalid' });
    expect(events).toHaveLength(1);
    expect(await platform.fileDragDrop.start('auto', ['C:\\one.txt'])).toMatchObject({
      status: 'success',
      value: { dropped: true, itemCount: 1 },
    });
    expect(await platform.fileDragDrop.setDropEffect(7, 'copy')).toEqual({
      status: 'success',
      value: true,
    });
    expect(calls).toEqual([
      { operation: 'auto', paths: ['C:\\one.txt'] },
      { session: 7, operation: 'copy' },
    ]);
    unlisten();
    await Promise.resolve();
    expect(calls.at(-1)).toEqual({ operation: 'release-drop-target' });
    expect(getPlatformCapabilities('web').fileDragDrop.supported).toBe(false);
    expect(
      await getPlatformCapabilities('web').fileDragDrop.start('copy', ['C:\\one.txt']),
    ).toEqual({
      status: 'unsupported',
      reason: 'This PC is available only in the Nammu desktop application.',
    });
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

  test('scopes native directory events to a disposable typed subscription', async () => {
    const calls: string[] = [];
    let nativeListener: ((payload: unknown) => void) | undefined;
    let unlistened = false;
    const events: string[] = [];
    const watchId = 'd'.repeat(32);
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        listenNativeFilesystemEvents: async (listener) => {
          nativeListener = listener;
          return () => {
            unlistened = true;
          };
        },
        startNativeDirectoryWatch: async (path) => {
          calls.push(`start:${path}`);
          return { status: 'success', value: { id: watchId, path } };
        },
        stopNativeDirectoryWatch: async (id) => {
          calls.push(`stop:${id}`);
          return { status: 'success', value: { stopped: true, activeWatchers: 0 } };
        },
      }),
      getPlatformCapabilities('web').services,
    );
    const result = await platform.filesystem.watchDirectory('C:\\Fixture', (event) => {
      events.push(event.kind);
    });
    expect(result.status).toBe('success');
    nativeListener?.({ kind: 'malformed' });
    nativeListener?.({
      watchId,
      rootPath: 'C:\\Fixture',
      kind: 'renamed',
      paths: ['C:\\Fixture\\old.txt', 'C:\\Fixture\\new.txt'],
      rawEventCount: 2,
      rescanRequired: false,
      error: null,
    });
    expect(events).toEqual(['renamed']);
    if (result.status === 'success') await result.value.dispose();
    nativeListener?.({
      watchId,
      rootPath: 'C:\\Fixture',
      kind: 'removed',
      paths: ['C:\\Fixture\\new.txt'],
      rawEventCount: 1,
      rescanRequired: false,
      error: null,
    });
    expect(events).toEqual(['renamed']);
    expect(unlistened).toBe(true);
    expect(calls).toEqual([`start:C:\\Fixture`, `stop:${watchId}`]);
  });

  test('validates progressive native search snapshots and explicit job lifecycle', async () => {
    const id = 'e'.repeat(32);
    const calls: string[] = [];
    const query = {
      rootPath: 'C:\\Fixture',
      text: 'invoice',
      scope: 'current-tree' as const,
      kind: 'files' as const,
      extensions: ['pdf'],
    };
    const snapshot = {
      id,
      query,
      state: 'running',
      scannedEntries: 120,
      matchedEntries: 1,
      inaccessibleEntries: 2,
      retainedResults: 1,
      resultLimit: 5_000,
      truncated: false,
      durationMs: 12.5,
      resultOffset: 0,
      results: [
        {
          name: 'invoice.pdf',
          path: 'C:\\Fixture\\invoice.pdf',
          kind: 'file',
          sizeBytes: 12,
          createdAtMs: null,
          modifiedAtMs: null,
          extension: 'pdf',
          hidden: false,
          system: false,
          readOnly: false,
          readable: true,
          navigable: false,
        },
      ],
      error: null,
    };
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        startNativeFileSearch: async (input) => {
          calls.push(`start:${input.text}`);
          return { status: 'success', value: snapshot };
        },
        getNativeFileSearch: async (searchId, offset) => {
          calls.push(`get:${searchId}:${offset}`);
          return { status: 'success', value: snapshot };
        },
        cancelNativeFileSearch: async (searchId) => {
          calls.push(`cancel:${searchId}`);
          return { status: 'success', value: { ...snapshot, state: 'cancelled', results: [] } };
        },
        releaseNativeFileSearch: async (searchId) => {
          calls.push(`release:${searchId}`);
          return { status: 'success', value: { released: true } };
        },
      }),
      getPlatformCapabilities('web').services,
    );
    expect(await platform.filesystem.startSearch(query)).toMatchObject({
      status: 'success',
      value: { id, matchedEntries: 1 },
    });
    expect(await platform.filesystem.getSearch(id, 0)).toMatchObject({ status: 'success' });
    expect(await platform.filesystem.cancelSearch(id)).toMatchObject({
      status: 'success',
      value: { state: 'cancelled' },
    });
    expect(await platform.filesystem.releaseSearch(id)).toEqual({
      status: 'success',
      value: { released: true },
    });
    expect(calls).toEqual(['start:invoice', `get:${id}:0`, `cancel:${id}`, `release:${id}`]);
  });

  test('keeps native search unavailable on Web and rejects malformed native search data', async () => {
    expect(
      await getPlatformCapabilities('web').filesystem.startSearch({
        rootPath: 'C:\\',
        text: 'private',
        scope: 'current-tree',
        kind: 'all',
        extensions: [],
      }),
    ).toMatchObject({ status: 'unsupported' });
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        startNativeFileSearch: async () => ({
          status: 'success',
          value: { id: 'leaked-paths', results: ['C:\\secret.txt'] },
        }),
      }),
      getPlatformCapabilities('web').services,
    );
    expect(
      await platform.filesystem.startSearch({
        rootPath: 'C:\\',
        text: 'secret',
        scope: 'current-tree',
        kind: 'all',
        extensions: [],
      }),
    ).toEqual({
      status: 'error',
      error: { code: 'IO_ERROR', message: 'The native filesystem returned invalid data.' },
    });
  });

  test('validates bounded native previews and keeps Web preview access unsupported', async () => {
    const id = 'f'.repeat(32);
    const request = {
      path: 'C:\\Fixture\\report.pdf',
      mode: 'thumbnail' as const,
      requestedWidth: 64,
      requestedHeight: 64,
    };
    const value = {
      id,
      request,
      state: 'completed',
      durationMs: 4,
      result: {
        kind: 'image',
        mimeType: 'image/png',
        width: 64,
        height: 40,
        sourceWidth: 800,
        sourceHeight: 500,
        pageCount: 12,
        durationMs: null,
        byteLength: 4,
        text: null,
        truncated: false,
        cacheHit: false,
      },
      error: null,
    };
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        startNativeFilePreview: async () => ({ status: 'success', value }),
        getNativeFilePreview: async () => ({ status: 'success', value }),
        takeNativeFilePreviewBytes: async () => new Uint8Array([137, 80, 78, 71]),
        releaseNativeFilePreview: async () => ({ status: 'success', value: { released: true } }),
      }),
      getPlatformCapabilities('web').services,
    );
    expect(await platform.filesystem.startPreview(request)).toMatchObject({
      status: 'success',
      value: { id, result: { pageCount: 12 } },
    });
    expect(await platform.filesystem.takePreviewBytes(id)).toEqual({
      status: 'success',
      value: new Uint8Array([137, 80, 78, 71]),
    });
    expect(await platform.filesystem.releasePreview(id)).toEqual({
      status: 'success',
      value: { released: true },
    });
    expect(
      await platform.filesystem.startPreview({ ...request, requestedWidth: 50_000 }),
    ).toMatchObject({ status: 'error', error: { code: 'INVALID_PATH' } });
    expect(await getPlatformCapabilities('web').filesystem.startPreview(request)).toMatchObject({
      status: 'unsupported',
    });
  });

  test('validates read-only properties and cancellable directory measurements', async () => {
    const id = '9'.repeat(32);
    const item = {
      name: 'video.mp4',
      path: 'C:\\Fixture\\video.mp4',
      parentPath: 'C:\\Fixture',
      extension: 'mp4',
      kind: 'file',
      sizeBytes: 1024,
      allocatedBytes: 4096,
      createdAtMs: 1,
      modifiedAtMs: 2,
      accessedAtMs: 3,
      attributes: {
        readOnly: false,
        hidden: false,
        system: false,
        archive: true,
        compressed: false,
        encrypted: false,
        sparse: false,
        offline: false,
        temporary: false,
        reparsePoint: false,
      },
      hardLinkCount: 1,
      linkTarget: null,
      volume: {
        path: 'C:\\',
        label: 'System',
        kind: 'local',
        fileSystem: 'NTFS',
        totalBytes: 1000,
        freeBytes: 400,
        usedBytes: 600,
        accessible: true,
      },
      accessible: true,
      accessError: null,
    };
    const properties = {
      items: [item],
      itemCount: 1,
      fileCount: 1,
      folderCount: 0,
      driveCount: 0,
      directFileBytes: 1024,
      directAllocatedBytes: 4096,
      containsUnmeasuredFolders: false,
      commonParentPath: 'C:\\Fixture',
      mixedKinds: false,
      durationMs: 1,
    };
    const measurement = {
      id,
      state: 'running',
      rootCount: 1,
      filesScanned: 100,
      directoriesScanned: 2,
      logicalBytes: 1024,
      allocatedBytes: 4096,
      allocationComplete: true,
      skippedEntries: 0,
      reparsePointsSkipped: 1,
      durationMs: 5,
      error: null,
    };
    const calls: string[] = [];
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        getNativeFileProperties: async (paths) => {
          calls.push(`properties:${paths.length}`);
          return { status: 'success', value: properties };
        },
        startNativeDirectoryMeasurement: async () => ({ status: 'success', value: measurement }),
        getNativeDirectoryMeasurement: async () => ({ status: 'success', value: measurement }),
        cancelNativeDirectoryMeasurement: async () => ({
          status: 'success',
          value: { ...measurement, state: 'cancelled' },
        }),
        releaseNativeDirectoryMeasurement: async () => ({
          status: 'success',
          value: { released: true },
        }),
      }),
      getPlatformCapabilities('web').services,
    );
    expect(await platform.filesystem.getProperties([item.path])).toMatchObject({
      status: 'success',
      value: { directAllocatedBytes: 4096 },
    });
    expect(await platform.filesystem.startDirectoryMeasurement(['C:\\Fixture'])).toMatchObject({
      status: 'success',
      value: { reparsePointsSkipped: 1 },
    });
    expect(await platform.filesystem.cancelDirectoryMeasurement(id)).toMatchObject({
      status: 'success',
      value: { state: 'cancelled' },
    });
    expect(await platform.filesystem.releaseDirectoryMeasurement(id)).toEqual({
      status: 'success',
      value: { released: true },
    });
    expect(calls).toEqual(['properties:1']);
    expect(
      await getPlatformCapabilities('web').filesystem.getProperties([item.path]),
    ).toMatchObject({ status: 'unsupported' });
  });

  test('fails closed on malformed preview descriptors and oversized byte responses', async () => {
    const id = 'a'.repeat(32);
    const request = {
      path: 'C:\\Fixture\\photo.png',
      mode: 'thumbnail' as const,
      requestedWidth: 64,
      requestedHeight: 64,
    };
    const platform = createTauriPlatformCapabilities(
      tauriEnvironment({
        startNativeFilePreview: async () => ({
          status: 'success',
          value: {
            id,
            request,
            state: 'completed',
            durationMs: 1,
            result: { kind: 'html', text: '<script>' },
            error: null,
          },
        }),
        takeNativeFilePreviewBytes: async () => new Uint8Array(8 * 1024 * 1024 + 1),
      }),
      getPlatformCapabilities('web').services,
    );
    expect(await platform.filesystem.startPreview(request)).toMatchObject({
      status: 'error',
      error: { code: 'IO_ERROR' },
    });
    expect(await platform.filesystem.takePreviewBytes(id)).toMatchObject({
      status: 'error',
      error: { code: 'IO_ERROR' },
    });
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

  test('keeps ZIP archives behind typed desktop-only commands and validates results', async () => {
    const calls: string[] = [];
    const archiveId = 'a'.repeat(32);
    const operationId = 'b'.repeat(32);
    const operation = {
      id: operationId,
      operation: 'extract',
      state: 'queued',
      archivePath: 'C:\\Downloads\\safe.zip',
      destinationPath: 'C:\\Downloads',
      currentEntry: null,
      filesCompleted: 0,
      directoriesCompleted: 0,
      entriesTotal: 1,
      bytesProcessed: 0,
      bytesTotal: 4,
      skippedEntries: 0,
      failures: [],
      error: null,
    };
    const desktop = createTauriPlatformCapabilities(
      tauriEnvironment({
        openNativeArchive: async (path) => {
          calls.push(`open:${path}`);
          return {
            status: 'success',
            value: {
              id: archiveId,
              archivePath: path,
              name: 'safe.zip',
              entryCount: 1,
              fileCount: 1,
              directoryCount: 0,
              encryptedEntries: 0,
              symlinkEntries: 0,
              unsupportedEntries: 0,
              totalCompressedBytes: 4,
              totalUncompressedBytes: 4,
              durationMs: 1,
            },
          };
        },
        getNativeArchiveEntries: async () => ({
          status: 'success',
          value: {
            archiveId,
            path: '',
            parentPath: null,
            entries: [
              {
                id: 'entry:0',
                path: 'safe.txt',
                parentPath: '',
                name: 'safe.txt',
                kind: 'file',
                compressedSize: 4,
                uncompressedSize: 4,
                modified: null,
                compressionMethod: 'Stored',
                encrypted: false,
              },
            ],
            totalEntries: 1,
            offset: 0,
            limit: 500,
            hasMore: false,
          },
        }),
        startNativeArchiveExtract: async (_id, _destination, _selection, strategy) => {
          calls.push(`extract:${strategy}`);
          return { status: 'success', value: operation };
        },
      }),
    );
    expect((await desktop.filesystem.openArchive('C:\\Downloads\\safe.zip')).status).toBe(
      'success',
    );
    expect((await desktop.filesystem.listArchiveEntries(archiveId, '')).status).toBe('success');
    expect(
      (
        await desktop.filesystem.extractArchive({
          archiveId,
          destinationPath: 'C:\\Downloads',
          conflictStrategy: 'keep-both',
        })
      ).status,
    ).toBe('success');
    expect(calls).toEqual(['open:C:\\Downloads\\safe.zip', 'extract:keep-both']);

    const web = createWebPlatformCapabilities(unavailableWebEnvironment);
    expect((await web.filesystem.openArchive('C:\\Downloads\\safe.zip')).status).toBe(
      'unsupported',
    );
    expect(
      (
        await web.filesystem.extractArchive({
          archiveId,
          destinationPath: 'C:\\Downloads',
          conflictStrategy: 'cancel',
        })
      ).status,
    ).toBe('unsupported');
  });
});
