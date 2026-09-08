import type {
  FilesystemResult,
  DirectoryMeasurementDiagnostics,
  DirectoryMeasurementSnapshot,
  NativeDirectoryListing,
  NativeDirectoryWatchDiagnostics,
  NativeDirectoryWatchSubscription,
  NativeDeletionOperationSnapshot,
  NativeFileMetadata,
  NativeFileClipboardCompletion,
  NativeFileClipboardDiagnostics,
  NativeFileClipboardOperation,
  NativeFileClipboardSnapshot,
  NativeFileDragDiagnostics,
  NativeFileDragEvent,
  NativeFileDragOperation,
  NativeFileDragResult,
  NativeFileConflictStrategy,
  NativeFileMutation,
  NativeFileOperationSnapshot,
  NativeFileProperties,
  NativeFilePreviewDiagnostics,
  NativeFilePreviewRequest,
  NativeFilePreviewSnapshot,
  NativeFileRoots,
  NativeFileSearchDiagnostics,
  NativeFileSearchQuery,
  NativeFileSearchScope,
  NativeFileSearchSnapshot,
  NativeFilesystemWatchEvent,
  PlatformFilesystem,
  PlatformFileClipboard,
  PlatformFileDragDrop,
  NativeArchiveConflictStrategy,
  NativeArchiveDiagnostics,
  NativeArchiveListing,
  NativeArchiveOperationSnapshot,
  NativeArchiveSummary,
} from '../../platform';
import { getPlatformCapabilities } from '../../platform';

export type FilesLocation = { kind: 'roots' } | { kind: 'directory'; path: string };

export interface FilesNavigationState {
  readonly entries: readonly FilesLocation[];
  readonly index: number;
}

export interface FilesystemService {
  readonly supported: boolean;
  readonly fileClipboardSupported: boolean;
  readonly fileDragDropSupported: boolean;
  readFileClipboard(): Promise<FilesystemResult<NativeFileClipboardSnapshot>>;
  writeFileClipboard(
    operation: NativeFileClipboardOperation,
    paths: readonly string[],
  ): Promise<FilesystemResult<NativeFileClipboardSnapshot>>;
  completeFileClipboard(
    sequence: number,
    operation: NativeFileClipboardOperation,
  ): Promise<FilesystemResult<NativeFileClipboardCompletion>>;
  getFileClipboardDiagnostics(): Promise<FilesystemResult<NativeFileClipboardDiagnostics>>;
  startFileDrag(
    operation: NativeFileDragOperation,
    paths: readonly string[],
  ): Promise<FilesystemResult<NativeFileDragResult>>;
  setFileDropEffect(
    session: number,
    operation: NativeFileClipboardOperation | null,
  ): Promise<FilesystemResult<boolean>>;
  subscribeFileDrops(listener: (event: NativeFileDragEvent) => void): Promise<() => void>;
  getFileDragDropDiagnostics(): Promise<FilesystemResult<NativeFileDragDiagnostics>>;
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

export interface FilesClipboard {
  readonly operation: 'copy' | 'cut';
  readonly sources: readonly string[];
  readonly timestamp: number;
}

export function windowsVolumeKey(path: string): string | null {
  const drive = /^([a-z]):[\\/]/i.exec(path);
  if (drive) return `${drive[1].toUpperCase()}:`;
  const unc = /^\\\\([^\\/]+)[\\/]([^\\/]+)/.exec(path);
  return unc ? `\\\\${unc[1].toLowerCase()}\\${unc[2].toLowerCase()}` : null;
}

export function resolveNativeDropOperation(
  paths: readonly string[],
  destinationPath: string,
  modifiers: { control: boolean; shift: boolean },
): NativeFileClipboardOperation {
  if (modifiers.control && modifiers.shift) return 'copy';
  if (modifiers.control && !modifiers.shift) return 'copy';
  if (modifiers.shift && !modifiers.control) return 'move';
  const destinationVolume = windowsVolumeKey(destinationPath);
  const sourceVolumes = new Set(paths.map(windowsVolumeKey));
  return destinationVolume !== null &&
    sourceVolumes.size === 1 &&
    sourceVolumes.has(destinationVolume)
    ? 'move'
    : 'copy';
}

export function createFilesystemService(
  filesystem: PlatformFilesystem = getPlatformCapabilities().filesystem,
  fileClipboard: PlatformFileClipboard = getPlatformCapabilities().fileClipboard,
  fileDragDrop: PlatformFileDragDrop = getPlatformCapabilities().fileDragDrop,
): FilesystemService {
  return Object.freeze({
    supported: filesystem.supported,
    fileClipboardSupported: fileClipboard.supported,
    fileDragDropSupported: fileDragDrop.supported,
    readFileClipboard: () => fileClipboard.read(),
    writeFileClipboard: (operation: NativeFileClipboardOperation, paths: readonly string[]) =>
      fileClipboard.write(operation, paths),
    completeFileClipboard: (sequence: number, operation: NativeFileClipboardOperation) =>
      fileClipboard.complete(sequence, operation),
    getFileClipboardDiagnostics: () => fileClipboard.getDiagnostics(),
    startFileDrag: (operation: NativeFileDragOperation, paths: readonly string[]) =>
      fileDragDrop.start(operation, paths),
    setFileDropEffect: (session: number, operation: NativeFileClipboardOperation | null) =>
      fileDragDrop.setDropEffect(session, operation),
    subscribeFileDrops: (listener: (event: NativeFileDragEvent) => void) =>
      fileDragDrop.subscribe(listener),
    getFileDragDropDiagnostics: () => fileDragDrop.getDiagnostics(),
    listRoots: () => filesystem.listRoots(),
    listDirectory: (path: string) => filesystem.listDirectory(path),
    stat: (path: string) => filesystem.stat(path),
    createDirectory: (parentPath: string, name: string) =>
      filesystem.createDirectory(parentPath, name),
    createFile: (parentPath: string, name: string) => filesystem.createFile(parentPath, name),
    rename: (path: string, newName: string) => filesystem.rename(path, newName),
    copy: (
      sources: readonly string[],
      destinationPath: string,
      conflictStrategy?: NativeFileConflictStrategy,
    ) => filesystem.copy(sources, destinationPath, conflictStrategy),
    move: (
      sources: readonly string[],
      destinationPath: string,
      conflictStrategy?: NativeFileConflictStrategy,
    ) => filesystem.move(sources, destinationPath, conflictStrategy),
    duplicate: (sources: readonly string[]) => filesystem.duplicate(sources),
    getOperation: (id: string) => filesystem.getOperation(id),
    cancelOperation: (id: string) => filesystem.cancelOperation(id),
    trash: (sources: readonly string[]) => filesystem.trash(sources),
    permanentlyDelete: (sources: readonly string[], confirmed: boolean) =>
      filesystem.permanentlyDelete(sources, confirmed),
    restore: (undoId: string) => filesystem.restore(undoId),
    getDeletionOperation: (id: string) => filesystem.getDeletionOperation(id),
    cancelDeletionOperation: (id: string) => filesystem.cancelDeletionOperation(id),
    watchDirectory: (path: string, listener: (event: NativeFilesystemWatchEvent) => void) =>
      filesystem.watchDirectory(path, listener),
    getWatchDiagnostics: () => filesystem.getWatchDiagnostics(),
    startSearch: (query: NativeFileSearchQuery) => filesystem.startSearch(query),
    getSearch: (id: string, resultOffset: number) => filesystem.getSearch(id, resultOffset),
    cancelSearch: (id: string) => filesystem.cancelSearch(id),
    releaseSearch: (id: string) => filesystem.releaseSearch(id),
    getSearchDiagnostics: () => filesystem.getSearchDiagnostics(),
    startPreview: (request: NativeFilePreviewRequest) => filesystem.startPreview(request),
    getPreview: (id: string) => filesystem.getPreview(id),
    takePreviewBytes: (id: string) => filesystem.takePreviewBytes(id),
    cancelPreview: (id: string) => filesystem.cancelPreview(id),
    releasePreview: (id: string) => filesystem.releasePreview(id),
    getPreviewDiagnostics: () => filesystem.getPreviewDiagnostics(),
    getProperties: (paths: readonly string[]) => filesystem.getProperties(paths),
    startDirectoryMeasurement: (paths: readonly string[]) =>
      filesystem.startDirectoryMeasurement(paths),
    getDirectoryMeasurement: (id: string) => filesystem.getDirectoryMeasurement(id),
    cancelDirectoryMeasurement: (id: string) => filesystem.cancelDirectoryMeasurement(id),
    releaseDirectoryMeasurement: (id: string) => filesystem.releaseDirectoryMeasurement(id),
    getDirectoryMeasurementDiagnostics: () => filesystem.getDirectoryMeasurementDiagnostics(),
    openArchive: (path: string) => filesystem.openArchive(path),
    listArchiveEntries: (
      archiveId: string,
      path: string,
      offset?: number,
      limit?: number,
      query?: string,
    ) => filesystem.listArchiveEntries(archiveId, path, offset, limit, query),
    releaseArchive: (archiveId: string) => filesystem.releaseArchive(archiveId),
    extractArchive: (options: Parameters<PlatformFilesystem['extractArchive']>[0]) =>
      filesystem.extractArchive(options),
    createZip: (options: Parameters<PlatformFilesystem['createZip']>[0]) =>
      filesystem.createZip(options),
    getArchiveOperation: (id: string) => filesystem.getArchiveOperation(id),
    cancelArchiveOperation: (id: string) => filesystem.cancelArchiveOperation(id),
    releaseArchiveOperation: (id: string) => filesystem.releaseArchiveOperation(id),
    getArchiveDiagnostics: () => filesystem.getArchiveDiagnostics(),
    pickArchiveDestination: (defaultPath?: string) =>
      filesystem.pickArchiveDestination(defaultPath),
    pickZipDestination: (defaultName: string) => filesystem.pickZipDestination(defaultName),
  });
}

export type NativeSearchFilter =
  | 'all'
  | 'files'
  | 'folders'
  | 'documents'
  | 'images'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'archives'
  | 'code'
  | 'applications';

const SEARCH_FILTER_EXTENSIONS: Readonly<Partial<Record<NativeSearchFilter, readonly string[]>>> = {
  documents: ['csv', 'doc', 'docx', 'md', 'odt', 'ppt', 'pptx', 'rtf', 'txt', 'xls', 'xlsx'],
  images: ['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'webp'],
  video: ['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm'],
  audio: ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav'],
  pdf: ['pdf'],
  archives: ['7z', 'bz2', 'gz', 'rar', 'tar', 'zip'],
  code: ['css', 'html', 'js', 'json', 'jsx', 'py', 'rs', 'ts', 'tsx', 'xml', 'yaml', 'yml'],
  applications: ['appx', 'bat', 'cmd', 'com', 'exe', 'msi'],
};

export function buildNativeSearchQuery(
  rootPath: string,
  input: string,
  scope: NativeFileSearchScope,
  filter: NativeSearchFilter,
): NativeFileSearchQuery {
  let text = input.trim();
  let kind: NativeFileSearchQuery['kind'] =
    filter === 'folders' ? 'folders' : filter === 'files' ? 'files' : 'all';
  let extensions = [...(SEARCH_FILTER_EXTENSIONS[filter] ?? [])];
  const folderMatch = /^folder:\s*(.*)$/i.exec(text);
  if (folderMatch) {
    kind = 'folders';
    text = folderMatch[1]?.trim() ?? '';
    extensions = [];
  } else {
    const extensionMatch = /^\*?\.([a-z0-9_-]{1,24})$/i.exec(text);
    if (extensionMatch) {
      text = '';
      extensions = [extensionMatch[1].toLowerCase()];
      if (kind === 'all') kind = 'files';
    }
  }
  return { rootPath, text, scope, kind, extensions };
}

export function canStartNativeSearch(query: NativeFileSearchQuery): boolean {
  return Boolean(query.rootPath && (query.text.trim() || query.extensions.length > 0));
}

export interface DirectoryRefreshCoordinator {
  activate(path: string): number;
  notify(path: string, generation: number): void;
  deactivate(generation: number): void;
}

export function createDirectoryRefreshCoordinator(
  refresh: (path: string, generation: number) => void,
  schedule: (callback: () => void, delayMs: number) => unknown,
  cancel: (handle: unknown) => void,
  debounceMs = 120,
): DirectoryRefreshCoordinator {
  let currentGeneration = 0;
  let currentPath: string | null = null;
  let pending: unknown;

  const clearPending = () => {
    if (pending === undefined) return;
    cancel(pending);
    pending = undefined;
  };

  return {
    activate(path) {
      clearPending();
      currentGeneration += 1;
      currentPath = path;
      return currentGeneration;
    },
    notify(path, generation) {
      if (generation !== currentGeneration || path !== currentPath) return;
      clearPending();
      pending = schedule(() => {
        pending = undefined;
        if (generation === currentGeneration && path === currentPath) {
          refresh(path, generation);
        }
      }, debounceMs);
    },
    deactivate(generation) {
      if (generation !== currentGeneration) return;
      clearPending();
      currentGeneration += 1;
      currentPath = null;
    },
  };
}

export function createFilesClipboard(
  operation: FilesClipboard['operation'],
  sources: readonly string[],
  timestamp = Date.now(),
): FilesClipboard | null {
  const uniqueSources = [...new Set(sources.filter(Boolean))];
  return uniqueSources.length > 0 ? { operation, sources: uniqueSources, timestamp } : null;
}

export function updateNativeSelection(
  visiblePaths: readonly string[],
  selectedPaths: ReadonlySet<string>,
  path: string,
  options: { toggle: boolean; range: boolean; anchorPath: string | null },
): { selected: Set<string>; anchorPath: string } {
  if (options.range && options.anchorPath) {
    const anchor = visiblePaths.indexOf(options.anchorPath);
    const target = visiblePaths.indexOf(path);
    if (anchor >= 0 && target >= 0) {
      const [start, end] = anchor <= target ? [anchor, target] : [target, anchor];
      return {
        selected: new Set(visiblePaths.slice(start, end + 1)),
        anchorPath: options.anchorPath,
      };
    }
  }
  if (options.toggle) {
    const selected = new Set(selectedPaths);
    if (selected.has(path)) selected.delete(path);
    else selected.add(path);
    return { selected, anchorPath: path };
  }
  return { selected: new Set([path]), anchorPath: path };
}

export function createFilesNavigationState(
  initial: FilesLocation = { kind: 'roots' },
): FilesNavigationState {
  return { entries: [initial], index: 0 };
}

export function currentFilesLocation(state: FilesNavigationState): FilesLocation {
  return state.entries[state.index] ?? { kind: 'roots' };
}

export function pushFilesLocation(
  state: FilesNavigationState,
  location: FilesLocation,
): FilesNavigationState {
  const current = currentFilesLocation(state);
  if (
    current.kind === location.kind &&
    (current.kind === 'roots' || current.path === (location as { path: string }).path)
  ) {
    return state;
  }

  return {
    entries: [...state.entries.slice(0, state.index + 1), location],
    index: state.index + 1,
  };
}

export function moveFilesHistory(
  state: FilesNavigationState,
  offset: -1 | 1,
): FilesNavigationState {
  const index = Math.min(state.entries.length - 1, Math.max(0, state.index + offset));
  return index === state.index ? state : { ...state, index };
}

export function createLatestRequestGate() {
  let requestId = 0;
  return {
    begin() {
      requestId += 1;
      return requestId;
    },
    isCurrent(candidate: number) {
      return candidate === requestId;
    },
    invalidate() {
      requestId += 1;
    },
  };
}

const CATEGORY_EXTENSIONS = {
  image: new Set(['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'webp']),
  video: new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm', 'wmv']),
  audio: new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']),
  pdf: new Set(['pdf']),
  document: new Set([
    'csv',
    'doc',
    'docx',
    'md',
    'odt',
    'ppt',
    'pptx',
    'rtf',
    'txt',
    'xls',
    'xlsx',
  ]),
  archive: new Set(['7z', 'bz2', 'gz', 'rar', 'tar', 'zip']),
  code: new Set([
    'css',
    'html',
    'js',
    'json',
    'jsx',
    'py',
    'rs',
    'ts',
    'tsx',
    'xml',
    'yaml',
    'yml',
  ]),
  application: new Set(['appx', 'bat', 'cmd', 'com', 'exe', 'msi']),
} as const;

export type NativeFileCategory = keyof typeof CATEGORY_EXTENSIONS | 'folder' | 'unknown';

export function categorizeNativeFile(entry: NativeFileMetadata): NativeFileCategory {
  if (entry.kind === 'directory' || entry.kind === 'reparse-point') return 'folder';
  const extension = entry.extension?.toLowerCase();
  if (!extension) return 'unknown';
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
    if ((extensions as Set<string>).has(extension))
      return category as keyof typeof CATEGORY_EXTENSIONS;
  }
  return 'unknown';
}

export function visibleNativeEntries(
  entries: readonly NativeFileMetadata[],
  limit: number,
): readonly NativeFileMetadata[] {
  return entries.filter((entry) => !entry.hidden && !entry.system).slice(0, Math.max(0, limit));
}
