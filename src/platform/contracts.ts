export type PlatformRuntime = 'web' | 'tauri';

export type CapabilityResult<T> =
  | { status: 'success'; value: T }
  | { status: 'cancelled' }
  | { status: 'unsupported'; reason: string }
  | { status: 'denied'; reason: string }
  | {
      status: 'error';
      code: 'invalid-input' | 'operation-failed';
      message: string;
    };

export interface PlatformFileFilter {
  name: string;
  extensions?: readonly string[];
  mimeTypes?: readonly string[];
}

export interface PickFilesOptions {
  multiple?: boolean;
  filters?: readonly PlatformFileFilter[];
}

export interface PickedPlatformFile {
  name: string;
  mimeType: string | null;
  size: number;
  bytes: Uint8Array;
}

export interface PickedFiles {
  files: readonly PickedPlatformFile[];
}

export interface SaveFileOptions {
  suggestedName: string;
  contents: string | Uint8Array;
  mimeType?: string;
  filters?: readonly PlatformFileFilter[];
}

export interface SavedFile {
  fileName: string;
}

export type FilesystemErrorCode =
  | 'NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'NOT_DIRECTORY'
  | 'DRIVE_UNAVAILABLE'
  | 'INVALID_PATH'
  | 'ALREADY_EXISTS'
  | 'INVALID_NAME'
  | 'INVALID_DESTINATION'
  | 'FILE_IN_USE'
  | 'READ_ONLY'
  | 'SOURCE_EQUALS_DESTINATION'
  | 'DESTINATION_INSIDE_SOURCE'
  | 'OPERATION_CANCELLED'
  | 'RECYCLE_UNSUPPORTED'
  | 'ROOT_OPERATION_FORBIDDEN'
  | 'CONFIRMATION_REQUIRED'
  | 'UNDO_UNAVAILABLE'
  | 'WATCH_UNSUPPORTED'
  | 'WATCH_FAILED'
  | 'IO_ERROR';

export interface FilesystemError {
  code: FilesystemErrorCode;
  message: string;
}

export type FilesystemResult<T> =
  | { status: 'success'; value: T }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; error: FilesystemError };

export type NativeFileRootKind =
  'local' | 'removable' | 'network' | 'optical' | 'ram-disk' | 'other';

export interface NativeFileRoot {
  path: string;
  name: string;
  kind: NativeFileRootKind;
  label: string | null;
  fileSystem: string | null;
  totalBytes: number | null;
  freeBytes: number | null;
  accessible: boolean;
}

export interface NativeFileRoots {
  roots: readonly NativeFileRoot[];
  durationMs: number;
}

export type NativeFileKind = 'file' | 'directory' | 'reparse-point' | 'other';

export interface NativeFileMetadata {
  name: string;
  path: string;
  kind: NativeFileKind;
  sizeBytes: number | null;
  createdAtMs: number | null;
  modifiedAtMs: number | null;
  extension: string | null;
  hidden: boolean;
  system: boolean;
  readOnly: boolean;
  readable: boolean;
  navigable: boolean;
}

export interface NativeFileBreadcrumb {
  name: string;
  path: string;
}

export interface NativeDirectoryListing {
  path: string;
  parentPath: string | null;
  breadcrumbs: readonly NativeFileBreadcrumb[];
  entries: readonly NativeFileMetadata[];
  omittedEntries: number;
  durationMs: number;
}

export type NativeFileConflictStrategy = 'cancel' | 'keep-both';
export type NativeFileOperationType = 'copy' | 'move' | 'duplicate';
export type NativeFileOperationState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface NativeFileMutation {
  entry: NativeFileMetadata;
  affectedDirectories: readonly string[];
}

export interface NativeFileOperationSuccess {
  sourcePath: string;
  destinationPath: string;
  entry: NativeFileMetadata;
}

export interface NativeFileOperationFailure {
  sourcePath: string;
  error: FilesystemError;
}

export interface NativeFileOperationSnapshot {
  id: string;
  operation: NativeFileOperationType;
  state: NativeFileOperationState;
  sources: readonly string[];
  destinationPath: string | null;
  currentItem: string | null;
  filesCompleted: number;
  filesTotal: number | null;
  bytesProcessed: number;
  bytesTotal: number | null;
  successes: readonly NativeFileOperationSuccess[];
  failures: readonly NativeFileOperationFailure[];
}

export type NativeDeletionOperationType = 'trash' | 'permanent-delete' | 'restore';
export type NativeDeletionCancellationMode = 'recoverable-between-items' | 'stop-remaining-only';

export interface NativeDeletionSuccess {
  sourcePath: string;
  destinationPath: string | null;
}

export interface NativeDeletionFailure {
  sourcePath: string;
  error: FilesystemError;
}

export interface NativeDeletionOperationSnapshot {
  id: string;
  operation: NativeDeletionOperationType;
  state: NativeFileOperationState;
  sources: readonly string[];
  currentItem: string | null;
  filesCompleted: number;
  filesTotal: number;
  successes: readonly NativeDeletionSuccess[];
  failures: readonly NativeDeletionFailure[];
  undoId: string | null;
  reversible: boolean;
  cancellationMode: NativeDeletionCancellationMode;
}

export type NativeFilesystemEventKind =
  'created' | 'removed' | 'renamed' | 'modified' | 'metadata' | 'rescan-required' | 'watch-error';

export interface NativeFilesystemWatchEvent {
  watchId: string;
  rootPath: string;
  kind: NativeFilesystemEventKind;
  paths: readonly string[];
  rawEventCount: number;
  rescanRequired: boolean;
  error: FilesystemError | null;
}

export interface NativeDirectoryWatchDiagnostics {
  activeWatchers: number;
  rawEvents: number;
  emittedInvalidations: number;
  droppedSignals: number;
}

export interface NativeDirectoryWatchSubscription {
  readonly id: string;
  readonly path: string;
  dispose(): Promise<void>;
}

export interface PlatformFilesystem {
  readonly supported: boolean;
  listRoots(): Promise<FilesystemResult<NativeFileRoots>>;
  listDirectory(path: string): Promise<FilesystemResult<NativeDirectoryListing>>;
  stat(path: string): Promise<FilesystemResult<NativeFileMetadata>>;
  createDirectory(parentPath: string, name: string): Promise<FilesystemResult<NativeFileMutation>>;
  createFile(parentPath: string, name: string): Promise<FilesystemResult<NativeFileMutation>>;
  rename(path: string, newName: string): Promise<FilesystemResult<NativeFileMutation>>;
  copy(
    sources: readonly string[],
    destinationPath: string,
    conflictStrategy?: NativeFileConflictStrategy,
  ): Promise<FilesystemResult<NativeFileOperationSnapshot>>;
  move(
    sources: readonly string[],
    destinationPath: string,
    conflictStrategy?: NativeFileConflictStrategy,
  ): Promise<FilesystemResult<NativeFileOperationSnapshot>>;
  duplicate(sources: readonly string[]): Promise<FilesystemResult<NativeFileOperationSnapshot>>;
  getOperation(id: string): Promise<FilesystemResult<NativeFileOperationSnapshot>>;
  cancelOperation(id: string): Promise<FilesystemResult<NativeFileOperationSnapshot>>;
  trash(sources: readonly string[]): Promise<FilesystemResult<NativeDeletionOperationSnapshot>>;
  permanentlyDelete(
    sources: readonly string[],
    confirmed: boolean,
  ): Promise<FilesystemResult<NativeDeletionOperationSnapshot>>;
  restore(undoId: string): Promise<FilesystemResult<NativeDeletionOperationSnapshot>>;
  getDeletionOperation(id: string): Promise<FilesystemResult<NativeDeletionOperationSnapshot>>;
  cancelDeletionOperation(id: string): Promise<FilesystemResult<NativeDeletionOperationSnapshot>>;
  watchDirectory(
    path: string,
    listener: (event: NativeFilesystemWatchEvent) => void,
  ): Promise<FilesystemResult<NativeDirectoryWatchSubscription>>;
  getWatchDiagnostics(): Promise<FilesystemResult<NativeDirectoryWatchDiagnostics>>;
}

export type PlatformNotificationPermission = 'default' | 'granted' | 'denied';

export interface PlatformNotification {
  title: string;
  body?: string;
  iconUrl?: string;
}

export interface PlatformServiceInfo {
  runtime: 'web' | 'desktop-local';
  origin: string | null;
  instanceId: string | null;
}

export interface PlatformServices {
  ready(): Promise<PlatformServiceInfo>;
  request(pathAndQuery: string, init?: RequestInit): Promise<Response>;
  wispUrl(): Promise<string>;
}

export type WebSurfaceOwner = 'browser' | 'whatsapp' | 'telegram' | 'youtube-music';

export interface WebSurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebSurfaceSnapshot {
  id: string;
  owner: WebSurfaceOwner;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isAudioPlaying: boolean;
  isMuted: boolean;
  visible: boolean;
}

export interface WebSurfaceOpenRequest {
  sourceId: string;
  owner: WebSurfaceOwner;
  url: string;
}

export type WebSurfaceControl = 'reload' | 'stop' | 'go-back' | 'go-forward' | 'mute' | 'unmute';

export interface PlatformWebSurfaces {
  readonly supported: boolean;
  create(options: {
    owner: WebSurfaceOwner;
    profileKey: string;
    privateSession: boolean;
    url: string;
    bounds: WebSurfaceBounds;
    visible: boolean;
  }): Promise<CapabilityResult<WebSurfaceSnapshot>>;
  destroy(id: string): Promise<CapabilityResult<void>>;
  navigate(id: string, url: string): Promise<CapabilityResult<void>>;
  control(id: string, control: WebSurfaceControl): Promise<CapabilityResult<void>>;
  setBounds(id: string, bounds: WebSurfaceBounds): Promise<CapabilityResult<void>>;
  setVisible(id: string, visible: boolean): Promise<CapabilityResult<void>>;
  focus(id: string): Promise<CapabilityResult<void>>;
  setZoom(id: string, zoom: number): Promise<CapabilityResult<void>>;
  getState(id: string): Promise<CapabilityResult<WebSurfaceSnapshot>>;
  subscribe(listener: (snapshot: WebSurfaceSnapshot) => void): Promise<() => void>;
  subscribeOpenRequests(listener: (request: WebSurfaceOpenRequest) => void): Promise<() => void>;
}

export interface PlatformCapabilities {
  readonly runtime: PlatformRuntime;
  readonly services: PlatformServices;
  readonly webSurfaces: PlatformWebSurfaces;
  readonly filesystem: PlatformFilesystem;
  readonly files: {
    pick(options?: PickFilesOptions): Promise<CapabilityResult<PickedFiles>>;
    save(options: SaveFileOptions): Promise<CapabilityResult<SavedFile>>;
  };
  readonly external: {
    openUrl(url: string): Promise<CapabilityResult<void>>;
  };
  readonly clipboard: {
    readText(): Promise<CapabilityResult<string>>;
    writeText(text: string): Promise<CapabilityResult<void>>;
  };
  readonly notifications: {
    requestPermission(): Promise<CapabilityResult<PlatformNotificationPermission>>;
    show(notification: PlatformNotification): Promise<CapabilityResult<void>>;
  };
  readonly window: {
    minimize(): Promise<CapabilityResult<void>>;
    toggleMaximize(): Promise<CapabilityResult<void>>;
    close(): Promise<CapabilityResult<void>>;
  };
}
