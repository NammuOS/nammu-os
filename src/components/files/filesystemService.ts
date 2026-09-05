import type {
  FilesystemResult,
  NativeDirectoryListing,
  NativeDeletionOperationSnapshot,
  NativeFileMetadata,
  NativeFileConflictStrategy,
  NativeFileMutation,
  NativeFileOperationSnapshot,
  NativeFileRoots,
  PlatformFilesystem,
} from '../../platform';
import { getPlatformCapabilities } from '../../platform';

export type FilesLocation = { kind: 'roots' } | { kind: 'directory'; path: string };

export interface FilesNavigationState {
  readonly entries: readonly FilesLocation[];
  readonly index: number;
}

export interface FilesystemService {
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
}

export interface FilesClipboard {
  readonly operation: 'copy' | 'cut';
  readonly sources: readonly string[];
  readonly timestamp: number;
}

export function createFilesystemService(
  filesystem: PlatformFilesystem = getPlatformCapabilities().filesystem,
): FilesystemService {
  return Object.freeze({
    supported: filesystem.supported,
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
  });
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
  video: new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm']),
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
