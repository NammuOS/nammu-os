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
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type {
  FilesystemError,
  NativeArchiveOperationSnapshot,
  NativeArchiveSummary,
  NativeDirectoryWatchSubscription,
  NativeDeletionOperationSnapshot,
  NativeDirectoryListing,
  NativeFileMetadata,
  NativeFileClipboardOperation,
  NativeFileClipboardSnapshot,
  NativeFileDragEvent,
  NativeFileDragOperation,
  NativeFileOperationSnapshot,
  NativeFileRoot,
  NativeFileSearchScope,
  NativeFileSearchSnapshot,
} from '../../platform';
import type { ContextMenuEntry } from '../context-menu/contextMenuTypes';
import { useContextMenu } from '../context-menu/useContextMenu';
import {
  categorizeNativeFile,
  buildNativeSearchQuery,
  canStartNativeSearch,
  createFilesNavigationState,
  createDirectoryRefreshCoordinator,
  createFilesClipboard,
  createFilesystemService,
  createLatestRequestGate,
  currentFilesLocation,
  moveFilesHistory,
  pushFilesLocation,
  resolveNativeDropOperation,
  updateNativeSelection,
  visibleNativeEntries,
  type FilesClipboard,
  type FilesLocation,
  type NativeSearchFilter,
} from './filesystemService';
import {
  createNativePreviewScheduler,
  type NativePreviewScheduler,
} from './nativePreviewScheduler';
import { FilePropertiesDialog } from './FilePropertiesDialog';
import { ArchiveBrowser } from './ArchiveBrowser';

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

type NativeDropFeedback = {
  session: number;
  path: string;
  label: string;
  operation: 'copy' | 'move';
};

type PendingNativeDrag = {
  path: string;
  paths: readonly string[];
  x: number;
  y: number;
  operation: NativeFileDragOperation;
};

type LoadLocationOptions = {
  background?: boolean;
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

function terminalArchiveOperation(operation: NativeArchiveOperationSnapshot) {
  return ['completed', 'failed', 'cancelled'].includes(operation.state);
}

function terminalSearch(search: NativeFileSearchSnapshot) {
  return ['completed', 'failed', 'cancelled'].includes(search.state);
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

function previewIdentity(entry: NativeFileMetadata) {
  return `${entry.path}\u0000${entry.sizeBytes ?? ''}\u0000${entry.modifiedAtMs ?? ''}`;
}

function formatMediaDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const TEXT_PREVIEW_EXTENSIONS = new Set([
  'txt',
  'md',
  'json',
  'yaml',
  'yml',
  'xml',
  'csv',
  'log',
  'ts',
  'tsx',
  'js',
  'jsx',
  'css',
  'scss',
  'html',
  'htm',
  'rs',
  'py',
  'java',
  'c',
  'h',
  'cpp',
  'hpp',
  'go',
  'sql',
  'toml',
  'ini',
  'conf',
  'sh',
  'ps1',
  'bat',
  'cmd',
]);

function NativeThumbnail({
  entry,
  scheduler,
  scrollRoot,
  size,
}: {
  entry: NativeFileMetadata;
  scheduler: NativePreviewScheduler;
  scrollRoot: RefObject<HTMLElement | null>;
  size: 20 | 64;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const Icon = iconForEntry(entry);
  const category = categorizeNativeFile(entry);
  const isPdf = category === 'pdf';
  const isVideo = category === 'video';
  const isPreviewable =
    entry.kind === 'file' && (category === 'image' || ((isPdf || isVideo) && size === 64));
  const identity = previewIdentity(entry);

  useEffect(() => {
    if (!isPreviewable || !host.current) return;
    let disposed = false;
    let activeUrl: string | null = null;
    let scheduled: ReturnType<NativePreviewScheduler['schedule']> | null = null;
    const observer = new IntersectionObserver(
      ([visible]) => {
        if (!visible?.isIntersecting || scheduled) return;
        observer.disconnect();
        scheduled = scheduler.schedule({
          path: entry.path,
          mode: 'thumbnail',
          requestedWidth: size === 64 ? 96 : 64,
          requestedHeight: size === 64 ? 96 : 64,
        });
        void scheduled.promise.then((outcome) => {
          if (disposed || outcome.status !== 'success' || !outcome.value.bytes) return;
          activeUrl = URL.createObjectURL(
            new Blob([Uint8Array.from(outcome.value.bytes)], { type: 'image/png' }),
          );
          setUrl(activeUrl);
        });
      },
      { root: scrollRoot.current, rootMargin: '240px' },
    );
    observer.observe(host.current);
    return () => {
      disposed = true;
      observer.disconnect();
      scheduled?.cancel();
      if (activeUrl) URL.revokeObjectURL(activeUrl);
    };
  }, [entry.path, identity, isPreviewable, scheduler, scrollRoot, size]);

  return (
    <span
      ref={host}
      className={`grid shrink-0 place-items-center overflow-hidden ${url && isPdf ? 'border border-white/[0.08] bg-white' : ''} ${url && isVideo ? 'bg-black/35' : ''}`}
      style={{ width: size, height: size }}
    >
      {url ? (
        // The URL is an ephemeral in-memory PNG returned by the bounded native decoder.
        <img
          src={url}
          alt=""
          className={`h-full w-full ${isPdf || isVideo ? 'object-contain' : 'object-cover'}`}
          draggable={false}
        />
      ) : (
        <Icon
          size={size === 64 ? 28 : 13}
          strokeWidth={1.1}
          className={entry.navigable ? 'text-[#4aa3ff]' : 'text-[#6f8598]'}
        />
      )}
    </span>
  );
}

function NativeInspectorPreview({
  entry,
  scheduler,
}: {
  entry: NativeFileMetadata;
  scheduler: NativePreviewScheduler;
}) {
  const [preview, setPreview] = useState<{
    url: string | null;
    text: string | null;
    dimensions: string | null;
    pageCount: number | null;
    durationMs: number | null;
    truncated: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const category = categorizeNativeFile(entry);
  const mode =
    category === 'image' || category === 'pdf' || category === 'video'
      ? 'image-preview'
      : (entry.extension && TEXT_PREVIEW_EXTENSIONS.has(entry.extension.toLowerCase())) ||
          entry.name.toLowerCase() === '.env'
        ? 'text-preview'
        : null;
  const identity = previewIdentity(entry);
  const [failure, setFailure] = useState<'encrypted' | 'unavailable' | null>(null);

  useEffect(() => {
    setPreview(null);
    setFailure(null);
    if (entry.kind !== 'file' || !mode) return;
    let disposed = false;
    let activeUrl: string | null = null;
    setLoading(true);
    const scheduled = scheduler.schedule(
      {
        path: entry.path,
        mode,
        requestedWidth: mode === 'image-preview' ? 512 : 0,
        requestedHeight: mode === 'image-preview' ? 512 : 0,
      },
      'high',
    );
    void scheduled.promise.then((outcome) => {
      if (disposed) return;
      setLoading(false);
      if (outcome.status !== 'success') {
        if (outcome.error.code !== 'OPERATION_CANCELLED') {
          setFailure(outcome.error.code === 'PDF_ENCRYPTED' ? 'encrypted' : 'unavailable');
        }
        return;
      }
      if (outcome.value.bytes) {
        activeUrl = URL.createObjectURL(
          new Blob([Uint8Array.from(outcome.value.bytes)], { type: 'image/png' }),
        );
      }
      const descriptor = outcome.value.descriptor;
      setPreview({
        url: activeUrl,
        text: descriptor.text,
        dimensions:
          descriptor.sourceWidth && descriptor.sourceHeight
            ? `${descriptor.sourceWidth} × ${descriptor.sourceHeight}`
            : null,
        pageCount: descriptor.pageCount,
        durationMs: descriptor.durationMs,
        truncated: descriptor.truncated,
      });
    });
    return () => {
      disposed = true;
      scheduled.cancel();
      if (activeUrl) URL.revokeObjectURL(activeUrl);
    };
  }, [entry.kind, entry.path, identity, mode, scheduler]);

  const Icon = iconForEntry(entry);
  if (loading) {
    return (
      <div className="grid h-40 place-items-center">
        <LoaderCircle size={17} className="animate-spin text-[#4aa3ff]" />
      </div>
    );
  }
  if (preview?.url) {
    return (
      <div>
        <div className="grid min-h-32 place-items-center overflow-hidden border border-white/[0.05] bg-black/25 p-2">
          <img
            src={preview.url}
            alt={`Preview of ${entry.name}`}
            className="max-h-48 max-w-full object-contain"
          />
        </div>
        {preview.dimensions && (
          <div className="mt-1 font-mono text-[8px] text-[#52697c]">{preview.dimensions}</div>
        )}
        {preview.pageCount !== null && (
          <div className="mt-1 font-mono text-[8px] text-[#52697c]">
            {preview.pageCount} {preview.pageCount === 1 ? 'page' : 'pages'}
          </div>
        )}
        {preview.durationMs !== null && (
          <div className="mt-1 font-mono text-[8px] text-[#52697c]">
            Video · {formatMediaDuration(preview.durationMs)}
          </div>
        )}
      </div>
    );
  }
  if (preview?.text !== null && preview?.text !== undefined) {
    return (
      <div>
        <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words border border-white/[0.05] bg-black/25 p-2 font-mono text-[8px] leading-4 text-[#91a9bc] os-scrollbar">
          {preview.text}
        </pre>
        {preview.truncated && (
          <div className="mt-1 font-mono text-[8px] text-[#52697c]">First 512 KB shown</div>
        )}
      </div>
    );
  }
  return (
    <div className="grid h-28 place-items-center border border-white/[0.05] bg-white/[0.015]">
      <div className="text-center">
        <Icon size={26} strokeWidth={1} className="mx-auto text-[#4aa3ff]" />
        <div className="mt-2 font-mono text-[8px] text-[#52697c]">
          {failure === 'encrypted' ? 'Password-protected PDF' : 'Preview unavailable'}
        </div>
      </div>
    </div>
  );
}

function DriveCard({
  root,
  onOpen,
  onContextMenu,
}: {
  root: NativeFileRoot;
  onOpen: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const used =
    root.totalBytes !== null && root.freeBytes !== null ? root.totalBytes - root.freeBytes : null;
  const percent =
    used !== null && root.totalBytes ? Math.round((used / root.totalBytes) * 100) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
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
  const previewScheduler = useMemo(() => createNativePreviewScheduler(filesystem), [filesystem]);
  const nativeScrollRoot = useRef<HTMLElement>(null);
  const contextMenu = useContextMenu();
  const requestGate = useRef(createLatestRequestGate());
  const statGate = useRef(createLatestRequestGate());
  const searchGate = useRef(createLatestRequestGate());
  const activeSearchId = useRef<string | null>(null);
  const mounted = useRef(true);
  const locationRef = useRef<FilesLocation>({ kind: 'roots' });
  const jobClipboard = useRef<FilesClipboard | null>(null);
  const jobNativeClipboard = useRef<NativeFileClipboardSnapshot | null>(null);
  const ownedNativeClipboardSequence = useRef<number | null>(null);
  const transferHistoryMode = useRef<'record' | 'undo' | null>(null);
  const selectedPathsRef = useRef<ReadonlySet<string>>(new Set());
  const filesRoot = useRef<HTMLDivElement>(null);
  const pendingNativeDrag = useRef<PendingNativeDrag | null>(null);
  const suppressNativeClick = useRef<string | null>(null);
  const [source, setSource] = useState<'nammu' | 'computer'>('nammu');
  const [mockLocation, setMockLocation] = useState<(typeof MOCK_LOCATIONS)[number]>('Home');
  const [query, setQuery] = useState('');
  const [searchScope, setSearchScope] = useState<NativeFileSearchScope>('current-tree');
  const [searchFilter, setSearchFilter] = useState<NativeSearchFilter>('all');
  const [searchRevision, setSearchRevision] = useState(0);
  const [searchSnapshot, setSearchSnapshot] = useState<NativeFileSearchSnapshot | null>(null);
  const [searchResults, setSearchResults] = useState<readonly NativeFileMetadata[]>([]);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [mockSelected, setMockSelected] = useState<number | null>(4);
  const [nativeSelected, setNativeSelected] = useState<NativeFileMetadata | null>(null);
  const [nativeSelectedPaths, setNativeSelectedPaths] = useState<ReadonlySet<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [fileClipboard, setFileClipboard] = useState<FilesClipboard | null>(null);
  const [nativeFileClipboard, setNativeFileClipboard] =
    useState<NativeFileClipboardSnapshot | null>(null);
  const [namingDialog, setNamingDialog] = useState<NamingDialog | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [activeOperation, setActiveOperation] = useState<NativeFileOperationSnapshot | null>(null);
  const [openArchive, setOpenArchive] = useState<NativeArchiveSummary | null>(null);
  const [activeArchiveOperation, setActiveArchiveOperation] =
    useState<NativeArchiveOperationSnapshot | null>(null);
  const [activeDeletion, setActiveDeletion] = useState<NativeDeletionOperationSnapshot | null>(
    null,
  );
  const [permanentDeleteDialog, setPermanentDeleteDialog] = useState<PermanentDeleteDialog | null>(
    null,
  );
  const [propertiesPaths, setPropertiesPaths] = useState<readonly string[] | null>(null);
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
  const [nativeDropFeedback, setNativeDropFeedback] = useState<NativeDropFeedback | null>(null);

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
  const currentLocation = currentFilesLocation(navigation);
  const searchMode =
    source === 'computer' && currentLocation.kind === 'directory' && query.trim().length > 0;
  const nativeEntries = useMemo(
    () => (searchMode ? searchResults : (listing?.entries ?? [])),
    [listing?.entries, searchMode, searchResults],
  );
  const nativeVisible = useMemo(
    () => visibleNativeEntries(nativeEntries, renderLimit),
    [nativeEntries, renderLimit],
  );
  const hiddenCount = useMemo(
    () => nativeEntries.filter((entry) => entry.hidden || entry.system).length,
    [nativeEntries],
  );
  locationRef.current = currentLocation;
  selectedPathsRef.current = nativeSelectedPaths;
  const selectedNativeEntries = useMemo(
    () => nativeEntries.filter((entry) => nativeSelectedPaths.has(entry.path)),
    [nativeEntries, nativeSelectedPaths],
  );
  const pasteAvailable = filesystem.fileClipboardSupported
    ? Boolean(nativeFileClipboard?.available && nativeFileClipboard.paths.length > 0)
    : Boolean(fileClipboard);

  const refreshNativeFileClipboard = useCallback(async () => {
    if (!filesystem.fileClipboardSupported) return;
    const result = await filesystem.readFileClipboard();
    if (!mounted.current) return;
    if (result.status === 'success') {
      if (
        ownedNativeClipboardSequence.current !== null &&
        result.value.sequence !== ownedNativeClipboardSequence.current
      ) {
        ownedNativeClipboardSequence.current = null;
        setFileClipboard(null);
      }
      setNativeFileClipboard(result.value);
      return;
    }
    if (result.status === 'error' && result.error.code !== 'CLIPBOARD_BUSY') {
      setNativeFileClipboard(null);
    }
  }, [filesystem]);

  const loadLocation = useCallback(
    async (
      location: FilesLocation,
      selectionPaths: readonly string[] = [],
      options: LoadLocationOptions = {},
    ) => {
      const requestId = requestGate.current.begin();
      statGate.current.invalidate();
      const startedAt = typeof performance === 'undefined' ? 0 : performance.now();
      if (!options.background) {
        setLoading(true);
        setError(null);
        setNativeSelected(null);
        setNativeSelectedPaths(new Set());
        setSelectionAnchor(null);
        setRenderLimit(INITIAL_RENDER_LIMIT);
      }
      if (location.kind === 'roots') {
        const result = await filesystem.listRoots();
        if (!requestGate.current.isCurrent(requestId)) return;
        if (!options.background) setLoading(false);
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
      if (!options.background) setLoading(false);
      if (result.status === 'success') {
        setError(null);
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
      const nextError =
        result.status === 'error'
          ? result.error
          : { code: 'IO_ERROR' as const, message: result.reason };
      if (
        options.background &&
        ['NOT_FOUND', 'NOT_DIRECTORY', 'DRIVE_UNAVAILABLE'].includes(nextError.code)
      ) {
        setListing(null);
        setNativeSelected(null);
        setNativeSelectedPaths(new Set());
        setSelectionAnchor(null);
      }
      setError(nextError);
    },
    [filesystem],
  );

  const refreshCoordinator = useMemo(
    () =>
      createDirectoryRefreshCoordinator(
        (path) => {
          const location = locationRef.current;
          if (location.kind !== 'directory' || location.path !== path) return;
          void loadLocation(location, [...selectedPathsRef.current], { background: true });
        },
        (callback, delayMs) => window.setTimeout(callback, delayMs),
        (handle) => window.clearTimeout(handle as number),
      ),
    [loadLocation],
  );

  useEffect(() => {
    mounted.current = true;
    const gate = requestGate.current;
    const metadataGate = statGate.current;
    const nativeSearchGate = searchGate.current;
    return () => {
      mounted.current = false;
      gate.invalidate();
      metadataGate.invalidate();
      nativeSearchGate.invalidate();
      previewScheduler.dispose();
    };
  }, [previewScheduler]);

  useEffect(() => {
    if (!filesystem.fileClipboardSupported) return;
    const refresh = () => void refreshNativeFileClipboard();
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [filesystem.fileClipboardSupported, refreshNativeFileClipboard]);

  const watchPath =
    source === 'computer' && currentLocation.kind === 'directory' && !searchMode
      ? currentLocation.path
      : null;

  useEffect(() => {
    if (!watchPath || !filesystem.supported) return;
    const generation = refreshCoordinator.activate(watchPath);
    let disposed = false;
    let subscription: NativeDirectoryWatchSubscription | null = null;

    void filesystem
      .watchDirectory(watchPath, (event) => {
        if (disposed) return;
        if (event.kind === 'watch-error') {
          setNotice('Live updates paused for this folder. Manual refresh remains available.');
          return;
        }
        refreshCoordinator.notify(event.rootPath, generation);
      })
      .then((result) => {
        if (result.status !== 'success') return;
        if (disposed) {
          void result.value.dispose();
          return;
        }
        subscription = result.value;
        // Closes the small enumeration-to-subscription race without polling.
        refreshCoordinator.notify(result.value.path, generation);
      });

    return () => {
      disposed = true;
      refreshCoordinator.deactivate(generation);
      if (subscription) void subscription.dispose();
    };
  }, [filesystem, refreshCoordinator, watchPath]);

  useEffect(() => {
    const gate = searchGate.current;
    const generation = gate.begin();
    let disposed = false;
    let searchId: string | null = null;
    let debounceHandle: number | null = null;
    const release = async () => {
      if (!searchId) return;
      const id = searchId;
      searchId = null;
      if (activeSearchId.current === id) activeSearchId.current = null;
      await filesystem.releaseSearch(id);
    };

    if (!searchMode || currentLocation.kind !== 'directory' || !filesystem.supported) {
      setSearchSnapshot(null);
      setSearchResults([]);
      return () => {
        disposed = true;
        gate.invalidate();
      };
    }

    const parsed = buildNativeSearchQuery(currentLocation.path, query, searchScope, searchFilter);
    if (!canStartNativeSearch(parsed)) {
      setSearchSnapshot(null);
      setSearchResults([]);
      return () => {
        disposed = true;
        gate.invalidate();
      };
    }

    setSearchResults([]);
    setSearchSnapshot(null);
    setRenderLimit(INITIAL_RENDER_LIMIT);
    setNativeSelected(null);
    setNativeSelectedPaths(new Set());
    setSelectionAnchor(null);
    setActionError(null);

    debounceHandle = window.setTimeout(() => {
      void (async () => {
        const started = await filesystem.startSearch(parsed);
        if (disposed || !gate.isCurrent(generation) || started.status !== 'success') {
          if (started.status === 'success') await filesystem.releaseSearch(started.value.id);
          else if (!disposed && started.status === 'error') setActionError(started.error);
          return;
        }
        searchId = started.value.id;
        activeSearchId.current = searchId;
        setSearchSnapshot(started.value);
        let offset = 0;

        while (!disposed && gate.isCurrent(generation)) {
          const next = await filesystem.getSearch(searchId, offset);
          if (disposed || !gate.isCurrent(generation)) break;
          if (next.status !== 'success') {
            if (next.status === 'error') setActionError(next.error);
            break;
          }
          const snapshot = next.value;
          if (snapshot.id !== searchId || snapshot.resultOffset !== offset) break;
          if (snapshot.results.length > 0) {
            setSearchResults((current) => [...current, ...snapshot.results]);
            offset += snapshot.results.length;
          }
          setSearchSnapshot(snapshot);
          if (terminalSearch(snapshot) && offset >= snapshot.retainedResults) break;
          await new Promise((resolve) => window.setTimeout(resolve, 80));
        }
        await release();
      })();
    }, 320);

    return () => {
      disposed = true;
      gate.invalidate();
      if (debounceHandle !== null) window.clearTimeout(debounceHandle);
      const id = searchId;
      searchId = null;
      if (id) {
        if (activeSearchId.current === id) activeSearchId.current = null;
        void filesystem.releaseSearch(id);
      }
    };
  }, [currentLocation, filesystem, query, searchFilter, searchMode, searchRevision, searchScope]);

  const openLocation = useCallback(
    (location: FilesLocation, push = true, selectionPaths: readonly string[] = []) => {
      setOpenArchive(null);
      setSource('computer');
      if (push) setNavigation((current) => pushFilesLocation(current, location));
      void loadLocation(location, selectionPaths);
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
    if (source === 'computer' && filesystem.supported) {
      if (searchMode) setSearchRevision((revision) => revision + 1);
      else void loadLocation(currentLocation, [...nativeSelectedPaths]);
    } else setQuery('');
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
        : (nativeEntries.find((item) => next.selected.has(item.path)) ?? null);
      setNativeSelected(primary);
      if (!primary) return;
      const requestId = statGate.current.begin();
      void filesystem.stat(primary.path).then((result) => {
        if (statGate.current.isCurrent(requestId) && result.status === 'success') {
          setNativeSelected(result.value);
        }
      });
    },
    [filesystem, nativeEntries, nativeSelectedPaths, nativeVisible, selectionAnchor],
  );

  const openNativeEntry = async (entry: NativeFileMetadata) => {
    selectNativeEntry(entry);
    if (entry.navigable) {
      if (searchMode) setQuery('');
      openLocation({ kind: 'directory', path: entry.path });
      return;
    }
    if (entry.kind === 'file' && entry.extension?.toLowerCase() === 'zip') {
      setActionError(null);
      const result = await filesystem.openArchive(entry.path);
      if (result.status === 'success') {
        setNativeSelected(null);
        setNativeSelectedPaths(new Set());
        setSelectionAnchor(null);
        setOpenArchive(result.value);
        return;
      }
      setActionError(
        result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
      );
    }
  };

  const openFileLocation = (entry: NativeFileMetadata) => {
    const parent = parentPath(entry.path);
    if (!parent) return;
    setQuery('');
    openLocation({ kind: 'directory', path: parent }, true, [entry.path]);
  };

  const selectedPaths = useCallback(
    (fallback?: NativeFileMetadata) => {
      if (fallback && !nativeSelectedPaths.has(fallback.path)) return [fallback.path];
      return selectedNativeEntries.map((entry) => entry.path);
    },
    [nativeSelectedPaths, selectedNativeEntries],
  );

  const armNativeDrag = useCallback(
    (event: ReactPointerEvent, entry: NativeFileMetadata) => {
      if (
        !filesystem.fileDragDropSupported ||
        event.button !== 0 ||
        event.pointerType !== 'mouse' ||
        source !== 'computer' ||
        openArchive
      ) {
        return;
      }
      const paths = selectedPaths(entry);
      if (paths.length === 0) return;
      const operation: NativeFileDragOperation =
        event.ctrlKey && !event.shiftKey
          ? 'copy'
          : event.shiftKey && !event.ctrlKey
            ? 'move'
            : 'auto';
      pendingNativeDrag.current = {
        path: entry.path,
        paths,
        x: event.clientX,
        y: event.clientY,
        operation,
      };
    },
    [filesystem.fileDragDropSupported, openArchive, selectedPaths, source],
  );

  useEffect(() => {
    if (!filesystem.fileDragDropSupported) return;
    const move = (event: PointerEvent) => {
      const pending = pendingNativeDrag.current;
      if (!pending) return;
      if (event.buttons & 1) {
        const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
        if (distance < 6) return;
        pendingNativeDrag.current = null;
        suppressNativeClick.current = pending.path;
        void filesystem.startFileDrag(pending.operation, pending.paths).then((result) => {
          if (result.status === 'error') setActionError(result.error);
          else if (result.status === 'unsupported') {
            setNotice('Native drag and drop is unavailable in this runtime.');
          }
          window.setTimeout(() => {
            if (suppressNativeClick.current === pending.path) suppressNativeClick.current = null;
          }, 250);
        });
        return;
      }
      pendingNativeDrag.current = null;
    };
    const release = () => {
      pendingNativeDrag.current = null;
    };
    window.addEventListener('pointermove', move, { capture: true });
    window.addEventListener('pointerup', release, { capture: true });
    window.addEventListener('pointercancel', release, { capture: true });
    return () => {
      window.removeEventListener('pointermove', move, { capture: true });
      window.removeEventListener('pointerup', release, { capture: true });
      window.removeEventListener('pointercancel', release, { capture: true });
    };
  }, [filesystem]);

  const openProperties = useCallback(
    (fallback?: NativeFileMetadata) => {
      const paths = selectedPaths(fallback);
      if (paths.length > 0) setPropertiesPaths(paths);
    },
    [selectedPaths],
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
      const nativeClipboard = jobNativeClipboard.current;
      if (
        nativeClipboard?.operation &&
        operation.state === 'completed' &&
        operation.failures.length === 0 &&
        operation.successes.length === nativeClipboard.paths.length
      ) {
        void filesystem
          .completeFileClipboard(nativeClipboard.sequence, nativeClipboard.operation)
          .then(() => {
            ownedNativeClipboardSequence.current = null;
            setFileClipboard(null);
            return refreshNativeFileClipboard();
          });
      }
      jobClipboard.current = null;
      jobNativeClipboard.current = null;
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
      if (searchMode) {
        setSearchRevision((revision) => revision + 1);
        return;
      }
      const location = locationRef.current;
      if (location.kind === 'directory') {
        void loadLocation(
          location,
          operation.successes.map((success) => success.destinationPath),
        );
      }
    },
    [filesystem, loadLocation, refreshNativeFileClipboard, searchMode],
  );

  const monitorOperation = useCallback(
    async (
      started: NativeFileOperationSnapshot,
      clipboard: FilesClipboard | null = null,
      nativeClipboard: NativeFileClipboardSnapshot | null = null,
    ) => {
      jobClipboard.current = clipboard;
      jobNativeClipboard.current = nativeClipboard;
      setActiveOperation(started);
      let snapshot = started;
      while (!terminalOperation(snapshot) && mounted.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        const result = await filesystem.getOperation(started.id);
        if (!mounted.current) return;
        if (result.status !== 'success') {
          jobClipboard.current = null;
          jobNativeClipboard.current = null;
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
      nativeClipboard: NativeFileClipboardSnapshot | null = null,
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
        void monitorOperation(result.value, clipboard, nativeClipboard);
      } else {
        transferHistoryMode.current = null;
        jobNativeClipboard.current = null;
        setActionError(
          result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
        );
      }
    },
    [activeDeletion, activeOperation, filesystem, monitorOperation],
  );

  const nativeDropTargetAt = useCallback(
    (event: NativeFileDragEvent): NativeDropFeedback | null => {
      if (
        source !== 'computer' ||
        openArchive ||
        searchMode ||
        currentLocation.kind !== 'directory' ||
        event.paths.length === 0
      ) {
        return null;
      }
      const scale = window.devicePixelRatio || 1;
      const element = document.elementFromPoint(
        event.x / scale,
        event.y / scale,
      ) as HTMLElement | null;
      if (!element || !filesRoot.current?.contains(element)) return null;
      const folder = element.closest<HTMLElement>('[data-native-file-drop-target]');
      const area = element.closest<HTMLElement>('[data-native-file-drop-root]');
      const path = folder?.dataset.nativeFileDropTarget ?? area?.dataset.nativeFileDropRoot;
      if (
        !path ||
        event.paths.some((sourcePath) => sourcePath.toLowerCase() === path.toLowerCase())
      ) {
        return null;
      }
      return {
        session: event.session,
        path,
        label: folder?.dataset.nativeFileDropLabel ?? leafName(path),
        operation: resolveNativeDropOperation(event.paths, path, event.modifiers),
      };
    },
    [currentLocation, openArchive, searchMode, source],
  );

  const nativeDropTargetAtRef = useRef(nativeDropTargetAt);
  const startNativeDropTransferRef = useRef(startTransfer);
  const nativeDropEffectRef = useRef<{
    session: number;
    path: string | null;
    operation: NativeFileClipboardOperation | null;
  } | null>(null);
  useEffect(() => {
    nativeDropTargetAtRef.current = nativeDropTargetAt;
    startNativeDropTransferRef.current = startTransfer;
  }, [nativeDropTargetAt, startTransfer]);

  useEffect(() => {
    if (!filesystem.fileDragDropSupported) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void filesystem
      .subscribeFileDrops((event) => {
        if (disposed) return;
        if (event.phase === 'leave') {
          setNativeDropFeedback(null);
          if (
            nativeDropEffectRef.current?.session !== event.session ||
            nativeDropEffectRef.current.operation !== null
          ) {
            nativeDropEffectRef.current = { session: event.session, path: null, operation: null };
            void filesystem.setFileDropEffect(event.session, null);
          }
          return;
        }
        const target = nativeDropTargetAtRef.current(event);
        setNativeDropFeedback(target);
        const operation = target?.operation ?? null;
        const path = target?.path ?? null;
        if (
          nativeDropEffectRef.current?.session !== event.session ||
          nativeDropEffectRef.current.path !== path ||
          nativeDropEffectRef.current.operation !== operation
        ) {
          nativeDropEffectRef.current = { session: event.session, path, operation };
          void filesystem.setFileDropEffect(event.session, operation);
        }
        if (event.phase !== 'drop') return;
        nativeDropEffectRef.current = null;
        setNativeDropFeedback(null);
        if (!target) {
          setNotice('This location cannot accept native file drops.');
          return;
        }
        void startNativeDropTransferRef.current(target.operation, event.paths, target.path);
      })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      });
    return () => {
      disposed = true;
      unlisten?.();
      nativeDropEffectRef.current = null;
      setNativeDropFeedback(null);
    };
  }, [filesystem]);

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
    async (operation: 'copy' | 'cut', fallback?: NativeFileMetadata) => {
      if (openArchive) return;
      const next = createFilesClipboard(operation, selectedPaths(fallback));
      if (!next) return;
      if (filesystem.fileClipboardSupported) {
        const result = await filesystem.writeFileClipboard(
          operation === 'cut' ? 'move' : 'copy',
          next.sources,
        );
        if (result.status !== 'success') {
          setActionError(
            result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
          );
          return;
        }
        setNativeFileClipboard(result.value);
        ownedNativeClipboardSequence.current = result.value.sequence;
      }
      setFileClipboard(next);
      setNotice(
        `${next.sources.length} item${next.sources.length === 1 ? '' : 's'} ready to ${operation}.`,
      );
    },
    [filesystem, openArchive, selectedPaths],
  );

  const paste = useCallback(async () => {
    if (openArchive || searchMode || currentLocation.kind !== 'directory') return;
    if (filesystem.fileClipboardSupported) {
      const result = await filesystem.readFileClipboard();
      if (result.status !== 'success') {
        setActionError(
          result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
        );
        return;
      }
      if (
        ownedNativeClipboardSequence.current !== null &&
        result.value.sequence !== ownedNativeClipboardSequence.current
      ) {
        ownedNativeClipboardSequence.current = null;
        setFileClipboard(null);
      }
      setNativeFileClipboard(result.value);
      if (!result.value.available || !result.value.operation || result.value.paths.length === 0) {
        setNotice('The Windows clipboard does not contain files or folders.');
        return;
      }
      void startTransfer(
        result.value.operation,
        result.value.paths,
        currentLocation.path,
        false,
        null,
        result.value.operation === 'move' ? 'record' : null,
        result.value,
      );
      return;
    }
    if (!fileClipboard) return;
    void startTransfer(
      fileClipboard.operation === 'cut' ? 'move' : 'copy',
      fileClipboard.sources,
      currentLocation.path,
      false,
      fileClipboard,
    );
  }, [currentLocation, fileClipboard, filesystem, openArchive, searchMode, startTransfer]);

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

  const monitorArchiveOperation = useCallback(
    async (started: NativeArchiveOperationSnapshot) => {
      setActiveArchiveOperation(started);
      let snapshot = started;
      while (!terminalArchiveOperation(snapshot) && mounted.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        const result = await filesystem.getArchiveOperation(started.id);
        if (!mounted.current) return;
        if (result.status !== 'success') {
          setActionError(
            result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
          );
          return;
        }
        snapshot = result.value;
        setActiveArchiveOperation(snapshot);
      }
      if (!mounted.current) return;
      if (snapshot.state === 'completed') {
        setNotice(
          `${snapshot.operation === 'create-zip' ? 'ZIP created' : 'Extraction complete'} · ${snapshot.filesCompleted} files${snapshot.skippedEntries ? ` · ${snapshot.skippedEntries} skipped` : ''}`,
        );
      } else if (snapshot.state === 'cancelled') {
        setNotice(
          `Archive operation cancelled · ${snapshot.filesCompleted} completed files were preserved.`,
        );
      } else if (snapshot.error) {
        setActionError(snapshot.error);
      }
      const location = locationRef.current;
      if (location.kind === 'directory') void loadLocation(location);
    },
    [filesystem, loadLocation],
  );

  const startArchiveFromNative = useCallback(
    async (entry: NativeFileMetadata, chooseDestination: boolean) => {
      const parent = parentPath(entry.path);
      if (!parent) return;
      setActionError(null);
      const opened = await filesystem.openArchive(entry.path);
      if (opened.status !== 'success') {
        setActionError(
          opened.status === 'error' ? opened.error : { code: 'IO_ERROR', message: opened.reason },
        );
        return;
      }
      const destination = chooseDestination
        ? await filesystem.pickArchiveDestination(parent)
        : { status: 'success' as const, value: parent };
      if (destination.status !== 'success' || !destination.value) {
        await filesystem.releaseArchive(opened.value.id);
        if (destination.status === 'error') setActionError(destination.error);
        return;
      }
      const started = await filesystem.extractArchive({
        archiveId: opened.value.id,
        destinationPath: destination.value,
        conflictStrategy: 'keep-both',
      });
      if (started.status === 'success') void monitorArchiveOperation(started.value);
      else
        setActionError(
          started.status === 'error'
            ? started.error
            : { code: 'IO_ERROR', message: started.reason },
        );
      // Extraction owns its ZIP handle; the session metadata can be released after job creation.
      // The native job retains the validated immutable session snapshot.
      await filesystem.releaseArchive(opened.value.id);
    },
    [filesystem, monitorArchiveOperation],
  );

  const compressSelection = useCallback(
    async (fallback?: NativeFileMetadata) => {
      const sources = selectedPaths(fallback);
      if (sources.length === 0) return;
      const single =
        fallback && !nativeSelectedPaths.has(fallback.path)
          ? fallback
          : selectedNativeEntries.length === 1
            ? selectedNativeEntries[0]
            : null;
      const defaultName = single ? `${single.name.replace(/\.[^.]+$/, '')}.zip` : 'Archive.zip';
      const destination = await filesystem.pickZipDestination(defaultName);
      if (destination.status !== 'success' || !destination.value) {
        if (destination.status === 'error') setActionError(destination.error);
        return;
      }
      const started = await filesystem.createZip({
        sources,
        destinationPath: destination.value,
        conflictStrategy: 'keep-both',
      });
      if (started.status === 'success') void monitorArchiveOperation(started.value);
      else
        setActionError(
          started.status === 'error'
            ? started.error
            : { code: 'IO_ERROR', message: started.reason },
        );
    },
    [
      filesystem,
      monitorArchiveOperation,
      nativeSelectedPaths,
      selectedNativeEntries,
      selectedPaths,
    ],
  );

  const cancelArchiveOperation = useCallback(() => {
    if (activeArchiveOperation && !terminalArchiveOperation(activeArchiveOperation)) {
      void filesystem.cancelArchiveOperation(activeArchiveOperation.id).then((result) => {
        if (result.status === 'error') setActionError(result.error);
      });
    }
  }, [activeArchiveOperation, filesystem]);

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
        if (searchMode) setSearchRevision((revision) => revision + 1);
        else void loadLocation(location, selection);
      }
    },
    [loadLocation, searchMode],
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
    ...(entry.kind === 'file' && entry.extension?.toLowerCase() === 'zip'
      ? [
          {
            id: 'native-archive-open',
            label: 'Open archive',
            icon: FileArchive,
            action: () => void openNativeEntry(entry),
          } satisfies ContextMenuEntry,
          {
            id: 'native-archive-extract-here',
            label: 'Extract here',
            icon: FileArchive,
            action: () => void startArchiveFromNative(entry, false),
          } satisfies ContextMenuEntry,
          {
            id: 'native-archive-extract-to',
            label: 'Extract to…',
            icon: Folder,
            action: () => void startArchiveFromNative(entry, true),
          } satisfies ContextMenuEntry,
          { id: 'native-archive-separator', type: 'separator' as const },
        ]
      : []),
    ...(searchMode
      ? [
          {
            id: 'native-file-open-location',
            label: 'Open file location',
            icon: Folder,
            action: () => openFileLocation(entry),
          } satisfies ContextMenuEntry,
          { id: 'native-file-search-separator', type: 'separator' as const },
        ]
      : []),
    {
      id: 'native-file-cut',
      label: 'Cut',
      icon: Scissors,
      action: () => void copySelection('cut', entry),
    },
    {
      id: 'native-file-copy',
      label: 'Copy',
      icon: Copy,
      action: () => void copySelection('copy', entry),
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
    {
      id: 'native-file-compress',
      label: 'Compress to ZIP',
      icon: FileArchive,
      action: () => void compressSelection(entry),
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
      shortcut: 'Alt+Enter',
      action: () => openProperties(entry),
    },
  ];

  const explorerMenu: ContextMenuEntry[] = [
    {
      id: 'files-header',
      type: 'header',
      label:
        source === 'computer'
          ? searchMode
            ? `Search · ${query.trim()}`
            : 'This PC · Native'
          : `${mockLocation} · Nammu`,
    },
    { id: 'files-refresh', label: 'Refresh', icon: RefreshCw, action: refresh },
    ...(source === 'computer' && currentLocation.kind === 'directory' && !searchMode && !openArchive
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
            disabled: !pasteAvailable,
            action: () => void paste(),
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

  const nativeEntriesTotal = nativeEntries.length - hiddenCount;
  const nativeContentReady =
    source === 'computer' && !loading && !error && (searchMode || Boolean(listing));
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
    if (source !== 'computer' || currentLocation.kind !== 'directory' || openArchive) return;
    const key = event.key.toLowerCase();
    if (event.altKey && event.key === 'Enter') {
      event.preventDefault();
      openProperties();
    } else if (event.ctrlKey && event.shiftKey && key === 'n') {
      event.preventDefault();
      showNamingDialog({ kind: 'folder', value: 'New folder', target: null });
    } else if (event.ctrlKey && key === 'c') {
      event.preventDefault();
      void copySelection('copy');
    } else if (event.ctrlKey && key === 'x') {
      event.preventDefault();
      void copySelection('cut');
    } else if (event.ctrlKey && key === 'v' && !searchMode) {
      event.preventDefault();
      void paste();
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
      ref={filesRoot}
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
                {searchMode ? (
                  <span className="flex min-w-0 items-center">
                    <ChevronRight size={10} className="shrink-0" />
                    <span className="truncate text-[#9ab3c7]">Search: “{query.trim()}”</span>
                  </span>
                ) : (
                  listing?.breadcrumbs.map((part) => (
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
                  ))
                )}
              </>
            )}
          </div>
          {(source === 'nammu' || (currentLocation.kind === 'directory' && !openArchive)) && (
            <div className="ml-1 flex w-48 items-center gap-1.5 border border-white/[0.06] bg-black/20 px-2 py-1.5">
              <Search size={10} className="text-[#4aa3ff]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  const id = activeSearchId.current;
                  if (id) void filesystem.cancelSearch(id);
                  setQuery('');
                }}
                placeholder={source === 'nammu' ? 'Filter resources' : 'Search files'}
                aria-label={source === 'nammu' ? 'Filter resources' : 'Search native files'}
                className="min-w-0 flex-1 bg-transparent text-[9px] text-[#c9d8e4] outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-[#60798e] hover:text-[#cfe6ff]"
                  aria-label="Clear search"
                >
                  <X size={10} />
                </button>
              )}
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

        {source === 'computer' && currentLocation.kind === 'directory' && searchMode && (
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.05] px-2">
            <select
              value={searchScope}
              onChange={(event) => setSearchScope(event.target.value as NativeFileSearchScope)}
              className="border border-white/[0.07] bg-[#07101a] px-2 py-1 font-mono text-[8px] text-[#91a9bc] outline-none"
              aria-label="Search scope"
            >
              <option value="current-folder">Current folder</option>
              <option value="current-tree">Folder + subfolders</option>
              <option value="selected-drive">Selected drive</option>
            </select>
            <select
              value={searchFilter}
              onChange={(event) => setSearchFilter(event.target.value as NativeSearchFilter)}
              className="border border-white/[0.07] bg-[#07101a] px-2 py-1 font-mono text-[8px] text-[#91a9bc] outline-none"
              aria-label="Search file type"
            >
              <option value="all">All items</option>
              <option value="files">Files</option>
              <option value="folders">Folders</option>
              <option value="documents">Documents</option>
              <option value="images">Images</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="pdf">PDF</option>
              <option value="archives">Archives</option>
              <option value="code">Code</option>
              <option value="applications">Applications</option>
            </select>
            <span className="min-w-0 flex-1 truncate font-mono text-[8px] text-[#587287]">
              {searchSnapshot
                ? `${searchSnapshot.state} · ${searchSnapshot.matchedEntries} matches · ${searchSnapshot.scannedEntries} scanned${searchSnapshot.inaccessibleEntries ? ` · ${searchSnapshot.inaccessibleEntries} skipped` : ''}`
                : 'Preparing search…'}
            </span>
            {searchSnapshot && !terminalSearch(searchSnapshot) && (
              <button
                type="button"
                onClick={() => {
                  const id = activeSearchId.current;
                  if (id) void filesystem.cancelSearch(id);
                  setQuery('');
                }}
                className="border border-white/[0.07] px-2 py-1 font-mono text-[8px] text-[#8ba2b5] hover:text-white"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => setQuery('')}
              className="px-2 py-1 font-mono text-[8px] text-[#6f879a] hover:text-white"
            >
              Clear
            </button>
          </div>
        )}

        {source === 'computer' &&
          currentLocation.kind === 'directory' &&
          !searchMode &&
          !openArchive && (
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
                onClick={() => void copySelection('cut')}
                disabled={selectedNativeEntries.length === 0}
                className="p-1.5 text-[#71889d] hover:bg-white/[0.035] hover:text-[#d4e5f2] disabled:opacity-25"
                aria-label="Cut selected items"
                title="Cut (Ctrl+X)"
              >
                <Scissors size={11} />
              </button>
              <button
                type="button"
                onClick={() => void copySelection('copy')}
                disabled={selectedNativeEntries.length === 0}
                className="p-1.5 text-[#71889d] hover:bg-white/[0.035] hover:text-[#d4e5f2] disabled:opacity-25"
                aria-label="Copy selected items"
                title="Copy (Ctrl+C)"
              >
                <Copy size={11} />
              </button>
              <button
                type="button"
                onClick={() => void paste()}
                disabled={!pasteAvailable}
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
              <button
                type="button"
                onClick={() => void compressSelection()}
                disabled={selectedNativeEntries.length === 0}
                className="p-1.5 text-[#71889d] hover:bg-white/[0.035] hover:text-[#d4e5f2] disabled:opacity-25"
                aria-label="Compress selected items to ZIP"
                title="Compress to ZIP"
              >
                <FileArchive size={11} />
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
          <main
            ref={nativeScrollRoot}
            data-native-file-drop-root={
              source === 'computer' &&
              currentLocation.kind === 'directory' &&
              !searchMode &&
              !openArchive
                ? currentLocation.path
                : undefined
            }
            className="relative min-w-0 flex-1 overflow-auto p-1.5 os-scrollbar"
          >
            {openArchive && (
              <div className="absolute inset-0 z-20">
                <ArchiveBrowser
                  filesystem={filesystem}
                  summary={openArchive}
                  onClose={() => setOpenArchive(null)}
                  onOperation={(operation) => void monitorArchiveOperation(operation)}
                  onError={setActionError}
                />
              </div>
            )}
            {nativeDropFeedback && (
              <div className="pointer-events-none sticky top-2 z-30 ml-auto mr-2 w-fit border border-[#4aa3ff]/35 bg-[#07111b]/95 px-3 py-2 font-mono text-[9px] text-[#b9d9f5] shadow-xl backdrop-blur-xl">
                {nativeDropFeedback.operation === 'move' ? 'Move' : 'Copy'} to{' '}
                <span className="text-[#4aa3ff]">{nativeDropFeedback.label}</span>
              </div>
            )}
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
                    onContextMenu={(event) =>
                      contextMenu.openAtEvent(
                        event,
                        [
                          { id: 'drive-header', type: 'header', label: root.label || root.name },
                          {
                            id: 'drive-open',
                            label: 'Open drive',
                            icon: HardDrive,
                            action: () => openLocation({ kind: 'directory', path: root.path }),
                          },
                          {
                            id: 'drive-properties',
                            label: 'Properties',
                            icon: Info,
                            action: () => setPropertiesPaths([root.path]),
                          },
                        ],
                        { ariaLabel: `${root.name} menu` },
                      )
                    }
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
            {view === 'list' && (source === 'nammu' || nativeContentReady) && (
              <div
                className={`grid border-b border-white/[0.05] px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[#43586b] ${searchMode ? 'grid-cols-[22px_minmax(120px,1fr)_minmax(140px,1fr)_86px_82px_78px]' : 'grid-cols-[22px_minmax(120px,1fr)_100px_92px_78px]'}`}
              >
                <span />
                <span>Name</span>
                {searchMode && <span>Location</span>}
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
            {nativeContentReady && (
              <div
                className={
                  view === 'grid'
                    ? 'grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-1.5 p-1'
                    : ''
                }
              >
                {nativeVisible.map((entry) => {
                  const selected = nativeSelectedPaths.has(entry.path);
                  const common = {
                    onPointerDown: (event: ReactPointerEvent) => armNativeDrag(event, entry),
                    onClick: (event: ReactMouseEvent) => {
                      if (suppressNativeClick.current === entry.path) {
                        suppressNativeClick.current = null;
                        event.preventDefault();
                        return;
                      }
                      selectNativeEntry(entry, {
                        toggle: event.ctrlKey || event.metaKey,
                        range: event.shiftKey,
                      });
                    },
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
                      data-native-file-drag-source={entry.path}
                      data-native-file-drop-target={
                        entry.kind === 'directory' && !entry.readOnly ? entry.path : undefined
                      }
                      data-native-file-drop-label={entry.name}
                      className={`flex min-h-24 flex-col items-center justify-center gap-2 border p-2 ${nativeDropFeedback?.path === entry.path ? 'border-[#4aa3ff]/70 bg-[#4aa3ff]/15' : selected ? 'border-[#4aa3ff]/35 bg-[#4aa3ff]/8' : 'border-white/[0.04] hover:bg-white/[0.025]'}`}
                    >
                      <NativeThumbnail
                        key={previewIdentity(entry)}
                        entry={entry}
                        scheduler={previewScheduler}
                        scrollRoot={nativeScrollRoot}
                        size={64}
                      />
                      <span className="max-w-full truncate text-[10px] text-[#c6d4df]">
                        {entry.name}
                      </span>
                      {searchMode && (
                        <span className="max-w-full truncate font-mono text-[7px] text-[#496276]">
                          {parentPath(entry.path)}
                        </span>
                      )}
                      <span className="font-mono text-[7px] uppercase text-[#52697c]">
                        {fileType(entry)}
                      </span>
                    </button>
                  ) : (
                    <button
                      key={entry.path}
                      type="button"
                      {...common}
                      data-native-file-drag-source={entry.path}
                      data-native-file-drop-target={
                        entry.kind === 'directory' && !entry.readOnly ? entry.path : undefined
                      }
                      data-native-file-drop-label={entry.name}
                      className={`grid w-full items-center px-2 py-1.5 text-left ${searchMode ? 'grid-cols-[22px_minmax(120px,1fr)_minmax(140px,1fr)_86px_82px_78px]' : 'grid-cols-[22px_minmax(120px,1fr)_100px_92px_78px]'} ${nativeDropFeedback?.path === entry.path ? 'bg-[#4aa3ff]/15 ring-1 ring-inset ring-[#4aa3ff]/55' : selected ? 'bg-[#4aa3ff]/8' : 'hover:bg-white/[0.025]'}`}
                    >
                      <NativeThumbnail
                        key={previewIdentity(entry)}
                        entry={entry}
                        scheduler={previewScheduler}
                        scrollRoot={nativeScrollRoot}
                        size={20}
                      />
                      <span className="truncate text-[#c9d7e2]">{entry.name}</span>
                      {searchMode && (
                        <span className="truncate pr-2 font-mono text-[8px] text-[#496276]">
                          {parentPath(entry.path)}
                        </span>
                      )}
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
            {nativeContentReady && nativeEntriesTotal === 0 && (
              <div className="grid h-40 place-items-center font-mono text-[9px] text-[#52697c]">
                {searchMode
                  ? searchSnapshot && terminalSearch(searchSnapshot)
                    ? 'No files matched this search'
                    : 'Searching…'
                  : 'This folder is empty'}
              </div>
            )}
            {nativeContentReady && nativeVisible.length < nativeEntriesTotal && (
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

          <aside className="hidden w-64 shrink-0 overflow-auto border-l border-white/[0.06] p-3 md:block os-scrollbar">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#43586b]">
              Properties
            </div>
            {source === 'computer' && selectedNativeEntries.length > 1 ? (
              <div className="mt-5">
                <div className="grid h-28 place-items-center border border-white/[0.05] bg-white/[0.015]">
                  <div className="text-center">
                    <Copy size={24} strokeWidth={1} className="mx-auto text-[#4aa3ff]" />
                    <div className="mt-2 font-mono text-[8px] text-[#61798d]">
                      {selectedNativeEntries.length} items selected
                    </div>
                  </div>
                </div>
                <div className="mt-3 font-mono text-[8px] leading-5 text-[#536a7d]">
                  {formatBytes(
                    selectedNativeEntries.reduce((total, item) => total + (item.sizeBytes ?? 0), 0),
                  )}{' '}
                  total
                </div>
              </div>
            ) : activeName ? (
              <div className="mt-5">
                {source === 'computer' && nativeSelected ? (
                  <NativeInspectorPreview
                    key={previewIdentity(nativeSelected)}
                    entry={nativeSelected}
                    scheduler={previewScheduler}
                  />
                ) : (
                  <div className="grid h-16 place-items-center border border-white/[0.05] bg-white/[0.015]">
                    <File size={22} strokeWidth={1} className="text-[#4aa3ff]" />
                  </div>
                )}
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
              : searchMode
                ? `${nativeEntriesTotal} shown · ${searchSnapshot?.matchedEntries ?? 0} matches${searchSnapshot?.truncated ? ` · showing first ${searchSnapshot.resultLimit}` : ''}`
                : listing
                  ? `${nativeEntriesTotal} items${hiddenCount ? ` · ${hiddenCount} protected/hidden` : ''}`
                  : `${roots.length} drives`}
          </span>
          <span>
            {source === 'computer'
              ? searchMode
                ? `${searchSnapshot?.state ?? 'debouncing'}${searchSnapshot ? ` · ${Math.round(searchSnapshot.durationMs)} ms` : ''}`
                : `${loading ? 'Reading' : 'Native filesystem'}${uiDuration !== null ? ` · ${Math.round(uiDuration)} ms` : ''}`
              : 'Web-safe mock workspace'}
          </span>
        </div>
      </section>

      {propertiesPaths && (
        <FilePropertiesDialog
          paths={propertiesPaths}
          filesystem={filesystem}
          previewScheduler={previewScheduler}
          refreshToken={(listing?.durationMs ?? 0) + searchRevision}
          onClose={() => setPropertiesPaths(null)}
        />
      )}

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

      {activeArchiveOperation && (
        <div className="absolute bottom-9 right-3 z-40 w-72 border border-[#4aa3ff]/20 bg-[#07111b]/95 p-3 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2">
            {!terminalArchiveOperation(activeArchiveOperation) && (
              <LoaderCircle size={13} className="animate-spin text-[#4aa3ff]" />
            )}
            <FileArchive size={13} className="text-[#4aa3ff]" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] capitalize text-[#c9dbe9]">
                {activeArchiveOperation.operation.replace('-', ' ')} ·{' '}
                {activeArchiveOperation.state}
              </div>
              <div className="mt-0.5 truncate font-mono text-[8px] text-[#5e7a90]">
                {activeArchiveOperation.currentEntry ??
                  `${activeArchiveOperation.filesCompleted} files completed`}
              </div>
            </div>
            {terminalArchiveOperation(activeArchiveOperation) ? (
              <button
                type="button"
                onClick={() => {
                  void filesystem.releaseArchiveOperation(activeArchiveOperation.id);
                  setActiveArchiveOperation(null);
                }}
                className="p-1 text-[#668095] hover:bg-white/[0.04] hover:text-white"
                aria-label="Close archive operation status"
              >
                <X size={11} />
              </button>
            ) : (
              <button
                type="button"
                onClick={cancelArchiveOperation}
                className="border border-white/[0.08] px-2 py-1 font-mono text-[8px] text-[#8da2b4] hover:border-[#ff7b7b]/30 hover:text-[#ffaaaa]"
              >
                Cancel
              </button>
            )}
          </div>
          <div className="mt-2 h-1 bg-white/[0.06]">
            <span
              className="block h-full bg-[#4aa3ff] transition-[width]"
              style={{
                width: `${Math.min(100, Math.round((activeArchiveOperation.bytesProcessed / Math.max(activeArchiveOperation.bytesTotal, 1)) * 100))}%`,
              }}
            />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[8px] text-[#536d82]">
            <span>
              {activeArchiveOperation.filesCompleted + activeArchiveOperation.directoriesCompleted}{' '}
              / {activeArchiveOperation.entriesTotal} entries
            </span>
            <span>
              {formatBytes(activeArchiveOperation.bytesProcessed)} /{' '}
              {formatBytes(activeArchiveOperation.bytesTotal)}
            </span>
          </div>
          {activeArchiveOperation.error && (
            <div className="mt-2 font-mono text-[8px] leading-4 text-[#d88f8f]">
              {activeArchiveOperation.error.message}
            </div>
          )}
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
