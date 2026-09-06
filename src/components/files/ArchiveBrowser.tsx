'use client';

import {
  ArrowLeft,
  ChevronRight,
  FileArchive,
  FileText,
  Folder,
  LoaderCircle,
  PackageOpen,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type {
  FilesystemError,
  NativeArchiveConflictStrategy,
  NativeArchiveEntry,
  NativeArchiveListing,
  NativeArchiveOperationSnapshot,
  NativeArchiveSummary,
} from '../../platform';
import type { FilesystemService } from './filesystemService';

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = -1;
  do {
    size /= 1024;
    unit += 1;
  } while (size >= 1024 && unit < units.length - 1);
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function archiveParent(path: string): string {
  const normalized = path.replaceAll('/', '\\');
  const index = normalized.lastIndexOf('\\');
  return index > 2 ? normalized.slice(0, index) : normalized.slice(0, Math.max(index, 3));
}

function childPath(entry: NativeArchiveEntry): string {
  return entry.path.replace(/\/$/, '');
}

export interface ArchiveBrowserProps {
  filesystem: FilesystemService;
  summary: NativeArchiveSummary;
  onClose(): void;
  onOperation(operation: NativeArchiveOperationSnapshot): void;
  onError(error: FilesystemError): void;
}

export function ArchiveBrowser({
  filesystem,
  summary,
  onClose,
  onOperation,
  onError,
}: ArchiveBrowserProps) {
  const [path, setPath] = useState('');
  const [query, setQuery] = useState('');
  const [listing, setListing] = useState<NativeArchiveListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [strategy, setStrategy] = useState<NativeArchiveConflictStrategy>('keep-both');
  const requestSequence = useRef(0);

  const load = useCallback(
    async (nextPath: string, nextQuery = query, append = false) => {
      const requestId = ++requestSequence.current;
      if (append) setLoadingMore(true);
      else {
        setLoadingMore(false);
        setLoading(true);
      }
      const offset = append && listing?.path === nextPath ? listing.entries.length : 0;
      const result = await filesystem.listArchiveEntries(
        summary.id,
        nextPath,
        offset,
        500,
        nextQuery,
      );
      if (requestId !== requestSequence.current) return;
      if (append) setLoadingMore(false);
      else setLoading(false);
      if (result.status === 'success') {
        setPath(result.value.path);
        setListing((current) =>
          append && current?.path === result.value.path
            ? {
                ...result.value,
                offset: 0,
                entries: [...current.entries, ...result.value.entries],
              }
            : result.value,
        );
        if (!append) setSelected(new Set());
        return;
      }
      onError(
        result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
      );
    },
    [filesystem, listing, onError, query, summary.id],
  );

  useEffect(() => {
    void load('');
    return () => {
      void filesystem.releaseArchive(summary.id);
    };
    // The archive session is intentionally tied to this mounted view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesystem, summary.id]);

  useEffect(() => {
    const parent = archiveParent(summary.archivePath);
    let disposed = false;
    let stop: (() => Promise<void>) | null = null;
    void filesystem
      .watchDirectory(parent, (event) => {
        if (disposed) return;
        if (
          event.rescanRequired ||
          event.paths.some(
            (changedPath) =>
              changedPath.localeCompare(summary.archivePath, undefined, {
                sensitivity: 'accent',
              }) === 0,
          )
        ) {
          void load(path);
        }
      })
      .then((result) => {
        if (result.status !== 'success') return;
        if (disposed) void result.value.dispose();
        else stop = () => result.value.dispose();
      });
    return () => {
      disposed = true;
      if (stop) void stop();
    };
  }, [filesystem, load, path, summary.archivePath]);

  const crumbs = useMemo(() => {
    const parts = path ? path.split('/') : [];
    return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }));
  }, [path]);

  const toggle = (entry: NativeArchiveEntry, event: MouseEvent) => {
    setSelected((current) => {
      if (!event.ctrlKey && !event.metaKey) return new Set([entry.id]);
      const next = new Set(current);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  };

  const startExtract = async (mode: 'here' | 'choose', selectionOnly: boolean) => {
    const parent = archiveParent(summary.archivePath);
    const selectedDestination =
      mode === 'here'
        ? { status: 'success' as const, value: parent }
        : await filesystem.pickArchiveDestination(parent);
    if (selectedDestination.status !== 'success' || !selectedDestination.value) {
      if (selectedDestination.status === 'error') onError(selectedDestination.error);
      return;
    }
    const result = await filesystem.extractArchive({
      archiveId: summary.id,
      destinationPath: selectedDestination.value,
      selectedEntryIds: selectionOnly ? [...selected] : [],
      conflictStrategy: strategy,
    });
    if (result.status === 'success') onOperation(result.value);
    else
      onError(
        result.status === 'error' ? result.error : { code: 'IO_ERROR', message: result.reason },
      );
  };

  const entries = listing?.entries ?? [];
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[#05080d]"
      aria-label={`${summary.name} archive`}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3">
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-[#7890a5] hover:bg-white/[0.04] hover:text-white"
          aria-label="Close archive"
        >
          <ArrowLeft size={13} />
        </button>
        <FileArchive size={14} className="text-[#4aa3ff]" />
        <div className="min-w-0 flex-1 overflow-x-auto font-mono text-[9px] text-[#607b90] os-scrollbar">
          <button type="button" onClick={() => void load('')} className="hover:text-[#d3e9fb]">
            {summary.name}
          </button>
          {crumbs.map((crumb) => (
            <span key={crumb.path} className="inline-flex items-center">
              <ChevronRight size={10} />
              <button
                type="button"
                onClick={() => void load(crumb.path)}
                className="hover:text-[#d3e9fb]"
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex w-44 items-center gap-1.5 border border-white/[0.07] bg-black/20 px-2 py-1.5">
          <Search size={10} className="text-[#4aa3ff]" />
          <input
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              void load(path, value);
            }}
            placeholder="Filter this folder"
            className="min-w-0 flex-1 bg-transparent font-mono text-[8px] text-[#b5c9d9] outline-none placeholder:text-[#40576b]"
          />
        </div>
        <button
          type="button"
          onClick={() => void load(path)}
          className="p-1.5 text-[#7890a5] hover:bg-white/[0.04] hover:text-white"
          aria-label="Refresh archive"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-white/[0.05] px-3">
        <button
          type="button"
          onClick={() => void startExtract('here', false)}
          className="flex items-center gap-1.5 border border-white/[0.07] px-2 py-1 text-[9px] text-[#94aabd] hover:border-[#4aa3ff]/30 hover:text-[#d9edff]"
        >
          <PackageOpen size={11} /> Extract here
        </button>
        <button
          type="button"
          onClick={() => void startExtract('choose', false)}
          className="flex items-center gap-1.5 border border-white/[0.07] px-2 py-1 text-[9px] text-[#94aabd] hover:border-[#4aa3ff]/30 hover:text-[#d9edff]"
        >
          Extract to…
        </button>
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => void startExtract('choose', true)}
          className="border border-white/[0.07] px-2 py-1 text-[9px] text-[#94aabd] hover:border-[#4aa3ff]/30 hover:text-[#d9edff] disabled:opacity-25"
        >
          Extract selected
        </button>
        <label className="ml-1 flex items-center gap-1.5 font-mono text-[8px] text-[#5b7489]">
          Conflict
          <select
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as NativeArchiveConflictStrategy)}
            className="border border-white/[0.07] bg-[#07101a] px-1.5 py-1 text-[8px] text-[#91a9bc] outline-none"
          >
            <option value="keep-both">Keep both</option>
            <option value="skip">Skip existing</option>
            <option value="cancel">Cancel on conflict</option>
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[8px] text-[#536d82]">
          <ShieldCheck size={11} className="text-[#4aa3ff]" />
          Read-only archive · {summary.entryCount} entries
        </div>
      </div>

      <div className="grid grid-cols-[22px_minmax(160px,1fr)_94px_90px_90px] border-b border-white/[0.05] px-3 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[#43586b]">
        <span />
        <span>Name</span>
        <span>Method</span>
        <span>Original</span>
        <span className="text-right">Compressed</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto os-scrollbar">
        {loading && (
          <div className="grid h-32 place-items-center">
            <LoaderCircle size={16} className="animate-spin text-[#4aa3ff]" />
          </div>
        )}
        {!loading &&
          entries.map((entry) => {
            const Icon =
              entry.kind === 'directory'
                ? Folder
                : entry.kind === 'symlink'
                  ? ShieldCheck
                  : FileText;
            const isSelected = selected.has(entry.id);
            return (
              <button
                key={entry.id}
                type="button"
                onClick={(event) => toggle(entry, event)}
                onDoubleClick={() => {
                  if (entry.kind === 'directory') void load(childPath(entry));
                }}
                className={`grid w-full grid-cols-[22px_minmax(160px,1fr)_94px_90px_90px] items-center px-3 py-1.5 text-left ${isSelected ? 'bg-[#4aa3ff]/10' : 'hover:bg-white/[0.025]'}`}
              >
                <Icon
                  size={12}
                  className={entry.kind === 'directory' ? 'text-[#4aa3ff]' : 'text-[#718a9e]'}
                />
                <span className="truncate text-[10px] text-[#c9d7e2]">{entry.name}</span>
                <span className="truncate font-mono text-[8px] text-[#536a7d]">
                  {entry.encrypted ? 'Encrypted' : entry.compressionMethod}
                </span>
                <span className="font-mono text-[8px] text-[#536a7d]">
                  {formatBytes(entry.uncompressedSize)}
                </span>
                <span className="text-right font-mono text-[8px] text-[#536a7d]">
                  {formatBytes(entry.compressedSize)}
                </span>
              </button>
            );
          })}
        {!loading && entries.length === 0 && (
          <div className="grid h-32 place-items-center font-mono text-[9px] text-[#52697c]">
            This archive folder is empty
          </div>
        )}
        {!loading && listing?.hasMore && (
          <div className="flex justify-center border-t border-white/[0.04] py-3">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void load(path, query, true)}
              className="border border-white/[0.08] px-3 py-1.5 font-mono text-[9px] text-[#7890a5] hover:border-[#4aa3ff]/35 hover:text-[#d9edff] disabled:opacity-40"
            >
              {loadingMore ? 'Loading…' : 'Load next 500'}
            </button>
          </div>
        )}
      </div>
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-white/[0.05] px-3 font-mono text-[8px] text-[#4e6679]">
        <span>
          {listing?.totalEntries ?? 0} visible · {selected.size} selected
        </span>
        <span>
          {formatBytes(summary.totalUncompressedBytes)} original ·{' '}
          {formatBytes(summary.totalCompressedBytes)} compressed
        </span>
      </div>
    </section>
  );
}
