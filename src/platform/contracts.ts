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
  | 'PREVIEW_UNSUPPORTED'
  | 'PDF_ENCRYPTED'
  | 'DECODE_FAILED'
  | 'FILE_CHANGED'
  | 'ARCHIVE_UNSUPPORTED'
  | 'ARCHIVE_INVALID'
  | 'ARCHIVE_ENCRYPTED'
  | 'ARCHIVE_LIMIT_EXCEEDED'
  | 'ARCHIVE_ENTRY_UNSAFE'
  | 'ARCHIVE_CORRUPT'
  | 'CLIPBOARD_BUSY'
  | 'CLIPBOARD_UNAVAILABLE'
  | 'CLIPBOARD_FORMAT_UNSUPPORTED'
  | 'CLIPBOARD_TOO_LARGE'
  | 'INVALID_CLIPBOARD_DATA'
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

export type NativeFileSearchScope = 'current-folder' | 'current-tree' | 'selected-drive';
export type NativeFileSearchKind = 'all' | 'files' | 'folders';
export type NativeFileSearchState = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface NativeFileSearchQuery {
  rootPath: string;
  text: string;
  scope: NativeFileSearchScope;
  kind: NativeFileSearchKind;
  extensions: readonly string[];
}

export interface NativeFileSearchSnapshot {
  id: string;
  query: NativeFileSearchQuery;
  state: NativeFileSearchState;
  scannedEntries: number;
  matchedEntries: number;
  inaccessibleEntries: number;
  retainedResults: number;
  resultLimit: number;
  truncated: boolean;
  durationMs: number;
  resultOffset: number;
  results: readonly NativeFileMetadata[];
  error: FilesystemError | null;
}

export interface NativeFileSearchDiagnostics {
  activeSearches: number;
  retainedSearches: number;
  retainedResults: number;
}

export type NativeFilePreviewMode = 'thumbnail' | 'image-preview' | 'text-preview';
export type NativeFilePreviewState = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
export type NativeFilePreviewKind = 'image' | 'text';

export interface NativeFilePreviewRequest {
  path: string;
  mode: NativeFilePreviewMode;
  requestedWidth: number;
  requestedHeight: number;
}

export interface NativeFilePreviewDescriptor {
  kind: NativeFilePreviewKind;
  mimeType: string;
  width: number | null;
  height: number | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  pageCount: number | null;
  durationMs: number | null;
  byteLength: number;
  text: string | null;
  truncated: boolean;
  cacheHit: boolean;
}

export interface NativeFilePreviewSnapshot {
  id: string;
  request: NativeFilePreviewRequest;
  state: NativeFilePreviewState;
  durationMs: number;
  result: NativeFilePreviewDescriptor | null;
  error: FilesystemError | null;
}

export interface NativeFilePreviewDiagnostics {
  activeJobs: number;
  retainedJobs: number;
  retainedResultBytes: number;
  cacheEntries: number;
  cacheBytes: number;
  maxActiveJobs: number;
  cacheMaxEntries: number;
  cacheMaxBytes: number;
}

export type NativePropertyItemKind =
  | 'file'
  | 'directory'
  | 'drive'
  | 'symbolic-link'
  | 'junction'
  | 'other-reparse'
  | 'other'
  | 'unavailable';

export interface NativeFileAttributes {
  readOnly: boolean;
  hidden: boolean;
  system: boolean;
  archive: boolean;
  compressed: boolean;
  encrypted: boolean;
  sparse: boolean;
  offline: boolean;
  temporary: boolean;
  reparsePoint: boolean;
}

export interface NativeVolumeProperties {
  path: string;
  label: string | null;
  kind: NativeFileRootKind;
  fileSystem: string | null;
  totalBytes: number | null;
  freeBytes: number | null;
  usedBytes: number | null;
  accessible: boolean;
}

export interface NativeFilePropertyItem {
  name: string;
  path: string;
  parentPath: string | null;
  extension: string | null;
  kind: NativePropertyItemKind;
  sizeBytes: number | null;
  allocatedBytes: number | null;
  createdAtMs: number | null;
  modifiedAtMs: number | null;
  accessedAtMs: number | null;
  attributes: NativeFileAttributes;
  hardLinkCount: number | null;
  linkTarget: string | null;
  volume: NativeVolumeProperties | null;
  accessible: boolean;
  accessError: FilesystemError | null;
}

export interface NativeFileProperties {
  items: readonly NativeFilePropertyItem[];
  itemCount: number;
  fileCount: number;
  folderCount: number;
  driveCount: number;
  directFileBytes: number;
  directAllocatedBytes: number | null;
  containsUnmeasuredFolders: boolean;
  commonParentPath: string | null;
  mixedKinds: boolean;
  durationMs: number;
}

export type DirectoryMeasurementState = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface DirectoryMeasurementSnapshot {
  id: string;
  state: DirectoryMeasurementState;
  rootCount: number;
  filesScanned: number;
  directoriesScanned: number;
  logicalBytes: number;
  allocatedBytes: number | null;
  allocationComplete: boolean;
  skippedEntries: number;
  reparsePointsSkipped: number;
  durationMs: number;
  error: FilesystemError | null;
}

export interface DirectoryMeasurementDiagnostics {
  activeJobs: number;
  retainedJobs: number;
  maxActiveJobs: number;
}

export type NativeArchiveEntryKind = 'file' | 'directory' | 'symlink';

export interface NativeArchiveEntry {
  id: string;
  path: string;
  parentPath: string;
  name: string;
  kind: NativeArchiveEntryKind;
  compressedSize: number;
  uncompressedSize: number;
  modified: string | null;
  compressionMethod: string;
  encrypted: boolean;
}

export interface NativeArchiveSummary {
  id: string;
  archivePath: string;
  name: string;
  entryCount: number;
  fileCount: number;
  directoryCount: number;
  encryptedEntries: number;
  symlinkEntries: number;
  unsupportedEntries: number;
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
  durationMs: number;
}

export interface NativeArchiveListing {
  archiveId: string;
  path: string;
  parentPath: string | null;
  entries: readonly NativeArchiveEntry[];
  totalEntries: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export type NativeArchiveConflictStrategy = 'skip' | 'keep-both' | 'cancel';
export type NativeArchiveOperationType = 'extract' | 'create-zip';
export type NativeArchiveOperationState =
  'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface NativeArchiveFailure {
  entry: string;
  error: FilesystemError;
}

export interface NativeArchiveOperationSnapshot {
  id: string;
  operation: NativeArchiveOperationType;
  state: NativeArchiveOperationState;
  archivePath: string;
  destinationPath: string;
  currentEntry: string | null;
  filesCompleted: number;
  directoriesCompleted: number;
  entriesTotal: number;
  bytesProcessed: number;
  bytesTotal: number;
  skippedEntries: number;
  failures: readonly NativeArchiveFailure[];
  error: FilesystemError | null;
}

export interface NativeArchiveDiagnostics {
  openArchives: number;
  activeJobs: number;
  retainedJobs: number;
  maxActiveJobs: number;
  maxArchiveEntries: number;
  maxTotalUncompressedBytes: number;
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
  startSearch(query: NativeFileSearchQuery): Promise<FilesystemResult<NativeFileSearchSnapshot>>;
  getSearch(id: string, resultOffset: number): Promise<FilesystemResult<NativeFileSearchSnapshot>>;
  cancelSearch(id: string): Promise<FilesystemResult<NativeFileSearchSnapshot>>;
  releaseSearch(id: string): Promise<FilesystemResult<{ released: true }>>;
  getSearchDiagnostics(): Promise<FilesystemResult<NativeFileSearchDiagnostics>>;
  startPreview(
    request: NativeFilePreviewRequest,
  ): Promise<FilesystemResult<NativeFilePreviewSnapshot>>;
  getPreview(id: string): Promise<FilesystemResult<NativeFilePreviewSnapshot>>;
  takePreviewBytes(id: string): Promise<FilesystemResult<Uint8Array>>;
  cancelPreview(id: string): Promise<FilesystemResult<NativeFilePreviewSnapshot>>;
  releasePreview(id: string): Promise<FilesystemResult<{ released: true }>>;
  getPreviewDiagnostics(): Promise<FilesystemResult<NativeFilePreviewDiagnostics>>;
  getProperties(paths: readonly string[]): Promise<FilesystemResult<NativeFileProperties>>;
  startDirectoryMeasurement(
    paths: readonly string[],
  ): Promise<FilesystemResult<DirectoryMeasurementSnapshot>>;
  getDirectoryMeasurement(id: string): Promise<FilesystemResult<DirectoryMeasurementSnapshot>>;
  cancelDirectoryMeasurement(id: string): Promise<FilesystemResult<DirectoryMeasurementSnapshot>>;
  releaseDirectoryMeasurement(id: string): Promise<FilesystemResult<{ released: true }>>;
  getDirectoryMeasurementDiagnostics(): Promise<FilesystemResult<DirectoryMeasurementDiagnostics>>;
  openArchive(path: string): Promise<FilesystemResult<NativeArchiveSummary>>;
  listArchiveEntries(
    archiveId: string,
    path: string,
    offset?: number,
    limit?: number,
    query?: string,
  ): Promise<FilesystemResult<NativeArchiveListing>>;
  releaseArchive(archiveId: string): Promise<FilesystemResult<{ released: boolean }>>;
  extractArchive(options: {
    archiveId: string;
    destinationPath: string;
    selectedEntryIds?: readonly string[];
    conflictStrategy: NativeArchiveConflictStrategy;
  }): Promise<FilesystemResult<NativeArchiveOperationSnapshot>>;
  createZip(options: {
    sources: readonly string[];
    destinationPath: string;
    conflictStrategy: NativeArchiveConflictStrategy;
  }): Promise<FilesystemResult<NativeArchiveOperationSnapshot>>;
  getArchiveOperation(id: string): Promise<FilesystemResult<NativeArchiveOperationSnapshot>>;
  cancelArchiveOperation(id: string): Promise<FilesystemResult<NativeArchiveOperationSnapshot>>;
  releaseArchiveOperation(id: string): Promise<FilesystemResult<{ released: boolean }>>;
  getArchiveDiagnostics(): Promise<FilesystemResult<NativeArchiveDiagnostics>>;
  pickArchiveDestination(defaultPath?: string): Promise<FilesystemResult<string | null>>;
  pickZipDestination(defaultName: string): Promise<FilesystemResult<string | null>>;
}

export type NativeFileClipboardOperation = 'copy' | 'move';

export interface NativeFileClipboardSnapshot {
  available: boolean;
  operation: NativeFileClipboardOperation | null;
  paths: readonly string[];
  sequence: number;
}

export interface NativeFileClipboardCompletion {
  reported: boolean;
  sequence: number;
}

export interface NativeFileClipboardDiagnostics {
  openClipboardGuards: number;
  reads: number;
  writes: number;
  completions: number;
  maxPaths: number;
  maxUtf16Bytes: number;
}

export interface PlatformFileClipboard {
  readonly supported: boolean;
  read(): Promise<FilesystemResult<NativeFileClipboardSnapshot>>;
  write(
    operation: NativeFileClipboardOperation,
    paths: readonly string[],
  ): Promise<FilesystemResult<NativeFileClipboardSnapshot>>;
  complete(
    sequence: number,
    operation: NativeFileClipboardOperation,
  ): Promise<FilesystemResult<NativeFileClipboardCompletion>>;
  getDiagnostics(): Promise<FilesystemResult<NativeFileClipboardDiagnostics>>;
}

export type NativeFileDragOperation = 'auto' | NativeFileClipboardOperation;
export type NativeFileDragPhase = 'enter' | 'over' | 'drop' | 'leave';

export interface NativeFileDragModifiers {
  control: boolean;
  shift: boolean;
}

export interface NativeFileDragEvent {
  phase: NativeFileDragPhase;
  session: number;
  paths: readonly string[];
  x: number;
  y: number;
  modifiers: NativeFileDragModifiers;
  operation: NativeFileClipboardOperation | null;
}

export interface NativeFileDragResult {
  dropped: boolean;
  operation: NativeFileClipboardOperation | null;
  itemCount: number;
  prepareDurationMs: number;
}

export interface NativeFileDragDiagnostics {
  registeredTargets: number;
  dropShieldVisible: boolean;
  dropShieldExpanded: boolean;
  activeInboundSessions: number;
  activeOutboundSessions: number;
  inboundEnters: number;
  inboundDrops: number;
  inboundLeaves: number;
  outboundStarted: number;
  outboundDropped: number;
  outboundCancelled: number;
  maxPaths: number;
  maxUtf16Bytes: number;
}

export interface PlatformFileDragDrop {
  readonly supported: boolean;
  start(
    operation: NativeFileDragOperation,
    paths: readonly string[],
  ): Promise<FilesystemResult<NativeFileDragResult>>;
  setDropEffect(
    session: number,
    operation: NativeFileClipboardOperation | null,
  ): Promise<FilesystemResult<boolean>>;
  subscribe(listener: (event: NativeFileDragEvent) => void): Promise<() => void>;
  getDiagnostics(): Promise<FilesystemResult<NativeFileDragDiagnostics>>;
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

export type WebSurfaceOwner = 'browser' | 'whatsapp' | 'telegram' | 'youtube-music' | 'integration';

export interface WebSurfaceNavigationPolicy {
  allowPublicWeb: boolean;
  allowedOrigins: readonly string[];
}

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
    /** Required for generic packaged integrations; omitted by legacy built-ins. */
    navigationPolicy?: WebSurfaceNavigationPolicy;
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
  readonly fileClipboard: PlatformFileClipboard;
  readonly fileDragDrop: PlatformFileDragDrop;
  readonly files: {
    pick(options?: PickFilesOptions): Promise<CapabilityResult<PickedFiles>>;
    /** Read a user-selected PDF path handed off by the trusted Nammu Files app. */
    readPdf(path: string): Promise<CapabilityResult<PickedPlatformFile>>;
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
    openStandalone(url: string, title: string): Promise<CapabilityResult<void>>;
    minimize(): Promise<CapabilityResult<void>>;
    toggleMaximize(): Promise<CapabilityResult<void>>;
    close(): Promise<CapabilityResult<void>>;
  };
}
