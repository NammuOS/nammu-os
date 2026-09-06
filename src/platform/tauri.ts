import type {
  CapabilityResult,
  DirectoryMeasurementDiagnostics,
  DirectoryMeasurementSnapshot,
  DirectoryMeasurementState,
  FilesystemError,
  FilesystemErrorCode,
  FilesystemResult,
  NativeArchiveConflictStrategy,
  NativeArchiveDiagnostics,
  NativeArchiveEntry,
  NativeArchiveEntryKind,
  NativeArchiveListing,
  NativeArchiveOperationSnapshot,
  NativeArchiveOperationState,
  NativeArchiveOperationType,
  NativeArchiveSummary,
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
  NativeFileProperties,
  NativeFilePropertyItem,
  NativeFilePreviewDescriptor,
  NativeFilePreviewDiagnostics,
  NativeFilePreviewKind,
  NativeFilePreviewMode,
  NativeFilePreviewRequest,
  NativeFilePreviewSnapshot,
  NativeFilePreviewState,
  NativeFileRoot,
  NativeFileRootKind,
  NativePropertyItemKind,
  NativeFileRoots,
  NativeFileSearchDiagnostics,
  NativeFileSearchKind,
  NativeFileSearchQuery,
  NativeFileSearchScope,
  NativeFileSearchSnapshot,
  NativeFileSearchState,
  NativeFilesystemEventKind,
  NativeFilesystemWatchEvent,
  NativeVolumeProperties,
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
  startNativeFileSearch(query: NativeFileSearchQuery): Promise<unknown>;
  getNativeFileSearch(id: string, resultOffset: number): Promise<unknown>;
  cancelNativeFileSearch(id: string): Promise<unknown>;
  releaseNativeFileSearch(id: string): Promise<unknown>;
  getNativeFileSearchDiagnostics(): Promise<unknown>;
  startNativeFilePreview(request: NativeFilePreviewRequest): Promise<unknown>;
  getNativeFilePreview(id: string): Promise<unknown>;
  takeNativeFilePreviewBytes(id: string): Promise<unknown>;
  cancelNativeFilePreview(id: string): Promise<unknown>;
  releaseNativeFilePreview(id: string): Promise<unknown>;
  getNativeFilePreviewDiagnostics(): Promise<unknown>;
  getNativeFileProperties(paths: readonly string[]): Promise<unknown>;
  startNativeDirectoryMeasurement(paths: readonly string[]): Promise<unknown>;
  getNativeDirectoryMeasurement(id: string): Promise<unknown>;
  cancelNativeDirectoryMeasurement(id: string): Promise<unknown>;
  releaseNativeDirectoryMeasurement(id: string): Promise<unknown>;
  getNativeDirectoryMeasurementDiagnostics(): Promise<unknown>;
  openNativeArchive(path: string): Promise<unknown>;
  getNativeArchiveEntries(
    archiveId: string,
    path: string,
    offset: number,
    limit: number,
    query?: string,
  ): Promise<unknown>;
  releaseNativeArchive(archiveId: string): Promise<unknown>;
  startNativeArchiveExtract(
    archiveId: string,
    destinationPath: string,
    selectedEntryIds: readonly string[],
    conflictStrategy: NativeArchiveConflictStrategy,
  ): Promise<unknown>;
  startNativeZipCreate(
    sources: readonly string[],
    destinationPath: string,
    conflictStrategy: NativeArchiveConflictStrategy,
  ): Promise<unknown>;
  getNativeArchiveOperation(id: string): Promise<unknown>;
  cancelNativeArchiveOperation(id: string): Promise<unknown>;
  releaseNativeArchiveOperation(id: string): Promise<unknown>;
  getNativeArchiveDiagnostics(): Promise<unknown>;
  pickFile(options: {
    directory: boolean;
    multiple: boolean;
    filters?: TauriDialogFilter[];
    defaultPath?: string;
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
  async startNativeFileSearch(query) {
    return tauriServiceEnvironment.invoke('start_native_file_search', { query });
  },
  async getNativeFileSearch(id, resultOffset) {
    return tauriServiceEnvironment.invoke('get_native_file_search', { id, resultOffset });
  },
  async cancelNativeFileSearch(id) {
    return tauriServiceEnvironment.invoke('cancel_native_file_search', { id });
  },
  async releaseNativeFileSearch(id) {
    return tauriServiceEnvironment.invoke('release_native_file_search', { id });
  },
  async getNativeFileSearchDiagnostics() {
    return tauriServiceEnvironment.invoke('get_native_file_search_diagnostics');
  },
  async startNativeFilePreview(request) {
    return tauriServiceEnvironment.invoke('start_native_file_preview', { request });
  },
  async getNativeFilePreview(id) {
    return tauriServiceEnvironment.invoke('get_native_file_preview', { id });
  },
  async takeNativeFilePreviewBytes(id) {
    return tauriServiceEnvironment.invoke<ArrayBuffer>('take_native_file_preview_bytes', { id });
  },
  async cancelNativeFilePreview(id) {
    return tauriServiceEnvironment.invoke('cancel_native_file_preview', { id });
  },
  async releaseNativeFilePreview(id) {
    return tauriServiceEnvironment.invoke('release_native_file_preview', { id });
  },
  async getNativeFilePreviewDiagnostics() {
    return tauriServiceEnvironment.invoke('get_native_file_preview_diagnostics');
  },
  async getNativeFileProperties(paths) {
    return tauriServiceEnvironment.invoke('get_native_file_properties', { paths });
  },
  async startNativeDirectoryMeasurement(paths) {
    return tauriServiceEnvironment.invoke('start_native_directory_measurement', { paths });
  },
  async getNativeDirectoryMeasurement(id) {
    return tauriServiceEnvironment.invoke('get_native_directory_measurement', { id });
  },
  async cancelNativeDirectoryMeasurement(id) {
    return tauriServiceEnvironment.invoke('cancel_native_directory_measurement', { id });
  },
  async releaseNativeDirectoryMeasurement(id) {
    return tauriServiceEnvironment.invoke('release_native_directory_measurement', { id });
  },
  async getNativeDirectoryMeasurementDiagnostics() {
    return tauriServiceEnvironment.invoke('get_native_directory_measurement_diagnostics');
  },
  async openNativeArchive(path) {
    return tauriServiceEnvironment.invoke('open_native_archive', { path });
  },
  async getNativeArchiveEntries(archiveId, path, offset, limit, query) {
    return tauriServiceEnvironment.invoke('get_native_archive_entries', {
      archiveId,
      path,
      offset,
      limit,
      ...(query ? { query } : {}),
    });
  },
  async releaseNativeArchive(archiveId) {
    return tauriServiceEnvironment.invoke('release_native_archive', { archiveId });
  },
  async startNativeArchiveExtract(archiveId, destinationPath, selectedEntryIds, conflictStrategy) {
    return tauriServiceEnvironment.invoke('start_native_archive_extract', {
      archiveId,
      destinationPath,
      selectedEntryIds,
      conflictStrategy,
    });
  },
  async startNativeZipCreate(sources, destinationPath, conflictStrategy) {
    return tauriServiceEnvironment.invoke('start_native_zip_create', {
      sources,
      destinationPath,
      conflictStrategy,
    });
  },
  async getNativeArchiveOperation(id) {
    return tauriServiceEnvironment.invoke('get_native_archive_operation', { id });
  },
  async cancelNativeArchiveOperation(id) {
    return tauriServiceEnvironment.invoke('cancel_native_archive_operation', { id });
  },
  async releaseNativeArchiveOperation(id) {
    return tauriServiceEnvironment.invoke('release_native_archive_operation', { id });
  },
  async getNativeArchiveDiagnostics() {
    return tauriServiceEnvironment.invoke('get_native_archive_diagnostics');
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
  'PREVIEW_UNSUPPORTED',
  'PDF_ENCRYPTED',
  'DECODE_FAILED',
  'FILE_CHANGED',
  'ARCHIVE_UNSUPPORTED',
  'ARCHIVE_INVALID',
  'ARCHIVE_ENCRYPTED',
  'ARCHIVE_LIMIT_EXCEEDED',
  'ARCHIVE_ENTRY_UNSAFE',
  'ARCHIVE_CORRUPT',
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
const FILE_SEARCH_SCOPES = new Set<NativeFileSearchScope>([
  'current-folder',
  'current-tree',
  'selected-drive',
]);
const FILE_SEARCH_KINDS = new Set<NativeFileSearchKind>(['all', 'files', 'folders']);
const FILE_SEARCH_STATES = new Set<NativeFileSearchState>([
  'queued',
  'running',
  'completed',
  'cancelled',
  'failed',
]);
const FILE_PREVIEW_MODES = new Set<NativeFilePreviewMode>([
  'thumbnail',
  'image-preview',
  'text-preview',
]);
const FILE_PREVIEW_STATES = new Set<NativeFilePreviewState>([
  'queued',
  'running',
  'completed',
  'cancelled',
  'failed',
]);
const FILE_PREVIEW_KINDS = new Set<NativeFilePreviewKind>(['image', 'text']);
const PROPERTY_ITEM_KINDS = new Set<NativePropertyItemKind>([
  'file',
  'directory',
  'drive',
  'symbolic-link',
  'junction',
  'other-reparse',
  'other',
  'unavailable',
]);
const DIRECTORY_MEASUREMENT_STATES = new Set<DirectoryMeasurementState>([
  'queued',
  'running',
  'completed',
  'cancelled',
  'failed',
]);
const ARCHIVE_ENTRY_KINDS = new Set<NativeArchiveEntryKind>(['file', 'directory', 'symlink']);
const ARCHIVE_OPERATION_TYPES = new Set<NativeArchiveOperationType>(['extract', 'create-zip']);
const ARCHIVE_OPERATION_STATES = new Set<NativeArchiveOperationState>([
  'queued',
  'running',
  'completed',
  'cancelled',
  'failed',
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

function validSearchQuery(value: unknown): value is NativeFileSearchQuery {
  return (
    isRecord(value) &&
    typeof value.rootPath === 'string' &&
    value.rootPath.length > 0 &&
    typeof value.text === 'string' &&
    value.text.length <= 256 &&
    typeof value.scope === 'string' &&
    FILE_SEARCH_SCOPES.has(value.scope as NativeFileSearchScope) &&
    typeof value.kind === 'string' &&
    FILE_SEARCH_KINDS.has(value.kind as NativeFileSearchKind) &&
    Array.isArray(value.extensions) &&
    value.extensions.length <= 16 &&
    value.extensions.every(
      (extension) => typeof extension === 'string' && /^[a-zA-Z0-9_-]{1,24}$/.test(extension),
    )
  );
}

function validSearchSnapshot(value: unknown): value is NativeFileSearchSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{32}$/.test(value.id) &&
    validSearchQuery(value.query) &&
    typeof value.state === 'string' &&
    FILE_SEARCH_STATES.has(value.state as NativeFileSearchState) &&
    Number.isSafeInteger(value.scannedEntries) &&
    Number(value.scannedEntries) >= 0 &&
    Number.isSafeInteger(value.matchedEntries) &&
    Number(value.matchedEntries) >= 0 &&
    Number.isSafeInteger(value.inaccessibleEntries) &&
    Number(value.inaccessibleEntries) >= 0 &&
    Number.isSafeInteger(value.retainedResults) &&
    Number(value.retainedResults) >= 0 &&
    Number(value.retainedResults) <= 5_000 &&
    value.resultLimit === 5_000 &&
    typeof value.truncated === 'boolean' &&
    isDuration(value.durationMs) &&
    Number.isSafeInteger(value.resultOffset) &&
    Number(value.resultOffset) >= 0 &&
    Number(value.resultOffset) <= 5_000 &&
    Array.isArray(value.results) &&
    value.results.length <= 200 &&
    value.results.every(validNativeMetadata) &&
    (value.error === null || validFilesystemError(value.error))
  );
}

function validSearchRelease(value: unknown): value is { released: true } {
  return isRecord(value) && value.released === true;
}

function validSearchDiagnostics(value: unknown): value is NativeFileSearchDiagnostics {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.activeSearches) &&
    Number(value.activeSearches) >= 0 &&
    Number(value.activeSearches) <= 2 &&
    Number.isSafeInteger(value.retainedSearches) &&
    Number(value.retainedSearches) >= 0 &&
    Number(value.retainedSearches) <= 16 &&
    Number.isSafeInteger(value.retainedResults) &&
    Number(value.retainedResults) >= 0 &&
    Number(value.retainedResults) <= 80_000
  );
}

function validPreviewRequest(value: unknown): value is NativeFilePreviewRequest {
  return (
    isRecord(value) &&
    validFilesystemPath(String(value.path ?? '')) &&
    typeof value.mode === 'string' &&
    FILE_PREVIEW_MODES.has(value.mode as NativeFilePreviewMode) &&
    Number.isSafeInteger(value.requestedWidth) &&
    Number(value.requestedWidth) >= 0 &&
    Number(value.requestedWidth) <= 1_024 &&
    Number.isSafeInteger(value.requestedHeight) &&
    Number(value.requestedHeight) >= 0 &&
    Number(value.requestedHeight) <= 1_024
  );
}

function validPreviewDescriptor(value: unknown): value is NativeFilePreviewDescriptor {
  return (
    isRecord(value) &&
    typeof value.kind === 'string' &&
    FILE_PREVIEW_KINDS.has(value.kind as NativeFilePreviewKind) &&
    typeof value.mimeType === 'string' &&
    isNullableSafeNumber(value.width) &&
    isNullableSafeNumber(value.height) &&
    isNullableSafeNumber(value.sourceWidth) &&
    isNullableSafeNumber(value.sourceHeight) &&
    isNullableSafeNumber(value.pageCount) &&
    isNullableSafeNumber(value.durationMs) &&
    Number.isSafeInteger(value.byteLength) &&
    Number(value.byteLength) >= 0 &&
    Number(value.byteLength) <= 8 * 1024 * 1024 &&
    isNullableString(value.text) &&
    (value.text === null || value.text.length <= 512 * 1024) &&
    typeof value.truncated === 'boolean' &&
    typeof value.cacheHit === 'boolean'
  );
}

function validPreviewSnapshot(value: unknown): value is NativeFilePreviewSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{32}$/.test(value.id) &&
    validPreviewRequest(value.request) &&
    typeof value.state === 'string' &&
    FILE_PREVIEW_STATES.has(value.state as NativeFilePreviewState) &&
    isDuration(value.durationMs) &&
    (value.result === null || validPreviewDescriptor(value.result)) &&
    (value.error === null || validFilesystemError(value.error))
  );
}

function validPreviewDiagnostics(value: unknown): value is NativeFilePreviewDiagnostics {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.activeJobs) &&
    Number(value.activeJobs) >= 0 &&
    Number(value.activeJobs) <= 4 &&
    Number.isSafeInteger(value.retainedJobs) &&
    Number(value.retainedJobs) >= 0 &&
    Number(value.retainedJobs) <= 64 &&
    Number.isSafeInteger(value.retainedResultBytes) &&
    Number(value.retainedResultBytes) >= 0 &&
    Number.isSafeInteger(value.cacheEntries) &&
    Number(value.cacheEntries) >= 0 &&
    Number(value.cacheEntries) <= 256 &&
    Number.isSafeInteger(value.cacheBytes) &&
    Number(value.cacheBytes) >= 0 &&
    value.maxActiveJobs === 4 &&
    value.cacheMaxEntries === 256 &&
    value.cacheMaxBytes === 32 * 1024 * 1024
  );
}

function validPreviewRelease(value: unknown): value is { released: true } {
  return isRecord(value) && value.released === true;
}

function validVolumeProperties(value: unknown): value is NativeVolumeProperties {
  return (
    isRecord(value) &&
    validFilesystemPath(String(value.path ?? '')) &&
    isNullableString(value.label) &&
    typeof value.kind === 'string' &&
    ROOT_KINDS.has(value.kind as NativeFileRootKind) &&
    isNullableString(value.fileSystem) &&
    isNullableSafeNumber(value.totalBytes) &&
    isNullableSafeNumber(value.freeBytes) &&
    isNullableSafeNumber(value.usedBytes) &&
    typeof value.accessible === 'boolean'
  );
}

function validPropertyItem(value: unknown): value is NativeFilePropertyItem {
  const attributes = isRecord(value) && value.attributes;
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    validFilesystemPath(String(value.path ?? '')) &&
    isNullableString(value.parentPath) &&
    isNullableString(value.extension) &&
    typeof value.kind === 'string' &&
    PROPERTY_ITEM_KINDS.has(value.kind as NativePropertyItemKind) &&
    isNullableSafeNumber(value.sizeBytes) &&
    isNullableSafeNumber(value.allocatedBytes) &&
    isNullableSafeNumber(value.createdAtMs) &&
    isNullableSafeNumber(value.modifiedAtMs) &&
    isNullableSafeNumber(value.accessedAtMs) &&
    isRecord(attributes) &&
    [
      'readOnly',
      'hidden',
      'system',
      'archive',
      'compressed',
      'encrypted',
      'sparse',
      'offline',
      'temporary',
      'reparsePoint',
    ].every((key) => typeof attributes[key] === 'boolean') &&
    isNullableSafeNumber(value.hardLinkCount) &&
    isNullableString(value.linkTarget) &&
    (value.volume === null || validVolumeProperties(value.volume)) &&
    typeof value.accessible === 'boolean' &&
    (value.accessError === null || validFilesystemError(value.accessError))
  );
}

function validFileProperties(value: unknown): value is NativeFileProperties {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    value.items.length <= 256 &&
    value.items.every(validPropertyItem) &&
    value.itemCount === value.items.length &&
    Number.isSafeInteger(value.fileCount) &&
    Number(value.fileCount) >= 0 &&
    Number.isSafeInteger(value.folderCount) &&
    Number(value.folderCount) >= 0 &&
    Number.isSafeInteger(value.driveCount) &&
    Number(value.driveCount) >= 0 &&
    isNullableSafeNumber(value.directAllocatedBytes) &&
    Number.isSafeInteger(value.directFileBytes) &&
    Number(value.directFileBytes) >= 0 &&
    typeof value.containsUnmeasuredFolders === 'boolean' &&
    isNullableString(value.commonParentPath) &&
    typeof value.mixedKinds === 'boolean' &&
    isDuration(value.durationMs)
  );
}

function validDirectoryMeasurement(value: unknown): value is DirectoryMeasurementSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{32}$/.test(value.id) &&
    typeof value.state === 'string' &&
    DIRECTORY_MEASUREMENT_STATES.has(value.state as DirectoryMeasurementState) &&
    Number.isSafeInteger(value.rootCount) &&
    Number(value.rootCount) > 0 &&
    Number(value.rootCount) <= 256 &&
    [
      'filesScanned',
      'directoriesScanned',
      'logicalBytes',
      'skippedEntries',
      'reparsePointsSkipped',
    ].every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0) &&
    isNullableSafeNumber(value.allocatedBytes) &&
    typeof value.allocationComplete === 'boolean' &&
    isDuration(value.durationMs) &&
    (value.error === null || validFilesystemError(value.error))
  );
}

function validDirectoryMeasurementDiagnostics(
  value: unknown,
): value is DirectoryMeasurementDiagnostics {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.activeJobs) &&
    Number(value.activeJobs) >= 0 &&
    Number(value.activeJobs) <= 2 &&
    Number.isSafeInteger(value.retainedJobs) &&
    Number(value.retainedJobs) >= 0 &&
    Number(value.retainedJobs) <= 16 &&
    value.maxActiveJobs === 2
  );
}

function validArchiveEntry(value: unknown): value is NativeArchiveEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.path === 'string' &&
    typeof value.parentPath === 'string' &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.kind === 'string' &&
    ARCHIVE_ENTRY_KINDS.has(value.kind as NativeArchiveEntryKind) &&
    Number.isSafeInteger(value.compressedSize) &&
    Number(value.compressedSize) >= 0 &&
    Number.isSafeInteger(value.uncompressedSize) &&
    Number(value.uncompressedSize) >= 0 &&
    isNullableString(value.modified) &&
    typeof value.compressionMethod === 'string' &&
    typeof value.encrypted === 'boolean'
  );
}

function validArchiveSummary(value: unknown): value is NativeArchiveSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{32}$/.test(value.id) &&
    typeof value.archivePath === 'string' &&
    value.archivePath.length > 0 &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    [
      'entryCount',
      'fileCount',
      'directoryCount',
      'encryptedEntries',
      'symlinkEntries',
      'unsupportedEntries',
      'totalCompressedBytes',
      'totalUncompressedBytes',
    ].every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0) &&
    Number(value.entryCount) <= 200_000 &&
    isDuration(value.durationMs)
  );
}

function validArchiveListing(value: unknown): value is NativeArchiveListing {
  return (
    isRecord(value) &&
    typeof value.archiveId === 'string' &&
    /^[a-f0-9]{32}$/.test(value.archiveId) &&
    typeof value.path === 'string' &&
    isNullableString(value.parentPath) &&
    Array.isArray(value.entries) &&
    value.entries.length <= 500 &&
    value.entries.every(validArchiveEntry) &&
    Number.isSafeInteger(value.totalEntries) &&
    Number(value.totalEntries) >= 0 &&
    Number.isSafeInteger(value.offset) &&
    Number(value.offset) >= 0 &&
    Number.isSafeInteger(value.limit) &&
    Number(value.limit) > 0 &&
    Number(value.limit) <= 500 &&
    typeof value.hasMore === 'boolean'
  );
}

function validArchiveOperation(value: unknown): value is NativeArchiveOperationSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{32}$/.test(value.id) &&
    typeof value.operation === 'string' &&
    ARCHIVE_OPERATION_TYPES.has(value.operation as NativeArchiveOperationType) &&
    typeof value.state === 'string' &&
    ARCHIVE_OPERATION_STATES.has(value.state as NativeArchiveOperationState) &&
    typeof value.archivePath === 'string' &&
    typeof value.destinationPath === 'string' &&
    isNullableString(value.currentEntry) &&
    [
      'filesCompleted',
      'directoriesCompleted',
      'entriesTotal',
      'bytesProcessed',
      'bytesTotal',
      'skippedEntries',
    ].every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0) &&
    Array.isArray(value.failures) &&
    value.failures.length <= 100_000 &&
    value.failures.every(
      (failure) =>
        isRecord(failure) &&
        typeof failure.entry === 'string' &&
        validFilesystemError(failure.error),
    ) &&
    (value.error === null || validFilesystemError(value.error))
  );
}

function validArchiveDiagnostics(value: unknown): value is NativeArchiveDiagnostics {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.openArchives) &&
    Number(value.openArchives) >= 0 &&
    Number(value.openArchives) <= 16 &&
    Number.isSafeInteger(value.activeJobs) &&
    Number(value.activeJobs) >= 0 &&
    Number(value.activeJobs) <= 2 &&
    Number.isSafeInteger(value.retainedJobs) &&
    Number(value.retainedJobs) >= 0 &&
    Number(value.retainedJobs) <= 32 &&
    value.maxActiveJobs === 2 &&
    value.maxArchiveEntries === 100_000 &&
    Number.isSafeInteger(value.maxTotalUncompressedBytes) &&
    Number(value.maxTotalUncompressedBytes) > 0
  );
}

function validArchiveRelease(value: unknown): value is { released: boolean } {
  return isRecord(value) && typeof value.released === 'boolean';
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
      async startSearch(
        query: NativeFileSearchQuery,
      ): Promise<FilesystemResult<NativeFileSearchSnapshot>> {
        if (
          !validFilesystemPath(query.rootPath) ||
          query.text.length > 256 ||
          (!query.text.trim() && query.extensions.length === 0) ||
          !FILE_SEARCH_SCOPES.has(query.scope) ||
          !FILE_SEARCH_KINDS.has(query.kind) ||
          query.extensions.length > 16 ||
          query.extensions.some((extension) => !/^[a-zA-Z0-9_-]{1,24}$/.test(extension))
        ) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.startNativeFileSearch(query),
            validSearchSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async getSearch(
        id: string,
        resultOffset: number,
      ): Promise<FilesystemResult<NativeFileSearchSnapshot>> {
        if (
          !/^[a-f0-9]{32}$/.test(id) ||
          !Number.isSafeInteger(resultOffset) ||
          resultOffset < 0 ||
          resultOffset > 5_000
        ) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.getNativeFileSearch(id, resultOffset),
            validSearchSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async cancelSearch(id: string): Promise<FilesystemResult<NativeFileSearchSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.cancelNativeFileSearch(id),
            validSearchSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async releaseSearch(id: string): Promise<FilesystemResult<{ released: true }>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.releaseNativeFileSearch(id),
            validSearchRelease,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async getSearchDiagnostics(): Promise<FilesystemResult<NativeFileSearchDiagnostics>> {
        try {
          return decodeFilesystemResponse(
            await environment.getNativeFileSearchDiagnostics(),
            validSearchDiagnostics,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async startPreview(
        request: NativeFilePreviewRequest,
      ): Promise<FilesystemResult<NativeFilePreviewSnapshot>> {
        if (!validPreviewRequest(request)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.startNativeFilePreview(request),
            validPreviewSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async getPreview(id: string): Promise<FilesystemResult<NativeFilePreviewSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.getNativeFilePreview(id),
            validPreviewSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async takePreviewBytes(id: string): Promise<FilesystemResult<Uint8Array>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          const raw = await environment.takeNativeFilePreviewBytes(id);
          const bytes =
            raw instanceof Uint8Array
              ? raw
              : raw instanceof ArrayBuffer
                ? new Uint8Array(raw)
                : Array.isArray(raw) &&
                    raw.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
                  ? new Uint8Array(raw)
                  : null;
          if (!bytes || bytes.byteLength > 8 * 1024 * 1024) return filesystemFailure();
          return { status: 'success', value: bytes };
        } catch {
          return filesystemFailure();
        }
      },
      async cancelPreview(id: string): Promise<FilesystemResult<NativeFilePreviewSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.cancelNativeFilePreview(id),
            validPreviewSnapshot,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async releasePreview(id: string): Promise<FilesystemResult<{ released: true }>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.releaseNativeFilePreview(id),
            validPreviewRelease,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async getPreviewDiagnostics(): Promise<FilesystemResult<NativeFilePreviewDiagnostics>> {
        try {
          return decodeFilesystemResponse(
            await environment.getNativeFilePreviewDiagnostics(),
            validPreviewDiagnostics,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async getProperties(
        paths: readonly string[],
      ): Promise<FilesystemResult<NativeFileProperties>> {
        if (
          paths.length === 0 ||
          paths.length > 256 ||
          paths.some((path) => !validFilesystemPath(path))
        ) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.getNativeFileProperties(paths),
            validFileProperties,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async startDirectoryMeasurement(
        paths: readonly string[],
      ): Promise<FilesystemResult<DirectoryMeasurementSnapshot>> {
        if (
          paths.length === 0 ||
          paths.length > 256 ||
          paths.some((path) => !validFilesystemPath(path))
        ) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.startNativeDirectoryMeasurement(paths),
            validDirectoryMeasurement,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async getDirectoryMeasurement(
        id: string,
      ): Promise<FilesystemResult<DirectoryMeasurementSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.getNativeDirectoryMeasurement(id),
            validDirectoryMeasurement,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async cancelDirectoryMeasurement(
        id: string,
      ): Promise<FilesystemResult<DirectoryMeasurementSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.cancelNativeDirectoryMeasurement(id),
            validDirectoryMeasurement,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async releaseDirectoryMeasurement(id: string): Promise<FilesystemResult<{ released: true }>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.releaseNativeDirectoryMeasurement(id),
            validPreviewRelease,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async getDirectoryMeasurementDiagnostics(): Promise<
        FilesystemResult<DirectoryMeasurementDiagnostics>
      > {
        try {
          return decodeFilesystemResponse(
            await environment.getNativeDirectoryMeasurementDiagnostics(),
            validDirectoryMeasurementDiagnostics,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async openArchive(path: string): Promise<FilesystemResult<NativeArchiveSummary>> {
        if (!validFilesystemPath(path) || !path.toLowerCase().endsWith('.zip')) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.openNativeArchive(path),
            validArchiveSummary,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async listArchiveEntries(
        archiveId: string,
        path: string,
        offset = 0,
        limit = 500,
        query = '',
      ): Promise<FilesystemResult<NativeArchiveListing>> {
        if (
          !/^[a-f0-9]{32}$/.test(archiveId) ||
          path.includes('\0') ||
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 500 ||
          query.length > 256
        ) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.getNativeArchiveEntries(archiveId, path, offset, limit, query),
            validArchiveListing,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async releaseArchive(archiveId: string): Promise<FilesystemResult<{ released: boolean }>> {
        if (!/^[a-f0-9]{32}$/.test(archiveId)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.releaseNativeArchive(archiveId),
            validArchiveRelease,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async extractArchive(
        options: Parameters<PlatformCapabilities['filesystem']['extractArchive']>[0],
      ): Promise<FilesystemResult<NativeArchiveOperationSnapshot>> {
        if (
          !/^[a-f0-9]{32}$/.test(options.archiveId) ||
          !validFilesystemPath(options.destinationPath) ||
          !['skip', 'keep-both', 'cancel'].includes(options.conflictStrategy) ||
          (options.selectedEntryIds?.length ?? 0) > 100_000 ||
          options.selectedEntryIds?.some((id: string) => typeof id !== 'string' || id.length > 128)
        ) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.startNativeArchiveExtract(
              options.archiveId,
              options.destinationPath,
              options.selectedEntryIds ?? [],
              options.conflictStrategy,
            ),
            validArchiveOperation,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async createZip(
        options: Parameters<PlatformCapabilities['filesystem']['createZip']>[0],
      ): Promise<FilesystemResult<NativeArchiveOperationSnapshot>> {
        if (
          options.sources.length === 0 ||
          options.sources.length > 1_024 ||
          options.sources.some((path: string) => !validFilesystemPath(path)) ||
          !validFilesystemPath(options.destinationPath) ||
          !options.destinationPath.toLowerCase().endsWith('.zip') ||
          !['skip', 'keep-both', 'cancel'].includes(options.conflictStrategy)
        ) {
          return invalidFilesystemPath();
        }
        try {
          return decodeFilesystemResponse(
            await environment.startNativeZipCreate(
              options.sources,
              options.destinationPath,
              options.conflictStrategy,
            ),
            validArchiveOperation,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async getArchiveOperation(
        id: string,
      ): Promise<FilesystemResult<NativeArchiveOperationSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.getNativeArchiveOperation(id),
            validArchiveOperation,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async cancelArchiveOperation(
        id: string,
      ): Promise<FilesystemResult<NativeArchiveOperationSnapshot>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.cancelNativeArchiveOperation(id),
            validArchiveOperation,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async releaseArchiveOperation(id: string): Promise<FilesystemResult<{ released: boolean }>> {
        if (!/^[a-f0-9]{32}$/.test(id)) return invalidFilesystemPath();
        try {
          return decodeFilesystemResponse(
            await environment.releaseNativeArchiveOperation(id),
            validArchiveRelease,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async getArchiveDiagnostics(): Promise<FilesystemResult<NativeArchiveDiagnostics>> {
        try {
          return decodeFilesystemResponse(
            await environment.getNativeArchiveDiagnostics(),
            validArchiveDiagnostics,
          );
        } catch {
          return filesystemFailure();
        }
      },
      async pickArchiveDestination(defaultPath?: string): Promise<FilesystemResult<string | null>> {
        try {
          const selected = await environment.pickFile({
            directory: true,
            multiple: false,
            ...(defaultPath ? { defaultPath } : {}),
          });
          return {
            status: 'success',
            value: typeof selected === 'string' ? selected : null,
          };
        } catch {
          return filesystemFailure();
        }
      },
      async pickZipDestination(defaultName: string): Promise<FilesystemResult<string | null>> {
        if (!defaultName || defaultName.includes('\0')) return invalidFilesystemPath();
        try {
          const selected = await environment.saveFile({
            defaultPath: defaultName.toLowerCase().endsWith('.zip')
              ? defaultName
              : `${defaultName}.zip`,
            filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
          });
          return { status: 'success', value: selected };
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
