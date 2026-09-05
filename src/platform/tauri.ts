import type {
  CapabilityResult,
  FilesystemError,
  FilesystemErrorCode,
  FilesystemResult,
  NativeDirectoryListing,
  NativeDirectoryWatchDiagnostics,
  NativeDirectoryWatchSubscription,
  NativeDeletionCancellationMode,
  NativeDeletionFailure,
  NativeDeletionOperationSnapshot,
  NativeDeletionOperationType,
  NativeDeletionSuccess,
  NativeFileBreadcrumb,
  NativeFileKind,
  NativeFileConflictStrategy,
  NativeFileMetadata,
  NativeFileMutation,
  NativeFileOperationFailure,
  NativeFileOperationSnapshot,
  NativeFileOperationState,
  NativeFileOperationSuccess,
  NativeFileOperationType,
  NativeFileRoot,
  NativeFileRootKind,
  NativeFileRoots,
  NativeFilesystemEventKind,
  NativeFilesystemWatchEvent,
  PickFilesOptions,
  PickedFiles,
  PlatformCapabilities,
  PlatformNotification,
  PlatformNotificationPermission,
  PlatformServices,
  PlatformWebSurfaces,
  SaveFileOptions,
  SavedFile,
  WebSurfaceOpenRequest,
  WebSurfaceSnapshot,
} from './contracts';
import {
  denied,
  errorMessage,
  extensionsFromFilters,
  fileNameFromPath,
  invalidInput,
  normalizeExternalUrl,
  normalizeSuggestedFileName,
  operationError,
  success,
} from './shared';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type TauriUnlisten = () => void;
type PlatformFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface TauriServiceEnvironment {
  invoke: TauriInvoke;
  fetch: PlatformFetch;
}

interface TauriDialogFilter {
  name: string;
  extensions: string[];
}

export interface TauriWebSurfaceEnvironment {
  invoke: TauriInvoke;
  listen<T>(event: string, listener: (payload: T) => void): Promise<TauriUnlisten>;
}

export interface TauriCapabilityEnvironment {
  listNativeFileRoots(): Promise<unknown>;
  listNativeDirectory(path: string): Promise<unknown>;
  statNativeFile(path: string): Promise<unknown>;
  createNativeDirectory(parentPath: string, name: string): Promise<unknown>;
  createNativeFile(parentPath: string, name: string): Promise<unknown>;
  renameNativeFile(path: string, newName: string): Promise<unknown>;
  startNativeCopy(
    sources: readonly string[],
    destinationPath: string,
    conflictStrategy: NativeFileConflictStrategy,
  ): Promise<unknown>;
  startNativeMove(
    sources: readonly string[],
    destinationPath: string,
    conflictStrategy: NativeFileConflictStrategy,
  ): Promise<unknown>;
  startNativeDuplicate(sources: readonly string[]): Promise<unknown>;
  getNativeFileOperation(id: string): Promise<unknown>;
  cancelNativeFileOperation(id: string): Promise<unknown>;
  startNativeTrash(sources: readonly string[]): Promise<unknown>;
  startNativePermanentDelete(sources: readonly string[], confirmed: boolean): Promise<unknown>;
  startNativeRestore(undoId: string): Promise<unknown>;
  getNativeDeletionOperation(id: string): Promise<unknown>;
  cancelNativeDeletionOperation(id: string): Promise<unknown>;
  startNativeDirectoryWatch(path: string): Promise<unknown>;
  stopNativeDirectoryWatch(id: string): Promise<unknown>;
  getNativeDirectoryWatchDiagnostics(): Promise<unknown>;
  listenNativeFilesystemEvents(listener: (payload: unknown) => void): Promise<TauriUnlisten>;
  pickFile(options: {
    directory: false;
    multiple: boolean;
    filters?: TauriDialogFilter[];
  }): Promise<string | string[] | null>;
  saveFile(options: { defaultPath: string; filters?: TauriDialogFilter[] }): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
  openUrl(url: string): Promise<void>;
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
  isNotificationPermissionGranted(): Promise<boolean>;
  requestNotificationPermission(): Promise<PlatformNotificationPermission>;
  sendNotification(notification: { title: string; body?: string }): void | Promise<void>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
}

interface TauriLocalServiceInfo {
  origin: string;
  instanceId: string;
}

interface TauriLocalRequestAuthorization {
  origin: string;
  token: string;
  expiresAt: number;
}

const tauriServiceEnvironment: TauriServiceEnvironment = {
  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
  },
  fetch: (input, init) => globalThis.fetch(input, init),
};

const tauriWebSurfaceEnvironment: TauriWebSurfaceEnvironment = {
  invoke: tauriServiceEnvironment.invoke,
  async listen<T>(eventName: string, listener: (payload: T) => void) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<T>(eventName, (event) => listener(event.payload));
  },
};

const tauriCapabilityEnvironment: TauriCapabilityEnvironment = {
  async listNativeFileRoots() {
    return tauriServiceEnvironment.invoke('list_native_file_roots');
  },
  async listNativeDirectory(path) {
    return tauriServiceEnvironment.invoke('list_native_directory', { path });
  },
  async statNativeFile(path) {
    return tauriServiceEnvironment.invoke('stat_native_file', { path });
  },
  async createNativeDirectory(parentPath, name) {
    return tauriServiceEnvironment.invoke('create_native_directory', { parentPath, name });
  },
  async createNativeFile(parentPath, name) {
    return tauriServiceEnvironment.invoke('create_native_file', { parentPath, name });
  },
  async renameNativeFile(path, newName) {
    return tauriServiceEnvironment.invoke('rename_native_file', { path, newName });
  },
  async startNativeCopy(sources, destinationPath, conflictStrategy) {
    return tauriServiceEnvironment.invoke('start_native_copy', {
      sources,
      destinationPath,
      conflictStrategy,
    });
  },
  async startNativeMove(sources, destinationPath, conflictStrategy) {
    return tauriServiceEnvironment.invoke('start_native_move', {
      sources,
      destinationPath,
      conflictStrategy,
    });
  },
  async startNativeDuplicate(sources) {
    return tauriServiceEnvironment.invoke('start_native_duplicate', { sources });
  },
  async getNativeFileOperation(id) {
    return tauriServiceEnvironment.invoke('get_native_file_operation', { id });
  },
  async cancelNativeFileOperation(id) {
    return tauriServiceEnvironment.invoke('cancel_native_file_operation', { id });
  },
  async startNativeTrash(sources) {
    return tauriServiceEnvironment.invoke('start_native_trash', { sources });
  },
  async startNativePermanentDelete(sources, confirmed) {
    return tauriServiceEnvironment.invoke('start_native_permanent_delete', { sources, confirmed });
  },
  async startNativeRestore(undoId) {
    return tauriServiceEnvironment.invoke('start_native_restore', { undoId });
  },
  async getNativeDeletionOperation(id) {
    return tauriServiceEnvironment.invoke('get_native_deletion_operation', { id });
  },
  async cancelNativeDeletionOperation(id) {
    return tauriServiceEnvironment.invoke('cancel_native_deletion_operation', { id });
  },
  async startNativeDirectoryWatch(path) {
    return tauriServiceEnvironment.invoke('start_native_directory_watch', { path });
  },
  async stopNativeDirectoryWatch(id) {
    return tauriServiceEnvironment.invoke('stop_native_directory_watch', { id });
  },
  async getNativeDirectoryWatchDiagnostics() {
    return tauriServiceEnvironment.invoke('get_native_directory_watch_diagnostics');
  },
  async listenNativeFilesystemEvents(listener) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen('nammu://native-filesystem-change', (event) => listener(event.payload));
  },
  async pickFile(options) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    return open(options);
  },
  async saveFile(options) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    return save(options);
  },
  async readFile(path) {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return readFile(path);
  },
  async writeFile(path, contents) {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, contents);
  },
  async openUrl(url) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  },
  async readClipboardText() {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
    return readText();
  },
  async writeClipboardText(text) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
  },
  async isNotificationPermissionGranted() {
    const { isPermissionGranted } = await import('@tauri-apps/plugin-notification');
    return isPermissionGranted();
  },
  async requestNotificationPermission() {
    const { requestPermission } = await import('@tauri-apps/plugin-notification');
    return requestPermission();
  },
  async sendNotification(notification) {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    sendNotification(notification);
  },
  async minimizeWindow() {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  },
  async toggleMaximizeWindow() {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().toggleMaximize();
  },
  async closeWindow() {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  },
};

function normalizeLocalServicePath(pathAndQuery: string): string {
  if (
    typeof pathAndQuery !== 'string' ||
    pathAndQuery.length > 2_048 ||
    !pathAndQuery.startsWith('/api/') ||
    pathAndQuery.startsWith('//') ||
    pathAndQuery.includes('\\') ||
    pathAndQuery.includes('#') ||
    [...pathAndQuery].some((character) => character.charCodeAt(0) < 0x20)
  ) {
    throw new TypeError('Platform service requests require a relative /api/ path.');
  }
  return pathAndQuery;
}

function validateLocalServiceInfo(info: TauriLocalServiceInfo): TauriLocalServiceInfo {
  const url = new URL(info.origin);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== info.origin ||
    !/^[a-f0-9]{32}$/.test(info.instanceId)
  ) {
    throw new Error('The desktop local service returned an invalid identity.');
  }
  return info;
}

export function createTauriPlatformServices(
  environment: TauriServiceEnvironment = tauriServiceEnvironment,
): PlatformServices {
  let serviceInfoPromise: Promise<TauriLocalServiceInfo> | null = null;
  const getServiceInfo = () => {
    serviceInfoPromise ??= environment
      .invoke<TauriLocalServiceInfo>('get_local_service_info')
      .then(validateLocalServiceInfo)
      .catch((error) => {
        serviceInfoPromise = null;
        throw error;
      });
    return serviceInfoPromise;
  };

  return Object.freeze({
    async ready() {
      const info = await getServiceInfo();
      return {
        runtime: 'desktop-local' as const,
        origin: info.origin,
        instanceId: info.instanceId,
      };
    },
    async request(pathAndQuery: string, init: RequestInit = {}) {
      const target = normalizeLocalServicePath(pathAndQuery);
      const method = (init.method ?? 'GET').toUpperCase();
      const [info, authorization] = await Promise.all([
        getServiceInfo(),
        environment.invoke<TauriLocalRequestAuthorization>('authorize_local_request', {
          method,
          pathAndQuery: target,
        }),
      ]);
      if (
        authorization.origin !== info.origin ||
        !authorization.token ||
        !Number.isSafeInteger(authorization.expiresAt)
      ) {
        throw new Error('The desktop local service authorization is invalid.');
      }

      const headers = new Headers(init.headers);
      headers.delete('x-nammu-request');
      headers.set('x-nammu-request', authorization.token);
      const response = await environment.fetch(`${info.origin}${target}`, {
        ...init,
        method,
        headers,
        credentials: 'omit',
        redirect: 'error',
      });
      if (!response.url.startsWith(`${info.origin}/`)) {
        throw new Error('The desktop local service returned an unexpected response origin.');
      }
      return response;
    },
    async wispUrl() {
      throw new Error(
        'Gecko/Wisp is unavailable in the Desktop runtime. Remote applications use NativeWebSurface.',
      );
    },
  });
}

function tauriFailure<T>(error: unknown, fallback: string): CapabilityResult<T> {
  return operationError(errorMessage(error, fallback));
}

function validWebSurfaceSnapshot(value: unknown): value is WebSurfaceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<WebSurfaceSnapshot>;
  return (
    typeof snapshot.id === 'string' &&
    /^[a-f0-9]{32}$/.test(snapshot.id) &&
    ['browser', 'whatsapp', 'telegram', 'youtube-music'].includes(String(snapshot.owner)) &&
    typeof snapshot.url === 'string' &&
    typeof snapshot.title === 'string' &&
    typeof snapshot.isLoading === 'boolean' &&
    typeof snapshot.canGoBack === 'boolean' &&
    typeof snapshot.canGoForward === 'boolean' &&
    typeof snapshot.isAudioPlaying === 'boolean' &&
    typeof snapshot.isMuted === 'boolean' &&
    typeof snapshot.visible === 'boolean'
  );
}

function validWebSurfaceOpenRequest(value: unknown): value is WebSurfaceOpenRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<WebSurfaceOpenRequest>;
  if (
    typeof request.sourceId !== 'string' ||
    !/^[a-f0-9]{32}$/.test(request.sourceId) ||
    !['browser', 'whatsapp', 'telegram', 'youtube-music'].includes(String(request.owner)) ||
    typeof request.url !== 'string'
  )
    return false;
  try {
    const url = new URL(request.url);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.toString() === request.url
    );
  } catch {
    return false;
  }
}

export function createTauriWebSurfaces(
  environment: TauriWebSurfaceEnvironment = tauriWebSurfaceEnvironment,
): PlatformWebSurfaces {
  const command = async <T>(
    name: string,
    args: Record<string, unknown>,
    fallback: string,
  ): Promise<CapabilityResult<T>> => {
    try {
      return success(await environment.invoke<T>(name, args));
    } catch (error) {
      return tauriFailure(error, fallback);
    }
  };

  const implementation: PlatformWebSurfaces = {
    supported: true,
    async create(options) {
      const result = await command<WebSurfaceSnapshot>(
        'create_web_surface',
        options,
        'The native web surface could not be created.',
      );
      if (result.status !== 'success') return result;
      return validWebSurfaceSnapshot(result.value)
        ? result
        : operationError('The native web surface returned invalid state.');
    },
    destroy: (id) =>
      command<void>('destroy_web_surface', { id }, 'The native web surface could not be closed.'),
    navigate: (id, url) =>
      command<void>(
        'navigate_web_surface',
        { id, url },
        'The native web surface could not navigate.',
      ),
    control: (id, control) =>
      command<void>(
        'control_web_surface',
        { id, control },
        'The native web surface control failed.',
      ),
    setBounds: (id, bounds) =>
      command<void>(
        'set_web_surface_bounds',
        { id, bounds },
        'The native web surface could not be positioned.',
      ),
    setVisible: (id, visible) =>
      command<void>(
        'set_web_surface_visibility',
        { id, visible },
        'The native web surface visibility could not be changed.',
      ),
    focus: (id) =>
      command<void>('focus_web_surface', { id }, 'The native web surface could not be focused.'),
    setZoom: (id, zoom) =>
      command<void>(
        'set_web_surface_zoom',
        { id, zoom },
        'The native web surface zoom could not be changed.',
      ),
    async getState(id) {
      const result = await command<WebSurfaceSnapshot>(
        'get_web_surface_state',
        { id },
        'The native web surface state is unavailable.',
      );
      if (result.status !== 'success') return result;
      return validWebSurfaceSnapshot(result.value)
        ? result
        : operationError('The native web surface returned invalid state.');
    },
    subscribe(listener) {
      return environment.listen<WebSurfaceSnapshot>('nammu://web-surface-state', (snapshot) => {
        if (validWebSurfaceSnapshot(snapshot)) listener(snapshot);
      });
    },
    subscribeOpenRequests(listener) {
      return environment.listen<WebSurfaceOpenRequest>(
        'nammu://web-surface-open-request',
        (request) => {
          if (validWebSurfaceOpenRequest(request)) listener(request);
        },
      );
    },
  };
  return Object.freeze(implementation);
}

function inferMimeType(fileName: string): string | null {
  const extension = fileName.split('.').at(-1)?.toLowerCase();
  return (
    (
      {
        json: 'application/json',
        txt: 'text/plain',
        csv: 'text/csv',
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        flac: 'audio/flac',
        mp4: 'video/mp4',
        webm: 'video/webm',
      } as Record<string, string>
    )[extension ?? ''] ?? null
  );
}

const FILESYSTEM_ERROR_CODES = new Set<FilesystemErrorCode>([
  'NOT_FOUND',
  'ACCESS_DENIED',
  'NOT_DIRECTORY',
  'DRIVE_UNAVAILABLE',
  'INVALID_PATH',
  'ALREADY_EXISTS',
  'INVALID_NAME',
  'INVALID_DESTINATION',
  'FILE_IN_USE',
  'READ_ONLY',
  'SOURCE_EQUALS_DESTINATION',
  'DESTINATION_INSIDE_SOURCE',
  'OPERATION_CANCELLED',
  'RECYCLE_UNSUPPORTED',
  'ROOT_OPERATION_FORBIDDEN',
  'CONFIRMATION_REQUIRED',
  'UNDO_UNAVAILABLE',
  'WATCH_UNSUPPORTED',
  'WATCH_FAILED',
  'IO_ERROR',
]);
const FILE_OPERATION_TYPES = new Set<NativeFileOperationType>(['copy', 'move', 'duplicate']);
const FILE_OPERATION_STATES = new Set<NativeFileOperationState>([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
const DELETION_OPERATION_TYPES = new Set<NativeDeletionOperationType>([
  'trash',
  'permanent-delete',
  'restore',
]);
const DELETION_CANCELLATION_MODES = new Set<NativeDeletionCancellationMode>([
  'recoverable-between-items',
  'stop-remaining-only',
]);
const ROOT_KINDS = new Set<NativeFileRootKind>([
  'local',
  'removable',
  'network',
  'optical',
  'ram-disk',
  'other',
]);
const FILE_KINDS = new Set<NativeFileKind>(['file', 'directory', 'reparse-point', 'other']);
const FILESYSTEM_EVENT_KINDS = new Set<NativeFilesystemEventKind>([
  'created',
  'removed',
  'renamed',
  'modified',
  'metadata',
  'rescan-required',
  'watch-error',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableSafeNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function isDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validFilesystemError(value: unknown): value is FilesystemError {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    FILESYSTEM_ERROR_CODES.has(value.code as FilesystemErrorCode) &&
    typeof value.message === 'string' &&
    value.message.length > 0 &&
    value.message.length <= 240
  );
}

function validNativeRoot(value: unknown): value is NativeFileRoot {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    value.path.length > 0 &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.kind === 'string' &&
    ROOT_KINDS.has(value.kind as NativeFileRootKind) &&
    isNullableString(value.label) &&
    isNullableString(value.fileSystem) &&
    isNullableSafeNumber(value.totalBytes) &&
    isNullableSafeNumber(value.freeBytes) &&
    typeof value.accessible === 'boolean'
  );
}

function validNativeMetadata(value: unknown): value is NativeFileMetadata {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    value.path.length > 0 &&
    typeof value.kind === 'string' &&
    FILE_KINDS.has(value.kind as NativeFileKind) &&
    isNullableSafeNumber(value.sizeBytes) &&
    isNullableSafeNumber(value.createdAtMs) &&
    isNullableSafeNumber(value.modifiedAtMs) &&
    isNullableString(value.extension) &&
    typeof value.hidden === 'boolean' &&
    typeof value.system === 'boolean' &&
    typeof value.readOnly === 'boolean' &&
    typeof value.readable === 'boolean' &&
    typeof value.navigable === 'boolean'
  );
}

function validBreadcrumb(value: unknown): value is NativeFileBreadcrumb {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.path === 'string' &&
    value.path.length > 0
  );
}

function validNativeRoots(value: unknown): value is NativeFileRoots {
  return (
    isRecord(value) &&
    Array.isArray(value.roots) &&
    value.roots.every(validNativeRoot) &&
    isDuration(value.durationMs)
  );
}

function validDirectoryListing(value: unknown): value is NativeDirectoryListing {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    value.path.length > 0 &&
    isNullableString(value.parentPath) &&
    Array.isArray(value.breadcrumbs) &&
    value.breadcrumbs.every(validBreadcrumb) &&
    Array.isArray(value.entries) &&
    value.entries.every(validNativeMetadata) &&
    Number.isSafeInteger(value.omittedEntries) &&
    Number(value.omittedEntries) >= 0 &&
    isDuration(value.durationMs)
  );
}

function validMutation(value: unknown): value is NativeFileMutation {
  return (
    isRecord(value) &&
    validNativeMetadata(value.entry) &&
    Array.isArray(value.affectedDirectories) &&
    value.affectedDirectories.every((path) => typeof path === 'string' && path.length > 0)
  );
}

function validOperationSuccess(value: unknown): value is NativeFileOperationSuccess {
  return (
    isRecord(value) &&
    typeof value.sourcePath === 'string' &&
    value.sourcePath.length > 0 &&
    typeof value.destinationPath === 'string' &&
    value.destinationPath.length > 0 &&
    validNativeMetadata(value.entry)
  );
}

function validOperationFailure(value: unknown): value is NativeFileOperationFailure {
  return (
    isRecord(value) &&
    typeof value.sourcePath === 'string' &&
    value.sourcePath.length > 0 &&
    validFilesystemError(value.error)
  );
}

function validOperationSnapshot(value: unknown): value is NativeFileOperationSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{32}$/.test(value.id) &&
    typeof value.operation === 'string' &&
    FILE_OPERATION_TYPES.has(value.operation as NativeFileOperationType) &&
    typeof value.state === 'string' &&
    FILE_OPERATION_STATES.has(value.state as NativeFileOperationState) &&
    Array.isArray(value.sources) &&
    value.sources.length > 0 &&
    value.sources.every((path) => typeof path === 'string' && path.length > 0) &&
    isNullableString(value.destinationPath) &&
    isNullableString(value.currentItem) &&
    isNullableSafeNumber(value.filesTotal) &&
    isNullableSafeNumber(value.bytesTotal) &&
    isNullableSafeNumber(value.filesCompleted) &&
    value.filesCompleted !== null &&
    isNullableSafeNumber(value.bytesProcessed) &&
    value.bytesProcessed !== null &&
    Array.isArray(value.successes) &&
    value.successes.every(validOperationSuccess) &&
    Array.isArray(value.failures) &&
    value.failures.every(validOperationFailure)
  );
}

function validDeletionSuccess(value: unknown): value is NativeDeletionSuccess {
  return (
    isRecord(value) &&
    typeof value.sourcePath === 'string' &&
    value.sourcePath.length > 0 &&
    isNullableString(value.destinationPath)
  );
}

function validDeletionFailure(value: unknown): value is NativeDeletionFailure {
  return (
    isRecord(value) &&
    typeof value.sourcePath === 'string' &&
    value.sourcePath.length > 0 &&
    validFilesystemError(value.error)
  );
}

function validDeletionSnapshot(value: unknown): value is NativeDeletionOperationSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{32}$/.test(value.id) &&
    typeof value.operation === 'string' &&
    DELETION_OPERATION_TYPES.has(value.operation as NativeDeletionOperationType) &&
    typeof value.state === 'string' &&
    FILE_OPERATION_STATES.has(value.state as NativeFileOperationState) &&
    Array.isArray(value.sources) &&
    value.sources.length > 0 &&
    value.sources.every((path) => typeof path === 'string' && path.length > 0) &&
    isNullableString(value.currentItem) &&
    isNullableSafeNumber(value.filesCompleted) &&
    value.filesCompleted !== null &&
    isNullableSafeNumber(value.filesTotal) &&
    value.filesTotal !== null &&
    Array.isArray(value.successes) &&
    value.successes.every(validDeletionSuccess) &&
    Array.isArray(value.failures) &&
    value.failures.every(validDeletionFailure) &&
    isNullableString(value.undoId) &&
    typeof value.reversible === 'boolean' &&
    typeof value.cancellationMode === 'string' &&
    DELETION_CANCELLATION_MODES.has(value.cancellationMode as NativeDeletionCancellationMode)
  );
}

function validWatchRegistration(value: unknown): value is { id: string; path: string } {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{32}$/.test(value.id) &&
    typeof value.path === 'string' &&
    value.path.length > 0
  );
}

function validWatchStop(value: unknown): value is { stopped: boolean; activeWatchers: number } {
  return (
    isRecord(value) &&
    value.stopped === true &&
    Number.isSafeInteger(value.activeWatchers) &&
    Number(value.activeWatchers) >= 0
  );
}

function validWatchDiagnostics(value: unknown): value is NativeDirectoryWatchDiagnostics {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.activeWatchers) &&
    Number(value.activeWatchers) >= 0 &&
    Number.isSafeInteger(value.rawEvents) &&
    Number(value.rawEvents) >= 0 &&
    Number.isSafeInteger(value.emittedInvalidations) &&
    Number(value.emittedInvalidations) >= 0 &&
    Number.isSafeInteger(value.droppedSignals) &&
    Number(value.droppedSignals) >= 0
  );
}

function validFilesystemWatchEvent(value: unknown): value is NativeFilesystemWatchEvent {
  return (
    isRecord(value) &&
    typeof value.watchId === 'string' &&
    /^[a-f0-9]{32}$/.test(value.watchId) &&
    typeof value.rootPath === 'string' &&
    value.rootPath.length > 0 &&
    typeof value.kind === 'string' &&
    FILESYSTEM_EVENT_KINDS.has(value.kind as NativeFilesystemEventKind) &&
    Array.isArray(value.paths) &&
    value.paths.length <= 32 &&
    value.paths.every((path) => typeof path === 'string' && path.length > 0) &&
    Number.isSafeInteger(value.rawEventCount) &&
    Number(value.rawEventCount) > 0 &&
    typeof value.rescanRequired === 'boolean' &&
    (value.error === null || validFilesystemError(value.error))
  );
}

function decodeFilesystemResponse<T>(
  response: unknown,
  validator: (value: unknown) => value is T,
): FilesystemResult<T> {
  if (!isRecord(response)) {
    return {
      status: 'error',
      error: { code: 'IO_ERROR', message: 'The native filesystem returned invalid data.' },
    };
  }
  if (response.status === 'error' && validFilesystemError(response.error)) {
    return { status: 'error', error: response.error };
  }
  if (response.status === 'success' && validator(response.value)) {
    return { status: 'success', value: response.value };
  }
  return {
    status: 'error',
    error: { code: 'IO_ERROR', message: 'The native filesystem returned invalid data.' },
  };
}

function filesystemFailure<T>(): FilesystemResult<T> {
  return {
    status: 'error',
    error: { code: 'IO_ERROR', message: 'The native filesystem service is unavailable.' },
  };
}

function invalidFilesystemPath<T>(): FilesystemResult<T> {
  return {
    status: 'error',
    error: { code: 'INVALID_PATH', message: 'The filesystem path is invalid.' },
  };
}

function invalidFilesystemName<T>(): FilesystemResult<T> {
  return {
    status: 'error',
    error: { code: 'INVALID_NAME', message: 'The item name is not valid on Windows.' },
  };
}

function validFilesystemPath(path: string): boolean {
  return Boolean(path) && !path.includes('\0');
}

function validFilesystemName(name: string): boolean {
  return Boolean(name) && !name.includes('\0') && name.length <= 255;
}

export function createTauriPlatformCapabilities(
  environment: TauriCapabilityEnvironment = tauriCapabilityEnvironment,
  services: PlatformServices = createTauriPlatformServices(),
): PlatformCapabilities {
  return Object.freeze({
    runtime: 'tauri' as const,
    services,
    webSurfaces: createTauriWebSurfaces(),
    filesystem: Object.freeze({
      supported: true,
      async listRoots(): Promise<FilesystemResult<NativeFileRoots>> {
        try {
          return decodeFilesystemResponse(
            await environment.listNativeFileRoots(),
            validNativeRoots,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async listDirectory(path: string): Promise<FilesystemResult<NativeDirectoryListing>> {
        if (!path || path.includes('\0')) {
          return {
            status: 'error',
            error: { code: 'INVALID_PATH', message: 'The filesystem path is invalid.' },
          };
        }
        try {
          return decodeFilesystemResponse(
            await environment.listNativeDirectory(path),
            validDirectoryListing,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async stat(path: string): Promise<FilesystemResult<NativeFileMetadata>> {
        if (!path || path.includes('\0')) {
          return {
            status: 'error',
            error: { code: 'INVALID_PATH', message: 'The filesystem path is invalid.' },
          };
        }
        try {
          return decodeFilesystemResponse(
            await environment.statNativeFile(path),
            validNativeMetadata,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async createDirectory(
        parentPath: string,
        name: string,
      ): Promise<FilesystemResult<NativeFileMutation>> {
        if (!validFilesystemPath(parentPath)) {
          return invalidFilesystemPath();
        }
        if (!validFilesystemName(name)) return invalidFilesystemName();
        try {
          return decodeFilesystemResponse(
            await environment.createNativeDirectory(parentPath, name),
            validMutation,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async createFile(
        parentPath: string,
        name: string,
      ): Promise<FilesystemResult<NativeFileMutation>> {
        if (!validFilesystemPath(parentPath)) {
          return invalidFilesystemPath();
        }
        if (!validFilesystemName(name)) return invalidFilesystemName();
        try {
          return decodeFilesystemResponse(
            await environment.createNativeFile(parentPath, name),
            validMutation,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async rename(path: string, newName: string): Promise<FilesystemResult<NativeFileMutation>> {
        if (!validFilesystemPath(path)) {
          return invalidFilesystemPath();
        }
        if (!validFilesystemName(newName)) return invalidFilesystemName();
        try {
          return decodeFilesystemResponse(
            await environment.renameNativeFile(path, newName),
            validMutation,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async copy(
        sources: readonly string[],
        destinationPath: string,
        conflictStrategy: NativeFileConflictStrategy = 'cancel',
      ): Promise<FilesystemResult<NativeFileOperationSnapshot>> {
        if (
          sources.length === 0 ||
          sources.some((path) => !validFilesystemPath(path)) ||
          !validFilesystemPath(destinationPath)
        ) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.startNativeCopy(sources, destinationPath, conflictStrategy),
            validOperationSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async move(
        sources: readonly string[],
        destinationPath: string,
        conflictStrategy: NativeFileConflictStrategy = 'cancel',
      ): Promise<FilesystemResult<NativeFileOperationSnapshot>> {
        if (
          sources.length === 0 ||
          sources.some((path) => !validFilesystemPath(path)) ||
          !validFilesystemPath(destinationPath)
        ) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.startNativeMove(sources, destinationPath, conflictStrategy),
            validOperationSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async duplicate(
        sources: readonly string[],
      ): Promise<FilesystemResult<NativeFileOperationSnapshot>> {
        if (sources.length === 0 || sources.some((path) => !validFilesystemPath(path))) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.startNativeDuplicate(sources),
            validOperationSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async getOperation(id: string): Promise<FilesystemResult<NativeFileOperationSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.getNativeFileOperation(id),
            validOperationSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async cancelOperation(id: string): Promise<FilesystemResult<NativeFileOperationSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.cancelNativeFileOperation(id),
            validOperationSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async trash(
        sources: readonly string[],
      ): Promise<FilesystemResult<NativeDeletionOperationSnapshot>> {
        if (sources.length === 0 || sources.some((path) => !validFilesystemPath(path))) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.startNativeTrash(sources),
            validDeletionSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async permanentlyDelete(
        sources: readonly string[],
        confirmed: boolean,
      ): Promise<FilesystemResult<NativeDeletionOperationSnapshot>> {
        if (sources.length === 0 || sources.some((path) => !validFilesystemPath(path))) {
          return invalidFilesystemPath();
        }
        if (!confirmed) {
          return {
            status: 'error',
            error: {
              code: 'CONFIRMATION_REQUIRED',
              message: 'Permanent deletion requires explicit confirmation.',
            },
          };
        }
        try {
          return decodeFilesystemResponse(
            await environment.startNativePermanentDelete(sources, confirmed),
            validDeletionSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async restore(undoId: string): Promise<FilesystemResult<NativeDeletionOperationSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(undoId)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.startNativeRestore(undoId),
            validDeletionSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async getDeletionOperation(
        id: string,
      ): Promise<FilesystemResult<NativeDeletionOperationSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.getNativeDeletionOperation(id),
            validDeletionSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async cancelDeletionOperation(
        id: string,
      ): Promise<FilesystemResult<NativeDeletionOperationSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.cancelNativeDeletionOperation(id),
            validDeletionSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async watchDirectory(
        path: string,
        listener: (event: NativeFilesystemWatchEvent) => void,
      ): Promise<FilesystemResult<NativeDirectoryWatchSubscription>> {
        if (!validFilesystemPath(path)) return invalidFilesystemPath();
        let disposed = false;
        let watchId: string | null = null;
        const earlyEvents: NativeFilesystemWatchEvent[] = [];
        let unlisten: TauriUnlisten;
        try {
          unlisten = await environment.listenNativeFilesystemEvents((payload) => {
            if (disposed || !validFilesystemWatchEvent(payload)) return;
            if (!watchId) {
              if (earlyEvents.length < 64) earlyEvents.push(payload);
              return;
            }
            if (payload.watchId === watchId) listener(payload);
          });
        } catch {
          return filesystemFailure();
        }
        let started: FilesystemResult<{ id: string; path: string }>;
        try {
          started = decodeFilesystemResponse(
            await environment.startNativeDirectoryWatch(path),
            validWatchRegistration,
          );
        } catch {
          unlisten();
          return filesystemFailure();
        }
        if (started.status !== 'success') {
          unlisten();
          return started;
        }
        watchId = started.value.id;
        for (const event of earlyEvents) {
          if (event.watchId === watchId) listener(event);
        }
        const registration = started.value;
        return {
          status: 'success',
          value: Object.freeze({
            id: registration.id,
            path: registration.path,
            async dispose() {
              if (disposed) return;
              disposed = true;
              unlisten();
              try {
                decodeFilesystemResponse(
                  await environment.stopNativeDirectoryWatch(registration.id),
                  validWatchStop,
                );
              } catch {
                // Disposal is best-effort after the native runtime has begun shutting down.
              }
            },
          }),
        };
      },
      async getWatchDiagnostics(): Promise<FilesystemResult<NativeDirectoryWatchDiagnostics>> {
        try {
          return decodeFilesystemResponse(
            await environment.getNativeDirectoryWatchDiagnostics(),
            validWatchDiagnostics,
          );
        } catch {
          return filesystemFailure();
        }
      },
    }),
    files: Object.freeze({
      async pick(options: PickFilesOptions = {}): Promise<CapabilityResult<PickedFiles>> {
        try {
          const filters = extensionsFromFilters(options.filters);
          const selection = await environment.pickFile({
            directory: false,
            multiple: Boolean(options.multiple),
            ...(filters.length > 0 ? { filters } : {}),
          });
          if (!selection) return { status: 'cancelled' };

          const paths = Array.isArray(selection) ? selection : [selection];
          const files = await Promise.all(
            paths.map(async (path) => {
              const bytes = await environment.readFile(path);
              const name = fileNameFromPath(path, 'Selected file');
              return {
                name,
                mimeType: inferMimeType(name),
                size: bytes.byteLength,
                bytes,
              };
            }),
          );
          return success({ files });
        } catch (error) {
          return tauriFailure(error, 'The selected file could not be read.');
        }
      },

      async save(options: SaveFileOptions): Promise<CapabilityResult<SavedFile>> {
        const fileName = normalizeSuggestedFileName(options.suggestedName);
        if (!fileName) return invalidInput('A safe file name is required.');

        try {
          const filters = extensionsFromFilters(options.filters);
          const path = await environment.saveFile({
            defaultPath: fileName,
            ...(filters.length > 0 ? { filters } : {}),
          });
          if (!path) return { status: 'cancelled' };

          const bytes =
            typeof options.contents === 'string'
              ? new TextEncoder().encode(options.contents)
              : options.contents;
          await environment.writeFile(path, bytes);
          return success({ fileName: fileNameFromPath(path, fileName) });
        } catch (error) {
          return tauriFailure(error, 'The file could not be saved.');
        }
      },
    }),
    external: Object.freeze({
      async openUrl(input: string): Promise<CapabilityResult<void>> {
        const url = normalizeExternalUrl(input);
        if (!url)
          return invalidInput(
            'Only credential-free HTTP, HTTPS, mailto, and tel URLs are allowed.',
          );

        try {
          await environment.openUrl(url);
          return success(undefined);
        } catch (error) {
          return tauriFailure(error, 'The URL could not be opened.');
        }
      },
    }),
    clipboard: Object.freeze({
      async readText(): Promise<CapabilityResult<string>> {
        try {
          return success(await environment.readClipboardText());
        } catch (error) {
          return tauriFailure(error, 'The clipboard could not be read.');
        }
      },
      async writeText(text: string): Promise<CapabilityResult<void>> {
        if (typeof text !== 'string') return invalidInput('Clipboard text must be a string.');

        try {
          await environment.writeClipboardText(text);
          return success(undefined);
        } catch (error) {
          return tauriFailure(error, 'The clipboard could not be written.');
        }
      },
    }),
    notifications: Object.freeze({
      async requestPermission(): Promise<CapabilityResult<PlatformNotificationPermission>> {
        try {
          if (await environment.isNotificationPermissionGranted()) return success('granted');
          return success(await environment.requestNotificationPermission());
        } catch (error) {
          return tauriFailure(error, 'Notification permission could not be requested.');
        }
      },
      async show(notification: PlatformNotification): Promise<CapabilityResult<void>> {
        if (!notification.title.trim()) return invalidInput('A notification title is required.');

        try {
          if (!(await environment.isNotificationPermissionGranted())) {
            return denied('Notification permission has not been granted.');
          }
          await environment.sendNotification({
            title: notification.title,
            body: notification.body,
          });
          return success(undefined);
        } catch (error) {
          return tauriFailure(error, 'The notification could not be shown.');
        }
      },
    }),
    window: Object.freeze({
      async minimize(): Promise<CapabilityResult<void>> {
        try {
          await environment.minimizeWindow();
          return success(undefined);
        } catch (error) {
          return tauriFailure(error, 'The native window could not be minimized.');
        }
      },
      async toggleMaximize(): Promise<CapabilityResult<void>> {
        try {
          await environment.toggleMaximizeWindow();
          return success(undefined);
        } catch (error) {
          return tauriFailure(error, 'The native window could not change its maximized state.');
        }
      },
      async close(): Promise<CapabilityResult<void>> {
        try {
          await environment.closeWindow();
          return success(undefined);
        } catch (error) {
          return tauriFailure(error, 'The native window could not be closed.');
        }
      },
    }),
  });
}

export const tauriPlatformCapabilities = createTauriPlatformCapabilities();
