'use client';

import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  CircleAlert,
  ClipboardPaste,
  Copy,
  CopyPlus,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  FilePlus2,
  Folder,
  FolderPlus,
  Grid2X2,
  HardDrive,
  Info,
  List,
  LoaderCircle,
  LockKeyhole,
  MonitorCog,
  Pencil,
  RefreshCw,
  Search,
  Scissors,
  Star,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type {
  FilesystemError,
  NativeDeletionOperationSnapshot,
  NativeDirectoryListing,
  NativeFileMetadata,
  NativeFileOperationSnapshot,
  NativeFileRoot,
} from '../../platform';
import type { ContextMenuEntry } from '../context-menu/contextMenuTypes';
import { useContextMenu } from '../context-menu/useContextMenu';
import {
  categorizeNativeFile,
  createFilesNavigationState,
  createFilesClipboard,
  createFilesystemService,
  createLatestRequestGate,
  currentFilesLocation,
  moveFilesHistory,
  pushFilesLocation,
  updateNativeSelection,
  visibleNativeEntries,
  type FilesClipboard,
  type FilesLocation,
} from './filesystemService';

type MockItem = {
  id: number;
  kind: 'folder' | 'file';
  name: string;
  size: string;
  modified: string;
  location: string;
  type: string;
};

const MOCK_ITEMS: readonly MockItem[] = [
  {
    id: 1,
    kind: 'folder',
    name: 'core',
    size: '—',
    modified: '12:41',
    location: 'Home',
    type: 'Environment',
  },
  {
    id: 2,
    kind: 'folder',
    name: 'tidal',
    size: '—',
    modified: '11:08',
    location: 'Home',
    type: 'Environment',
  },
  {
    id: 3,
    kind: 'folder',
    name: 'signal',
    size: '—',
    modified: '09:32',
    location: 'Home',
    type: 'Environment',
  },
  {
    id: 4,
    kind: 'file',
    name: 'runtime.ts',
    size: '4.8 KB',
    modified: '12:38',
    location: 'Home',
    type: 'TypeScript',
  },
  {
    id: 5,
    kind: 'file',
    name: 'field-notes.md',
    size: '2.1 KB',
    modified: '10:16',
    location: 'Home',
    type: 'Markdown',
  },
  {
    id: 6,
    kind: 'file',
    name: 'signal.json',
    size: '918 B',
    modified: '08:47',
    location: 'Home',
    type: 'JSON',
  },
  {
    id: 7,
    kind: 'file',
    name: 'horizon.png',
    size: '2.8 MB',
    modified: 'Yesterday',
    location: 'Images',
    type: 'PNG image',
  },
  {
    id: 8,
    kind: 'file',
    name: 'field-recording.wav',
    size: '18 MB',
    modified: 'Friday',
    location: 'Audio',
    type: 'Wave audio',
  },
];

const MOCK_LOCATIONS = ['Home', 'Recent', 'Starred', 'Images', 'Audio'] as const;
const INITIAL_RENDER_LIMIT = 400;

type NamingDialog = {
  kind: 'folder' | 'file' | 'rename';
  value: string;
  target: NativeFileMetadata | null;
};

type PendingConflict = {
  operation: 'copy' | 'move';
  sources: readonly string[];
  destinationPath: string;
};

type PermanentDeleteDialog = {
  sources: readonly string[];
};

type RecentFilesUndo =
  | { kind: 'trash'; id: string; itemCount: number }
  | { kind: 'rename'; currentPath: string; originalName: string; itemCount: 1 }
  | { kind: 'move'; currentPaths: readonly string[]; originalParent: string; itemCount: number };

function terminalOperation(operation: NativeFileOperationSnapshot) {
  return ['completed', 'failed', 'cancelled'].includes(operation.state);
}

function terminalDeletion(operation: NativeDeletionOperationSnapshot) {
  return ['completed', 'failed', 'cancelled'].includes(operation.state);
}

function leafName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function parentPath(path: string) {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  if (index < 0) return '';
  const parent = path.slice(0, index);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(timestamp: number | null) {
  return timestamp === null
    ? '—'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        timestamp,
      );
}

function fileType(entry: NativeFileMetadata) {
  if (entry.kind === 'directory') return 'Folder';
  if (entry.kind === 'reparse-point') return 'Linked folder';
  return entry.extension ? `${entry.extension.toUpperCase()} file` : 'File';
}

function iconForEntry(
  entry: NativeFileMetadata,
): ComponentType<{ size?: number; className?: string; strokeWidth?: number }> {
  switch (categorizeNativeFile(entry)) {
    case 'folder':
      return Folder;
    case 'image':
      return FileImage;
    case 'video':
      return FileVideo;
    case 'audio':
      return FileAudio;
    case 'archive':
      return FileArchive;
    case 'document':
    case 'pdf':
      return FileText;
    case 'code':
      return FileCode2;
    default:
      return File;
  }
}

function DriveCard({ root, onOpen }: { root: NativeFileRoot; onOpen: () => void }) {
  const used =
    root.totalBytes !== null && root.freeBytes !== null ? root.totalBytes - root.freeBytes : null;
  const percent =
    used !== null && root.totalBytes ? Math.round((used / root.totalBytes) * 100) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group min-h-28 border border-white/[0.06] bg-white/[0.012] p-3 text-left hover:border-[#4aa3ff]/30 hover:bg-[#4aa3ff]/[0.04]"
    >
      <div className="flex items-start gap-3">
        <HardDrive size={24} strokeWidth={1.2} className="mt-0.5 text-[#4aa3ff]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-[#d5e2ec]">{root.label || root.name}</div>
          <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-[#526b80]">
            {root.path} · {root.kind}
          </div>
        </div>
      </div>
      {root.totalBytes !== null && root.freeBytes !== null ? (
        <div className="mt-4">
          <div className="h-1 bg-white/[0.06]">
            <span className="block h-full bg-[#4aa3ff]" style={{ width: `${percent ?? 0}%` }} />
          </div>
          <div className="mt-1.5 font-mono text-[8px] text-[#60798e]">
            {formatBytes(root.freeBytes)} free of {formatBytes(root.totalBytes)}
          </div>
        </div>
      ) : (
        <div className="mt-4 font-mono text-[8px] text-[#60798e]">
          {root.fileSystem || 'Capacity available after opening'}
        </div>
      )}
    </button>
  );
}

export default function FilesApp() {
  const filesystem = useMemo(() => createFilesystemService(), []);
  const contextMenu = useContextMenu();
  const requestGate = useRef(createLatestRequestGate());
  const statGate = useRef(createLatestRequestGate());
  const mounted = useRef(true);
  const locationRef = useRef<FilesLocation>({ kind: 'roots' });
  const jobClipboard = useRef<FilesClipboard | null>(null);
  const transferHistoryMode = useRef<'record' | 'undo' | null>(null);
  const [source, setSource] = useState<'nammu' | 'computer'>('nammu');
  const [mockLocation, setMockLocation] = useState<(typeof MOCK_LOCATIONS)[number]>('Home');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [mockSelected, setMockSelected] = useState<number | null>(4);
  const [nativeSelected, setNativeSelected] = useState<NativeFileMetadata | null>(null);
  const [nativeSelectedPaths, setNativeSelectedPaths] = useState<ReadonlySet<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [fileClipboard, setFileClipboard] = useState<FilesClipboard | null>(null);
  const [namingDialog, setNamingDialog] = useState<NamingDialog | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [activeOperation, setActiveOperation] = useState<NativeFileOperationSnapshot | null>(null);
  const [activeDeletion, setActiveDeletion] = useState<NativeDeletionOperationSnapshot | null>(
    null,
  );
  const [permanentDeleteDialog, setPermanentDeleteDialog] = useState<PermanentDeleteDialog | null>(
    null,
  );
  const [recentUndo, setRecentUndo] = useState<RecentFilesUndo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [navigation, setNavigation] = useState(createFilesNavigationState);
  const [roots, setRoots] = useState<readonly NativeFileRoot[]>([]);
  const [listing, setListing] = useState<NativeDirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FilesystemError | null>(null);
  const [actionError, setActionError] = useState<FilesystemError | null>(null);
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT);
  const [uiDuration, setUiDuration] = useState<number | null>(null);

  const mockVisible = useMemo(
    () =>
      MOCK_ITEMS.filter((item) => {
        const inLocation =
          mockLocation === 'Recent' || mockLocation === 'Starred' || item.location === mockLocation;
        return inLocation && item.name.toLowerCase().includes(query.trim().toLowerCase());
      }),
    [mockLocation, query],
  );
  const mockActive = MOCK_ITEMS.find((item) => item.id === mockSelected) ?? null;
  const nativeVisible = useMemo(
    () => visibleNativeEntries(listing?.entries ?? [], renderLimit),
    [listing, renderLimit],
  );
  const hiddenCount = useMemo(
    () => (listing?.entries ?? []).filter((entry) => entry.hidden || entry.system).length,
    [listing],
  );
  const currentLocation = currentFilesLocation(navigation);
  locationRef.current = currentLocation;
  const selectedNativeEntries = useMemo(
    () => (listing?.entries ?? []).filter((entry) => nativeSelectedPaths.has(entry.path)),
    [listing, nativeSelectedPaths],
  );

  const loadLocation = useCallback(
    async (location: FilesLocation, selectionPaths: readonly string[] = []) => {
      const requestId = requestGate.current.begin();
      statGate.current.invalidate();
      const startedAt = typeof performance === 'undefined' ? 0 : performance.now();
      setLoading(true);
      setError(null);
      setNativeSelected(null);
      setNativeSelectedPaths(new Set());
      setSelectionAnchor(null);
      setRenderLimit(INITIAL_RENDER_LIMIT);
      if (location.kind === 'roots') {
        const result = await filesystem.listRoots();
        if (!requestGate.current.isCurrent(requestId)) return;
        setLoading(false);
        if (result.status === 'success') {
          setRoots(result.value.roots);
          setListing(null);
          setUiDuration(
            typeof performance === 'undefined'
              ? result.value.durationMs
              : performance.now() - startedAt,
          );
          return;
        }
        setError(
          result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
        );
        return;
      }

      const result = await filesystem.listDirectory(location.path);
      if (!requestGate.current.isCurrent(requestId)) return;
      setLoading(false);
      if (result.status === 'success') {
        setListing(result.value);
        const availableSelection = result.value.entries.filter((entry) =>
          selectionPaths.includes(entry.path),
        );
        setNativeSelectedPaths(new Set(availableSelection.map((entry) => entry.path)));
        setNativeSelected(availableSelection[0] ?? null);
        setSelectionAnchor(availableSelection[0]?.path ?? null);
        setUiDuration(
          typeof performance === 'undefined'
            ? result.value.durationMs
            : performance.now() - startedAt,
        );
        return;
      }
      setError(
        result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
      );
    },
    [filesystem],
  );

  useEffect(() => {
    mounted.current = true;
    const gate = requestGate.current;
    const metadataGate = statGate.current;
    return () => {
      mounted.current = false;
      gate.invalidate();
      metadataGate.invalidate();
    };
  }, []);

  const openLocation = useCallback(
    (location: FilesLocation, push = true) => {
      setSource('computer');
      if (push) setNavigation((current) => pushFilesLocation(current, location));
      void loadLocation(location);
    },
    [loadLocation],
  );

  const enterComputer = () => {
    if (!filesystem.supported) {
      setSource('computer');
      setError({
        code: 'IO_ERROR',
        message: 'This PC is available only in the Nammu desktop application.',
      });
      return;
    }
    const rootsLocation: FilesLocation = { kind: 'roots' };
    setNavigation(createFilesNavigationState(rootsLocation));
    openLocation(rootsLocation, false);
  };

  const navigateHistory = (offset: -1 | 1) => {
    const next = moveFilesHistory(navigation, offset);
    if (next === navigation) return;
    setNavigation(next);
    void loadLocation(currentFilesLocation(next));
  };

  const refresh = () => {
    if (source === 'computer' && filesystem.supported)
      void loadLocation(currentLocation, [...nativeSelectedPaths]);
    else setQuery('');
  };

  const selectNativeEntry = useCallback(
    (entry: NativeFileMetadata, options = { toggle: false, range: false }) => {
      const next = updateNativeSelection(
        nativeVisible.map((item) => item.path),
        nativeSelectedPaths,
        entry.path,
        { ...options, anchorPath: selectionAnchor },
      );
      setNativeSelectedPaths(next.selected);
      setSelectionAnchor(next.anchorPath);
      const primary = next.selected.has(entry.path)
        ? entry
        : (listing?.entries.find((item) => next.selected.has(item.path)) ?? null);
      setNativeSelected(primary);
      if (!primary) return;
      const requestId = statGate.current.begin();
      void filesystem.stat(primary.path).then((result) => {
        if (statGate.current.isCurrent(requestId) && result.status === 'success') {
          setNativeSelected(result.value);
        }
      });
    },
    [filesystem, listing, nativeSelectedPaths, nativeVisible, selectionAnchor],
  );

  const openNativeEntry = (entry: NativeFileMetadata) => {
    selectNativeEntry(entry);
    if (entry.navigable) openLocation({ kind: 'directory', path: entry.path });
  };

  const selectedPaths = useCallback(
    (fallback?: NativeFileMetadata) => {
      if (fallback && !nativeSelectedPaths.has(fallback.path)) return [fallback.path];
      return selectedNativeEntries.map((entry) => entry.path);
    },
    [nativeSelectedPaths, selectedNativeEntries],
  );

  const finishOperation = useCallback(
    (operation: NativeFileOperationSnapshot) => {
      const conflictSources = operation.failures
        .filter(
          (failure) =>
            failure.error.code === 'ALREADY_EXISTS' ||
            (operation.operation === 'copy' && failure.error.code === 'SOURCE_EQUALS_DESTINATION'),
        )
        .map((failure) => failure.sourcePath);
      if (
        conflictSources.length > 0 &&
        operation.destinationPath &&
        operation.operation !== 'duplicate'
      ) {
        setPendingConflict({
          operation: operation.operation,
          sources: conflictSources,
          destinationPath: operation.destinationPath,
        });
      }
      if (operation.state === 'cancelled') {
        setNotice('Operation cancelled. Unfinished temporary data was removed.');
      } else if (operation.failures.length > 0) {
        setNotice(`${operation.successes.length} completed · ${operation.failures.length} failed`);
      } else {
        setNotice(
          `${operation.successes.length} item${operation.successes.length === 1 ? '' : 's'} ${operation.operation === 'move' ? 'moved' : operation.operation === 'duplicate' ? 'duplicated' : 'copied'}.`,
        );
      }
      if (jobClipboard.current?.operation === 'cut') {
        const completed = new Set(operation.successes.map((success) => success.sourcePath));
        const remaining = jobClipboard.current.sources.filter((path) => !completed.has(path));
        setFileClipboard(remaining.length > 0 ? createFilesClipboard('cut', remaining) : null);
      }
      jobClipboard.current = null;
      if (operation.operation === 'move') {
        if (transferHistoryMode.current === 'undo' && operation.failures.length === 0) {
          setRecentUndo(null);
        } else if (transferHistoryMode.current === 'record' && operation.successes.length > 0) {
          const parents = new Set(
            operation.successes.map((success) => parentPath(success.sourcePath)).filter(Boolean),
          );
          if (parents.size === 1) {
            setRecentUndo({
              kind: 'move',
              currentPaths: operation.successes.map((success) => success.destinationPath),
              originalParent: [...parents][0],
              itemCount: operation.successes.length,
            });
          }
        }
      }
      transferHistoryMode.current = null;
      const location = locationRef.current;
      if (location.kind === 'directory') {
        void loadLocation(
          location,
          operation.successes.map((success) => success.destinationPath),
        );
      }
    },
    [loadLocation],
  );

  const monitorOperation = useCallback(
    async (started: NativeFileOperationSnapshot, clipboard: FilesClipboard | null = null) => {
      jobClipboard.current = clipboard;
      setActiveOperation(started);
      let snapshot = started;
      while (!terminalOperation(snapshot) && mounted.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        const result = await filesystem.getOperation(started.id);
        if (!mounted.current) return;
        if (result.status !== 'success') {
          jobClipboard.current = null;
          setActionError(
            result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
          );
          return;
        }
        snapshot = result.value;
        setActiveOperation(snapshot);
      }
      if (mounted.current) finishOperation(snapshot);
    },
    [filesystem, finishOperation],
  );

  const startTransfer = useCallback(
    async (
      operation: 'copy' | 'move',
      sources: readonly string[],
      destinationPath: string,
      keepBoth = false,
      clipboard: FilesClipboard | null = null,
      historyMode: 'record' | 'undo' | null = operation === 'move' ? 'record' : null,
    ) => {
      if (
        (activeOperation && !terminalOperation(activeOperation)) ||
        (activeDeletion && !terminalDeletion(activeDeletion))
      ) {
        setActionError({
          code: 'IO_ERROR',
          message: 'Finish or cancel the current file operation before starting another.',
        });
        return;
      }
      setPendingConflict(null);
      setNotice(null);
      setActionError(null);
      transferHistoryMode.current = historyMode;
      const result = await filesystem[operation](
        sources,
        destinationPath,
        keepBoth ? 'keep-both' : 'cancel',
      );
      if (result.status === 'success') {
        void monitorOperation(result.value, clipboard);
      } else {
        transferHistoryMode.current = null;
        setActionError(
          result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
        );
      }
    },
    [activeDeletion, activeOperation, filesystem, monitorOperation],
  );

  const duplicateSelection = useCallback(
    async (fallback?: NativeFileMetadata) => {
      if (
        (activeOperation && !terminalOperation(activeOperation)) ||
        (activeDeletion && !terminalDeletion(activeDeletion))
      ) {
        setActionError({
          code: 'IO_ERROR',
          message: 'Finish or cancel the current file operation before starting another.',
        });
        return;
      }
      const sources = selectedPaths(fallback);
      if (sources.length === 0) return;
      setNotice(null);
      const result = await filesystem.duplicate(sources);
      if (result.status === 'success') void monitorOperation(result.value);
      else
        setActionError(
          result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
        );
    },
    [activeDeletion, activeOperation, filesystem, monitorOperation, selectedPaths],
  );

  const copySelection = useCallback(
    (operation: 'copy' | 'cut', fallback?: NativeFileMetadata) => {
      const next = createFilesClipboard(operation, selectedPaths(fallback));
      if (!next) return;
      setFileClipboard(next);
      setNotice(
        `${next.sources.length} item${next.sources.length === 1 ? '' : 's'} ready to ${operation}.`,
      );
    },
    [selectedPaths],
  );

  const paste = useCallback(() => {
    if (!fileClipboard || currentLocation.kind !== 'directory') return;
    void startTransfer(
      fileClipboard.operation === 'cut' ? 'move' : 'copy',
      fileClipboard.sources,
      currentLocation.path,
      false,
      fileClipboard,
    );
  }, [currentLocation, fileClipboard, startTransfer]);

  const submitNaming = useCallback(async () => {
    if (!namingDialog || currentLocation.kind !== 'directory') return;
    const value = namingDialog.value;
    setActionError(null);
    const result =
      namingDialog.kind === 'folder'
        ? await filesystem.createDirectory(currentLocation.path, value)
        : namingDialog.kind === 'file'
          ? await filesystem.createFile(currentLocation.path, value)
          : namingDialog.target
            ? await filesystem.rename(namingDialog.target.path, value)
            : null;
    if (!result) return;
    if (result.status === 'success') {
      if (namingDialog.kind === 'rename' && namingDialog.target) {
        setRecentUndo({
          kind: 'rename',
          currentPath: result.value.entry.path,
          originalName: namingDialog.target.name,
          itemCount: 1,
        });
      }
      setNamingDialog(null);
      setNotice(
        namingDialog.kind === 'rename'
          ? `Renamed to ${result.value.entry.name}.`
          : `${result.value.entry.name} created.`,
      );
      await loadLocation(currentLocation, [result.value.entry.path]);
    } else {
      setActionError(
        result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
      );
    }
  }, [currentLocation, filesystem, loadLocation, namingDialog]);

  const openRename = useCallback(
    (fallback?: NativeFileMetadata) => {
      const target =
        fallback && !nativeSelectedPaths.has(fallback.path)
          ? fallback
          : selectedNativeEntries.length === 1
            ? selectedNativeEntries[0]
            : null;
      if (target) {
        setActionError(null);
        setNamingDialog({ kind: 'rename', value: target.name, target });
      }
    },
    [nativeSelectedPaths, selectedNativeEntries],
  );

  const cancelOperation = useCallback(() => {
    if (activeOperation && !terminalOperation(activeOperation)) {
      void filesystem.cancelOperation(activeOperation.id).then((result) => {
        if (result.status === 'error') setActionError(result.error);
      });
    }
  }, [activeOperation, filesystem]);

  const finishDeletion = useCallback(
    (operation: NativeDeletionOperationSnapshot) => {
      if (operation.operation === 'trash' && operation.reversible && operation.undoId) {
        setRecentUndo({
          kind: 'trash',
          id: operation.undoId,
          itemCount: operation.successes.length,
        });
      } else if (operation.operation === 'restore' && operation.failures.length === 0) {
        setRecentUndo(null);
      } else if (operation.operation === 'restore' && operation.reversible && operation.undoId) {
        setRecentUndo({
          kind: 'trash',
          id: operation.undoId,
          itemCount: operation.failures.length,
        });
      }

      if (operation.state === 'cancelled') {
        setNotice(
          operation.cancellationMode === 'stop-remaining-only'
            ? `${operation.successes.length} deleted before cancellation. Completed deletions cannot be reversed.`
            : `${operation.successes.length} completed before cancellation. Recycled items remain recoverable.`,
        );
      } else if (operation.failures.length > 0) {
        setNotice(`${operation.successes.length} completed · ${operation.failures.length} failed`);
      } else {
        const verb =
          operation.operation === 'trash'
            ? 'moved to Recycle Bin'
            : operation.operation === 'restore'
              ? 'restored'
              : 'permanently deleted';
        setNotice(
          `${operation.successes.length} item${operation.successes.length === 1 ? '' : 's'} ${verb}.`,
        );
      }

      const location = locationRef.current;
      if (location.kind === 'directory') {
        const selection =
          operation.operation === 'restore'
            ? operation.successes.flatMap((success) =>
                success.destinationPath ? [success.destinationPath] : [],
              )
            : operation.failures.map((failure) => failure.sourcePath);
        void loadLocation(location, selection);
      }
    },
    [loadLocation],
  );

  const monitorDeletion = useCallback(
    async (started: NativeDeletionOperationSnapshot) => {
      setActiveDeletion(started);
      let snapshot = started;
      while (!terminalDeletion(snapshot) && mounted.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        const result = await filesystem.getDeletionOperation(started.id);
        if (!mounted.current) return;
        if (result.status !== 'success') {
          setActionError(
            result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
          );
          return;
        }
        snapshot = result.value;
        setActiveDeletion(snapshot);
      }
      if (mounted.current) finishDeletion(snapshot);
    },
    [filesystem, finishDeletion],
  );

  const startTrash = useCallback(
    async (fallback?: NativeFileMetadata) => {
      if (
        (activeOperation && !terminalOperation(activeOperation)) ||
        (activeDeletion && !terminalDeletion(activeDeletion))
      ) {
        setActionError({
          code: 'IO_ERROR',
          message: 'Finish or cancel the current file operation before starting another.',
        });
        return;
      }
      const sources = selectedPaths(fallback);
      if (sources.length === 0) return;
      setActionError(null);
      setNotice(null);
      const result = await filesystem.trash(sources);
      if (result.status === 'success') void monitorDeletion(result.value);
      else {
        setActionError(
          result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
        );
      }
    },
    [activeDeletion, activeOperation, filesystem, monitorDeletion, selectedPaths],
  );

  const requestPermanentDelete = useCallback(
    (fallback?: NativeFileMetadata) => {
      const sources = selectedPaths(fallback);
      if (sources.length > 0) {
        setActionError(null);
        setPermanentDeleteDialog({ sources });
      }
    },
    [selectedPaths],
  );

  const confirmPermanentDelete = useCallback(async () => {
    if (!permanentDeleteDialog) return;
    if (
      (activeOperation && !terminalOperation(activeOperation)) ||
      (activeDeletion && !terminalDeletion(activeDeletion))
    ) {
      setActionError({
        code: 'IO_ERROR',
        message: 'Finish or cancel the current file operation before starting another.',
      });
      return;
    }
    const sources = permanentDeleteDialog.sources;
    setPermanentDeleteDialog(null);
    setActionError(null);
    setNotice(null);
    const result = await filesystem.permanentlyDelete(sources, true);
    if (result.status === 'success') void monitorDeletion(result.value);
    else {
      setActionError(
        result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
      );
    }
  }, [activeDeletion, activeOperation, filesystem, monitorDeletion, permanentDeleteDialog]);

  const undoRecentMutation = useCallback(async () => {
    if (!recentUndo) return;
    if (
      (activeOperation && !terminalOperation(activeOperation)) ||
      (activeDeletion && !terminalDeletion(activeDeletion))
    ) {
      setActionError({
        code: 'IO_ERROR',
        message: 'Finish or cancel the current file operation before starting another.',
      });
      return;
    }
    setActionError(null);
    if (recentUndo.kind === 'move') {
      await startTransfer(
        'move',
        recentUndo.currentPaths,
        recentUndo.originalParent,
        false,
        null,
        'undo',
      );
      return;
    }
    if (recentUndo.kind === 'rename') {
      const result = await filesystem.rename(recentUndo.currentPath, recentUndo.originalName);
      if (result.status === 'success') {
        setRecentUndo(null);
        setNotice(`Renamed back to ${result.value.entry.name}.`);
        const location = locationRef.current;
        if (location.kind === 'directory') void loadLocation(location, [result.value.entry.path]);
        return;
      }
      setActionError(
        result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
      );
      return;
    }
    const result = await filesystem.restore(recentUndo.id);
    if (result.status === 'success') void monitorDeletion(result.value);
    else {
      setActionError(
        result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
      );
    }
  }, [
    activeDeletion,
    activeOperation,
    filesystem,
    loadLocation,
    monitorDeletion,
    recentUndo,
    startTransfer,
  ]);

  const cancelDeletion = useCallback(() => {
    if (activeDeletion && !terminalDeletion(activeDeletion)) {
      void filesystem.cancelDeletionOperation(activeDeletion.id).then((result) => {
        if (result.status === 'error') setActionError(result.error);
      });
    }
  }, [activeDeletion, filesystem]);

  const showNamingDialog = (dialog: NamingDialog) => {
    setActionError(null);
    setNamingDialog(dialog);
  };

  const nativeMenu = (entry: NativeFileMetadata): ContextMenuEntry[] => [
    { id: 'native-file-header', type: 'header', label: entry.name },
    ...(entry.navigable
      ? [
          {
            id: 'native-file-open',
            label: 'Open folder',
            icon: Folder,
            action: () => openNativeEntry(entry),
          } satisfies ContextMenuEntry,
        ]
      : []),
    {
      id: 'native-file-cut',
      label: 'Cut',
      icon: Scissors,
      action: () => copySelection('cut', entry),
    },
    {
      id: 'native-file-copy',
      label: 'Copy',
      icon: Copy,
      action: () => copySelection('copy', entry),
    },
    {
      id: 'native-file-rename',
      label: 'Rename',
      icon: Pencil,
      action: () => openRename(entry),
    },
    {
      id: 'native-file-duplicate',
      label: 'Duplicate',
      icon: CopyPlus,
      action: () => void duplicateSelection(entry),
    },
    { id: 'native-file-delete-separator', type: 'separator' },
    {
      id: 'native-file-delete',
      label: 'Delete',
      icon: Trash2,
      shortcut: 'Delete',
      action: () => void startTrash(entry),
    },
    {
      id: 'native-file-permanent-delete',
      label: 'Delete Permanently',
      icon: Trash2,
      shortcut: 'Shift+Delete',
      danger: true,
      action: () => requestPermanentDelete(entry),
    },
    {
      id: 'native-file-properties',
      label: 'Properties',
      icon: Info,
      action: () => selectNativeEntry(entry),
    },
  ];

  const explorerMenu: ContextMenuEntry[] = [
    {
      id: 'files-header',
      type: 'header',
      label: source === 'computer' ? 'This PC · Native' : `${mockLocation} · Nammu`,
    },
    { id: 'files-refresh', label: 'Refresh', icon: RefreshCw, action: refresh },
    ...(source === 'computer' && currentLocation.kind === 'directory'
      ? [
          {
            id: 'files-new-folder',
            label: 'New folder',
            icon: FolderPlus,
            action: () => showNamingDialog({ kind: 'folder', value: 'New folder', target: null }),
          } satisfies ContextMenuEntry,
          {
            id: 'files-new-file',
            label: 'New file',
            icon: FilePlus2,
            action: () => showNamingDialog({ kind: 'file', value: 'New file.txt', target: null }),
          } satisfies ContextMenuEntry,
          {
            id: 'files-paste',
            label: 'Paste',
            icon: ClipboardPaste,
            disabled: !fileClipboard,
            action: paste,
          } satisfies ContextMenuEntry,
        ]
      : []),
    {
      id: 'files-view',
      label: 'View',
      icon: Grid2X2,
      items: [
        {
          id: 'files-list',
          label: 'List',
          icon: List,
          checked: view === 'list',
          action: () => setView('list'),
        },
        {
          id: 'files-grid',
          label: 'Grid',
          icon: Grid2X2,
          checked: view === 'grid',
          action: () => setView('grid'),
        },
      ],
    },
  ];

  const nativeEntriesTotal = (listing?.entries.length ?? 0) - hiddenCount;
  const activeName = source === 'computer' ? nativeSelected?.name : mockActive?.name;
  const operationPercent = activeOperation
    ? activeOperation.bytesTotal && activeOperation.bytesTotal > 0
      ? Math.min(
          100,
          Math.round((activeOperation.bytesProcessed / activeOperation.bytesTotal) * 100),
        )
      : activeOperation.filesTotal && activeOperation.filesTotal > 0
        ? Math.min(
            100,
            Math.round((activeOperation.filesCompleted / activeOperation.filesTotal) * 100),
          )
        : null
    : null;

  const handleFilesKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    if (source !== 'computer' || currentLocation.kind !== 'directory') return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && event.shiftKey && key === 'n') {
      event.preventDefault();
      showNamingDialog({ kind: 'folder', value: 'New folder', target: null });
    } else if (event.ctrlKey && key === 'c') {
      event.preventDefault();
      copySelection('copy');
    } else if (event.ctrlKey && key === 'x') {
      event.preventDefault();
      copySelection('cut');
    } else if (event.ctrlKey && key === 'v') {
      event.preventDefault();
      paste();
    } else if (event.ctrlKey && key === 'd') {
      event.preventDefault();
      void duplicateSelection();
    } else if (event.key === 'F2') {
      event.preventDefault();
      openRename();
    } else if (event.key === 'Delete') {
      event.preventDefault();
      if (event.shiftKey) requestPermanentDelete();
      else void startTrash();
    }
  };

  return (
    <div
      className="relative flex h-full min-h-0 bg-[#05080d] text-[11px] outline-none"
      tabIndex={0}
      onKeyDown={handleFilesKeyDown}
      onContextMenu={(event) =>
        contextMenu.openAtEvent(event, explorerMenu, { ariaLabel: 'Files menu' })
      }
    >
      <aside className="w-40 shrink-0 border-r border-white/[0.06] bg-white/[0.012] p-2">
        <div className="mb-2 px-2 font-mono text-[8px] uppercase tracking-[0.22em] text-[#476077]">
          Files
        </div>
        <button
          type="button"
          onClick={() => {
            requestGate.current.invalidate();
            setSource('nammu');
            setError(null);
          }}
          className={`mb-0.5 flex w-full items-center gap-2 px-2 py-1.5 text-left ${source === 'nammu' ? 'bg-[#4aa3ff]/10 text-[#cfe6ff]' : 'text-[#71889d] hover:bg-white/[0.035]'}`}
        >
          <MonitorCog size={12} /> Nammu
        </button>
        <button
          type="button"
          onClick={enterComputer}
          className={`mb-2 flex w-full items-center gap-2 px-2 py-1.5 text-left ${source === 'computer' ? 'bg-[#4aa3ff]/10 text-[#cfe6ff]' : 'text-[#71889d] hover:bg-white/[0.035]'}`}
        >
          <HardDrive size={12} /> This PC{' '}
          {!filesystem.supported && <LockKeyhole size={9} className="ml-auto" />}
        </button>
        {source === 'nammu'
          ? MOCK_LOCATIONS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setMockLocation(name);
                  setMockSelected(null);
                }}
                className={`mb-0.5 flex w-full items-center gap-2 px-2 py-1.5 text-left ${mockLocation === name ? 'bg-white/[0.04] text-[#cfe6ff]' : 'text-[#61798d] hover:bg-white/[0.025]'}`}
              >
                {name === 'Starred' ? <Star size={11} /> : <Folder size={11} />} {name}
              </button>
            ))
          : roots.map((root) => (
              <button
                key={root.path}
                type="button"
                onClick={() => openLocation({ kind: 'directory', path: root.path })}
                className="mb-0.5 flex w-full items-center gap-2 px-2 py-1.5 text-left text-[#61798d] hover:bg-white/[0.025] hover:text-[#cfe6ff]"
              >
                <HardDrive size={11} />
                <span className="truncate">{root.label || root.path}</span>
              </button>
            ))}
        <div className="mt-4 border-t border-white/[0.05] px-2 pt-3 font-mono text-[8px] leading-4 text-[#476077]">
          {source === 'computer' ? 'NATIVE · READ / WRITE' : 'NAMMU · PROTOTYPE'}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-white/[0.06] px-2">
          <button
            type="button"
            onClick={() => navigateHistory(-1)}
            disabled={source !== 'computer' || navigation.index === 0}
            className="p-1.5 text-[#7890a5] hover:bg-white/[0.04] disabled:opacity-25"
            aria-label="Back"
          >
            <ArrowLeft size={13} />
          </button>
          <button
            type="button"
            onClick={() => navigateHistory(1)}
            disabled={source !== 'computer' || navigation.index >= navigation.entries.length - 1}
            className="p-1.5 text-[#7890a5] hover:bg-white/[0.04] disabled:opacity-25"
            aria-label="Forward"
          >
            <ArrowRight size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (source !== 'computer' || currentLocation.kind === 'roots') return;
              openLocation(
                listing?.parentPath
                  ? { kind: 'directory', path: listing.parentPath }
                  : { kind: 'roots' },
              );
            }}
            disabled={source !== 'computer' || currentLocation.kind === 'roots'}
            className="p-1.5 text-[#7890a5] hover:bg-white/[0.04] disabled:opacity-25"
            aria-label="Up one level"
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            onClick={refresh}
            className="p-1.5 text-[#7890a5] hover:bg-white/[0.04]"
            aria-label="Refresh"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="ml-1 flex min-w-0 flex-1 items-center overflow-x-auto border border-white/[0.06] bg-black/20 px-2 py-1.5 font-mono text-[9px] text-[#557087] os-scrollbar">
            {source === 'nammu' ? (
              <>
                <span>Nammu</span>
                <ChevronRight size={10} />
                <span className="text-[#9ab3c7]">{mockLocation}</span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => openLocation({ kind: 'roots' })}
                  className="shrink-0 hover:text-[#cfe6ff]"
                >
                  This PC
                </button>
                {listing?.breadcrumbs.map((part) => (
                  <span key={part.path} className="flex shrink-0 items-center">
                    <ChevronRight size={10} />
                    <button
                      type="button"
                      onClick={() => openLocation({ kind: 'directory', path: part.path })}
                      className="hover:text-[#cfe6ff]"
                    >
                      {part.name}
                    </button>
                  </span>
                ))}
              </>
            )}
          </div>
          {source === 'nammu' && (
            <div className="ml-1 flex w-40 items-center gap-1.5 border border-white/[0.06] bg-black/20 px-2 py-1.5">
              <Search size={10} className="text-[#4aa3ff]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter resources"
                className="min-w-0 flex-1 bg-transparent text-[9px] text-[#c9d8e4] outline-none"
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => setView('list')}
            className={`p-1.5 ${view === 'list' ? 'text-[#4aa3ff]' : 'text-[#52697c]'}`}
            aria-label="List view"
          >
            <List size={12} />
          </button>
          <button
            type="button"
            onClick={() => setView('grid')}
            className={`p-1.5 ${view === 'grid' ? 'text-[#4aa3ff]' : 'text-[#52697c]'}`}
            aria-label="Grid view"
          >
            <Grid2X2 size={12} />
          </button>
        </div>

        {source === 'computer' && currentLocation.kind === 'directory' && (
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/[0.05] px-2">
            <button
              type="button"
              onClick={() =>
                showNamingDialog({ kind: 'folder', value: 'New folder', target: null })
              }
              className="flex items-center gap-1.5 px-2 py-1 text-[9px] text-[#89a1b5] hover:bg-white/[0.035] hover:text-[#d4e5f2]"
            >
              <FolderPlus size={11} /> New folder
            </button>
            <button
              type="button"
              onClick={() =>
                showNamingDialog({ kind: 'file', value: 'New file.txt', target: null })
              }
              className="flex items-center gap-1.5 px-2 py-1 text-[9px] text-[#89a1b5] hover:bg-white/[0.035] hover:text-[#d4e5f2]"
            >
              <FilePlus2 size={11} /> New file
            </button>
            <span className="mx-1 h-4 w-px bg-white/[0.06]" />
            <button
              type="button"
              onClick={() => copySelection('cut')}
              disabled={selectedNativeEntries.length === 0}
              className="p-1.5 text-[#71889d] hover:bg-white/[0.035] hover:text-[#d4e5f2] disabled:opacity-25"
              aria-label="Cut selected items"
              title="Cut (Ctrl+X)"
            >
              <Scissors size={11} />
            </button>
            <button
              type="button"
              onClick={() => copySelection('copy')}
              disabled={selectedNativeEntries.length === 0}
              className="p-1.5 text-[#71889d] hover:bg-white/[0.035] hover:text-[#d4e5f2] disabled:opacity-25"
              aria-label="Copy selected items"
              title="Copy (Ctrl+C)"
            >
              <Copy size={11} />
            </button>
            <button
              type="button"
              onClick={paste}
              disabled={!fileClipboard}
              className="p-1.5 text-[#71889d] hover:bg-white/[0.035] hover:text-[#d4e5f2] disabled:opacity-25"
              aria-label="Paste items"
              title="Paste (Ctrl+V)"
            >
              <ClipboardPaste size={11} />
            </button>
            <button
              type="button"
              onClick={() => openRename()}
              disabled={selectedNativeEntries.length !== 1}
              className="p-1.5 text-[#71889d] hover:bg-white/[0.035] hover:text-[#d4e5f2] disabled:opacity-25"
              aria-label="Rename selected item"
              title="Rename (F2)"
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              onClick={() => void duplicateSelection()}
              disabled={selectedNativeEntries.length === 0}
              className="p-1.5 text-[#71889d] hover:bg-white/[0.035] hover:text-[#d4e5f2] disabled:opacity-25"
              aria-label="Duplicate selected items"
              title="Duplicate (Ctrl+D)"
            >
              <CopyPlus size={11} />
            </button>
            <span className="mx-1 h-4 w-px bg-white/[0.06]" />
            <button
              type="button"
              onClick={() => void startTrash()}
              disabled={selectedNativeEntries.length === 0}
              className="p-1.5 text-[#71889d] hover:bg-white/[0.035] hover:text-[#d4e5f2] disabled:opacity-25"
              aria-label="Move selected items to Recycle Bin"
              title="Delete (Recycle Bin)"
            >
              <Trash2 size={11} />
            </button>
            <button
              type="button"
              onClick={() => void undoRecentMutation()}
              disabled={!recentUndo}
              className="p-1.5 text-[#71889d] hover:bg-white/[0.035] hover:text-[#d4e5f2] disabled:opacity-25"
              aria-label="Undo recent file operation"
              title={recentUndo ? `Undo recent ${recentUndo.kind} operation` : 'Nothing to undo'}
            >
              <Undo2 size={11} />
            </button>
            <div className="ml-auto truncate font-mono text-[8px] text-[#4f687d]">
              {fileClipboard
                ? `${fileClipboard.sources.length} item${fileClipboard.sources.length === 1 ? '' : 's'} to ${fileClipboard.operation}`
                : `${selectedNativeEntries.length} selected`}
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-auto p-1.5 os-scrollbar">
            {source === 'computer' && loading && (
              <div className="grid h-40 place-items-center font-mono text-[9px] text-[#60798e]">
                Reading location…
              </div>
            )}
            {source === 'computer' && !loading && error && (
              <div className="m-3 flex max-w-lg items-start gap-3 border border-[#ff6b6b]/20 bg-[#ff6b6b]/[0.035] p-4">
                <CircleAlert size={17} className="mt-0.5 shrink-0 text-[#ff8b8b]" />
                <div>
                  <div className="text-[11px] text-[#f0c2c2]">Location unavailable</div>
                  <div className="mt-1 font-mono text-[9px] leading-4 text-[#987778]">
                    {error.message}
                  </div>
                </div>
              </div>
            )}
            {source === 'computer' && !loading && !error && currentLocation.kind === 'roots' && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2 p-2">
                {roots.map((root) => (
                  <DriveCard
                    key={root.path}
                    root={root}
                    onOpen={() => openLocation({ kind: 'directory', path: root.path })}
                  />
                ))}
              </div>
            )}
            {source === 'computer' &&
              !loading &&
              !error &&
              currentLocation.kind === 'roots' &&
              roots.length === 0 && (
                <div className="grid h-40 place-items-center font-mono text-[9px] text-[#52697c]">
                  No Windows drives are currently available
                </div>
              )}
            {view === 'list' &&
              (source === 'nammu' || (source === 'computer' && listing && !loading && !error)) && (
                <div className="grid grid-cols-[22px_minmax(120px,1fr)_100px_92px_78px] border-b border-white/[0.05] px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[#43586b]">
                  <span />
                  <span>Name</span>
                  <span>Type</span>
                  <span>Size</span>
                  <span className="text-right">Modified</span>
                </div>
              )}
            {source === 'nammu' && (
              <div
                className={
                  view === 'grid'
                    ? 'grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-1.5 p-1'
                    : ''
                }
              >
                {mockVisible.map((item) => {
                  const Icon = item.kind === 'folder' ? Folder : File;
                  return view === 'grid' ? (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMockSelected(item.id)}
                      className={`flex min-h-24 flex-col items-center justify-center gap-2 border p-2 ${mockSelected === item.id ? 'border-[#4aa3ff]/35 bg-[#4aa3ff]/8' : 'border-white/[0.04] hover:bg-white/[0.025]'}`}
                    >
                      <Icon
                        size={24}
                        strokeWidth={1.1}
                        className={item.kind === 'folder' ? 'text-[#4aa3ff]' : 'text-[#7f95a8]'}
                      />
                      <span className="max-w-full truncate text-[10px] text-[#c6d4df]">
                        {item.name}
                      </span>
                    </button>
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMockSelected(item.id)}
                      className={`grid w-full grid-cols-[22px_minmax(120px,1fr)_100px_92px_78px] items-center px-2 py-1.5 text-left ${mockSelected === item.id ? 'bg-[#4aa3ff]/8' : 'hover:bg-white/[0.025]'}`}
                    >
                      <Icon
                        size={12}
                        className={item.kind === 'folder' ? 'text-[#4aa3ff]' : 'text-[#6f8598]'}
                      />
                      <span className="truncate text-[#c9d7e2]">{item.name}</span>
                      <span className="truncate font-mono text-[8px] text-[#536a7d]">
                        {item.type}
                      </span>
                      <span className="font-mono text-[8px] text-[#536a7d]">{item.size}</span>
                      <span className="text-right font-mono text-[8px] text-[#465c6f]">
                        {item.modified}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {source === 'computer' && listing && !loading && !error && (
              <div
                className={
                  view === 'grid'
                    ? 'grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-1.5 p-1'
                    : ''
                }
              >
                {nativeVisible.map((entry) => {
                  const Icon = iconForEntry(entry);
                  const selected = nativeSelectedPaths.has(entry.path);
                  const common = {
                    onClick: (event: ReactMouseEvent) =>
                      selectNativeEntry(entry, {
                        toggle: event.ctrlKey || event.metaKey,
                        range: event.shiftKey,
                      }),
                    onDoubleClick: () => openNativeEntry(entry),
                    onContextMenu: (event: ReactMouseEvent) => {
                      if (!nativeSelectedPaths.has(entry.path)) {
                        selectNativeEntry(entry);
                      }
                      contextMenu.openAtEvent(event, nativeMenu(entry), {
                        ariaLabel: `${entry.name} menu`,
                      });
                    },
                  };
                  return view === 'grid' ? (
                    <button
                      key={entry.path}
                      type="button"
                      {...common}
                      className={`flex min-h-24 flex-col items-center justify-center gap-2 border p-2 ${selected ? 'border-[#4aa3ff]/35 bg-[#4aa3ff]/8' : 'border-white/[0.04] hover:bg-white/[0.025]'}`}
                    >
                      <Icon
                        size={24}
                        strokeWidth={1.1}
                        className={entry.navigable ? 'text-[#4aa3ff]' : 'text-[#7f95a8]'}
                      />
                      <span className="max-w-full truncate text-[10px] text-[#c6d4df]">
                        {entry.name}
                      </span>
                      <span className="font-mono text-[7px] uppercase text-[#52697c]">
                        {fileType(entry)}
                      </span>
                    </button>
                  ) : (
                    <button
                      key={entry.path}
                      type="button"
                      {...common}
                      className={`grid w-full grid-cols-[22px_minmax(120px,1fr)_100px_92px_78px] items-center px-2 py-1.5 text-left ${selected ? 'bg-[#4aa3ff]/8' : 'hover:bg-white/[0.025]'}`}
                    >
                      <Icon
                        size={12}
                        className={entry.navigable ? 'text-[#4aa3ff]' : 'text-[#6f8598]'}
                      />
                      <span className="truncate text-[#c9d7e2]">{entry.name}</span>
                      <span className="truncate font-mono text-[8px] text-[#536a7d]">
                        {fileType(entry)}
                      </span>
                      <span className="font-mono text-[8px] text-[#536a7d]">
                        {formatBytes(entry.sizeBytes)}
                      </span>
                      <span className="truncate text-right font-mono text-[8px] text-[#465c6f]">
                        {formatDate(entry.modifiedAtMs)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {source === 'computer' && listing && !loading && !error && nativeEntriesTotal === 0 && (
              <div className="grid h-40 place-items-center font-mono text-[9px] text-[#52697c]">
                This folder is empty
              </div>
            )}
            {source === 'computer' && listing && nativeVisible.length < nativeEntriesTotal && (
              <div className="flex justify-center p-3">
                <button
                  type="button"
                  onClick={() => setRenderLimit((value) => value + INITIAL_RENDER_LIMIT)}
                  className="border border-white/[0.08] px-3 py-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[#7890a5] hover:border-[#4aa3ff]/30 hover:text-[#cfe6ff]"
                >
                  Show {Math.min(INITIAL_RENDER_LIMIT, nativeEntriesTotal - nativeVisible.length)}{' '}
                  more
                </button>
              </div>
            )}
          </main>

          <aside className="hidden w-44 shrink-0 border-l border-white/[0.06] p-3 md:block">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#43586b]">
              Properties
            </div>
            {activeName ? (
              <div className="mt-5">
                <div className="grid h-16 place-items-center border border-white/[0.05] bg-white/[0.015]">
                  <File size={22} strokeWidth={1} className="text-[#4aa3ff]" />
                </div>
                <div className="mt-3 break-all text-[#d1deea]">{activeName}</div>
                {source === 'computer' && nativeSelected ? (
                  <div className="mt-2 break-all font-mono text-[8px] leading-5 text-[#536a7d]">
                    {fileType(nativeSelected)}
                    <br />
                    {formatBytes(nativeSelected.sizeBytes)}
                    <br />
                    Modified {formatDate(nativeSelected.modifiedAtMs)}
                    <br />
                    {nativeSelected.readOnly ? 'Read-only' : 'Readable'}
                    <br />
                    {nativeSelected.path}
                  </div>
                ) : (
                  mockActive && (
                    <div className="mt-1 font-mono text-[8px] leading-5 text-[#536a7d]">
                      {mockActive.type}
                      <br />
                      {mockActive.size}
                      <br />
                      Modified {mockActive.modified}
                    </div>
                  )
                )}
              </div>
            ) : (
              <div className="mt-5 font-mono text-[8px] text-[#43586b]">Select an item</div>
            )}
          </aside>
        </div>

        {(actionError || notice) && (
          <div
            className={`flex min-h-7 shrink-0 items-center gap-2 border-t px-2 font-mono text-[8px] ${actionError ? 'border-[#ff6b6b]/20 bg-[#ff6b6b]/[0.035] text-[#d89a9a]' : 'border-[#4aa3ff]/15 bg-[#4aa3ff]/[0.025] text-[#7698b5]'}`}
          >
            {actionError && <CircleAlert size={11} className="shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{actionError?.message ?? notice}</span>
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setNotice(null);
              }}
              className="p-1 hover:bg-white/[0.04]"
              aria-label="Dismiss message"
            >
              <X size={10} />
            </button>
          </div>
        )}

        <div className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.05] px-2 font-mono text-[8px] text-[#465c6f]">
          <span>
            {source === 'nammu'
              ? `${mockVisible.length} prototype resources`
              : listing
                ? `${nativeEntriesTotal} items${hiddenCount ? ` · ${hiddenCount} protected/hidden` : ''}`
                : `${roots.length} drives`}
          </span>
          <span>
            {source === 'computer'
              ? `${loading ? 'Reading' : 'Native filesystem'}${uiDuration !== null ? ` · ${Math.round(uiDuration)} ms` : ''}`
              : 'Web-safe mock workspace'}
          </span>
        </div>
      </section>

      {activeOperation && (
        <div className="absolute bottom-9 right-3 z-30 w-72 border border-[#4aa3ff]/20 bg-[#07111b]/95 p-3 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2">
            {!terminalOperation(activeOperation) && (
              <LoaderCircle size={13} className="animate-spin text-[#4aa3ff]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] capitalize text-[#c9dbe9]">
                {activeOperation.operation} · {activeOperation.state}
              </div>
              <div className="mt-0.5 truncate font-mono text-[8px] text-[#5e7a90]">
                {activeOperation.currentItem
                  ? leafName(activeOperation.currentItem)
                  : `${activeOperation.successes.length} completed`}
              </div>
            </div>
            {terminalOperation(activeOperation) ? (
              <button
                type="button"
                onClick={() => setActiveOperation(null)}
                className="p-1 text-[#668095] hover:bg-white/[0.04] hover:text-white"
                aria-label="Close operation status"
              >
                <X size={11} />
              </button>
            ) : (
              <button
                type="button"
                onClick={cancelOperation}
                className="border border-white/[0.08] px-2 py-1 font-mono text-[8px] text-[#8da2b4] hover:border-[#ff7b7b]/30 hover:text-[#ffaaaa]"
              >
                Cancel
              </button>
            )}
          </div>
          <div className="mt-2 h-1 bg-white/[0.06]">
            <span
              className={`block h-full bg-[#4aa3ff] transition-[width] ${operationPercent === null && !terminalOperation(activeOperation) ? 'w-1/3 animate-pulse' : ''}`}
              style={operationPercent === null ? undefined : { width: `${operationPercent}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[8px] text-[#536d82]">
            <span>
              {activeOperation.filesCompleted}
              {activeOperation.filesTotal === null ? '' : ` / ${activeOperation.filesTotal}`} files
            </span>
            <span>
              {formatBytes(activeOperation.bytesProcessed)}
              {activeOperation.bytesTotal === null
                ? ''
                : ` / ${formatBytes(activeOperation.bytesTotal)}`}
            </span>
          </div>
        </div>
      )}

      {activeDeletion && (
        <div className="absolute bottom-9 right-3 z-30 w-72 border border-[#4aa3ff]/20 bg-[#07111b]/95 p-3 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2">
            {!terminalDeletion(activeDeletion) && (
              <LoaderCircle size={13} className="animate-spin text-[#4aa3ff]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] capitalize text-[#c9dbe9]">
                {activeDeletion.operation.replace('-', ' ')} · {activeDeletion.state}
              </div>
              <div className="mt-0.5 truncate font-mono text-[8px] text-[#5e7a90]">
                {activeDeletion.currentItem
                  ? leafName(activeDeletion.currentItem)
                  : `${activeDeletion.successes.length} completed`}
              </div>
            </div>
            {terminalDeletion(activeDeletion) ? (
              <button
                type="button"
                onClick={() => setActiveDeletion(null)}
                className="p-1 text-[#668095] hover:bg-white/[0.04] hover:text-white"
                aria-label="Close deletion status"
              >
                <X size={11} />
              </button>
            ) : (
              <button
                type="button"
                onClick={cancelDeletion}
                className="border border-white/[0.08] px-2 py-1 font-mono text-[8px] text-[#8da2b4] hover:border-[#ff7b7b]/30 hover:text-[#ffaaaa]"
                title={
                  activeDeletion.cancellationMode === 'stop-remaining-only'
                    ? 'Stops remaining work; completed permanent deletions cannot be restored'
                    : 'Stops remaining items; recycled items remain recoverable'
                }
              >
                Stop
              </button>
            )}
          </div>
          <div className="mt-2 h-1 bg-white/[0.06]">
            <span
              className="block h-full bg-[#4aa3ff] transition-[width]"
              style={{
                width: `${Math.round((activeDeletion.filesCompleted / Math.max(activeDeletion.filesTotal, 1)) * 100)}%`,
              }}
            />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[8px] text-[#536d82]">
            <span>
              {activeDeletion.filesCompleted} / {activeDeletion.filesTotal} items
            </span>
            <span>{activeDeletion.failures.length} failed</span>
          </div>
        </div>
      )}

      {permanentDeleteDialog && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-[2px]">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="permanent-delete-title"
            className="w-full max-w-md border border-[#ff6b6b]/25 bg-[#07111b] p-4 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <Trash2 size={18} className="mt-0.5 shrink-0 text-[#ff8585]" />
              <div>
                <div id="permanent-delete-title" className="text-[12px] text-[#f0d3d3]">
                  Permanently delete {permanentDeleteDialog.sources.length}{' '}
                  {permanentDeleteDialog.sources.length === 1 ? 'item' : 'items'}?
                </div>
                <p className="mt-2 font-mono text-[9px] leading-4 text-[#947579]">
                  These items will not be moved to Recycle Bin and cannot be restored through Nammu
                  Files.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setPermanentDeleteDialog(null)}
                className="border border-white/[0.08] px-3 py-1.5 text-[9px] text-[#8094a5] hover:bg-white/[0.035]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmPermanentDelete()}
                className="border border-[#ff6b6b]/40 bg-[#ff6b6b]/10 px-3 py-1.5 text-[9px] text-[#ffc2c2] hover:bg-[#ff6b6b]/15"
              >
                Delete Permanently
              </button>
            </div>
          </section>
        </div>
      )}

      {namingDialog && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]">
          <form
            className="w-full max-w-sm border border-[#4aa3ff]/20 bg-[#07111b] p-4 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void submitNaming();
            }}
          >
            <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-[#4aa3ff]">
              {namingDialog.kind === 'folder'
                ? 'Create folder'
                : namingDialog.kind === 'file'
                  ? 'Create empty file'
                  : 'Rename item'}
            </div>
            <input
              autoFocus
              value={namingDialog.value}
              onChange={(event) => {
                setActionError(null);
                setNamingDialog({ ...namingDialog, value: event.target.value });
              }}
              onFocus={(event) => {
                if (namingDialog.kind !== 'rename') event.currentTarget.select();
              }}
              className="mt-3 w-full border border-white/[0.09] bg-black/30 px-3 py-2 text-[11px] text-[#d6e3ed] outline-none focus:border-[#4aa3ff]/45"
              aria-label="Item name"
            />
            {actionError && (
              <div className="mt-2 font-mono text-[8px] leading-4 text-[#d88f8f]">
                {actionError.message}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setNamingDialog(null);
                  setActionError(null);
                }}
                className="border border-white/[0.08] px-3 py-1.5 text-[9px] text-[#8094a5] hover:bg-white/[0.035]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!namingDialog.value}
                className="border border-[#4aa3ff]/35 bg-[#4aa3ff]/10 px-3 py-1.5 text-[9px] text-[#c9e4fb] hover:bg-[#4aa3ff]/15 disabled:opacity-35"
              >
                {namingDialog.kind === 'rename' ? 'Rename' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {pendingConflict && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm border border-[#f5b942]/25 bg-[#07111b] p-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <CircleAlert size={17} className="mt-0.5 shrink-0 text-[#f5b942]" />
              <div>
                <div className="text-[11px] text-[#e6d5b2]">Destination conflict</div>
                <div className="mt-1 font-mono text-[8px] leading-4 text-[#887b66]">
                  {pendingConflict.sources.length} item
                  {pendingConflict.sources.length === 1 ? '' : 's'} already exist. Nammu has not
                  overwritten anything.
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingConflict(null)}
                className="border border-white/[0.08] px-3 py-1.5 text-[9px] text-[#8094a5] hover:bg-white/[0.035]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const conflict = pendingConflict;
                  void startTransfer(
                    conflict.operation,
                    conflict.sources,
                    conflict.destinationPath,
                    true,
                    fileClipboard,
                  );
                }}
                className="border border-[#4aa3ff]/35 bg-[#4aa3ff]/10 px-3 py-1.5 text-[9px] text-[#c9e4fb] hover:bg-[#4aa3ff]/15"
              >
                Keep both
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
