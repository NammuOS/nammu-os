'use client';

import {
  Calculator,
  CircleAlert,
  File,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  HardDrive,
  Link2,
  LoaderCircle,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type {
  DirectoryMeasurementSnapshot,
  NativeFilePreviewDescriptor,
  NativeFileProperties,
  NativeFilePropertyItem,
} from '../../platform';
import { categorizeNativeFile, type FilesystemService } from './filesystemService';
import type { NativePreviewScheduler, ScheduledNativePreview } from './nativePreviewScheduler';

type PropertyRow = { label: string; value: string };
type PropertySection = { id: string; title: string; rows: readonly PropertyRow[] };

function formatBytes(bytes: number | null) {
  if (bytes === null) return 'Unavailable';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

function exactBytes(bytes: number | null) {
  return bytes === null ? 'Unavailable' : `${new Intl.NumberFormat().format(bytes)} bytes`;
}

function formatDate(timestamp: number | null) {
  return timestamp === null
    ? 'Unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' }).format(
        timestamp,
      );
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function friendlyKind(item: NativeFilePropertyItem) {
  switch (item.kind) {
    case 'directory':
      return 'Folder';
    case 'drive':
      return 'Drive';
    case 'symbolic-link':
      return 'Symbolic link';
    case 'junction':
      return 'Junction';
    case 'other-reparse':
      return 'Reparse point';
    case 'unavailable':
      return 'Unavailable item';
    case 'other':
      return 'Filesystem object';
    default:
      return item.extension ? `${item.extension.toUpperCase()} file` : 'File';
  }
}

function categoryFor(item: NativeFilePropertyItem) {
  return categorizeNativeFile({
    name: item.name,
    path: item.path,
    kind:
      item.kind === 'directory'
        ? 'directory'
        : ['symbolic-link', 'junction', 'other-reparse'].includes(item.kind)
          ? 'reparse-point'
          : item.kind === 'file'
            ? 'file'
            : 'other',
    sizeBytes: item.sizeBytes,
    createdAtMs: item.createdAtMs,
    modifiedAtMs: item.modifiedAtMs,
    extension: item.extension,
    hidden: item.attributes.hidden,
    system: item.attributes.system,
    readOnly: item.attributes.readOnly,
    readable: item.accessible,
    navigable: item.kind === 'directory',
  });
}

function iconFor(
  item: NativeFilePropertyItem,
): ComponentType<{ size?: number; className?: string }> {
  if (item.kind === 'drive') return HardDrive;
  if (['symbolic-link', 'junction', 'other-reparse'].includes(item.kind)) return Link2;
  switch (categoryFor(item)) {
    case 'folder':
      return Folder;
    case 'image':
      return FileImage;
    case 'video':
      return FileVideo;
    case 'pdf':
    case 'document':
    case 'code':
      return FileText;
    default:
      return File;
  }
}

function attributesText(item: NativeFilePropertyItem) {
  const names = Object.entries(item.attributes)
    .filter(([, enabled]) => enabled)
    .map(([name]) =>
      name.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()),
    );
  return names.length > 0 ? names.join(' · ') : 'None';
}

function aggregateSections(properties: NativeFileProperties): PropertySection[] {
  const item = properties.items.length === 1 ? properties.items[0] : null;
  if (!item) {
    return [
      {
        id: 'selection',
        title: 'Selection',
        rows: [
          { label: 'Items', value: new Intl.NumberFormat().format(properties.itemCount) },
          { label: 'Files', value: new Intl.NumberFormat().format(properties.fileCount) },
          { label: 'Folders', value: new Intl.NumberFormat().format(properties.folderCount) },
          { label: 'Drives', value: new Intl.NumberFormat().format(properties.driveCount) },
          {
            label: 'Location',
            value: properties.commonParentPath ?? 'Multiple locations',
          },
          { label: 'Types', value: properties.mixedKinds ? 'Mixed types' : 'Same type' },
          { label: 'Direct file size', value: formatBytes(properties.directFileBytes) },
          { label: 'Exact direct size', value: exactBytes(properties.directFileBytes) },
          {
            label: 'Direct size on disk',
            value: formatBytes(properties.directAllocatedBytes),
          },
        ],
      },
    ];
  }

  const sections: PropertySection[] = [
    {
      id: 'general',
      title: 'General',
      rows: [
        { label: 'Type', value: friendlyKind(item) },
        { label: 'Location', value: item.parentPath ?? item.path },
        { label: 'Full path', value: item.path },
        { label: 'Extension', value: item.extension ? `.${item.extension}` : 'None' },
        { label: 'Category', value: categoryFor(item) },
        { label: 'Availability', value: item.accessible ? 'Available' : 'Unavailable' },
        ...(item.sizeBytes === null
          ? []
          : [
              { label: 'Size', value: formatBytes(item.sizeBytes) },
              { label: 'Exact size', value: exactBytes(item.sizeBytes) },
              { label: 'Size on disk', value: formatBytes(item.allocatedBytes) },
            ]),
      ],
    },
    {
      id: 'dates',
      title: 'Dates',
      rows: [
        { label: 'Created', value: formatDate(item.createdAtMs) },
        { label: 'Modified', value: formatDate(item.modifiedAtMs) },
        { label: 'Accessed', value: formatDate(item.accessedAtMs) },
      ],
    },
    {
      id: 'filesystem',
      title: 'Filesystem',
      rows: [
        { label: 'Volume', value: item.volume?.path ?? 'Unavailable' },
        { label: 'Filesystem', value: item.volume?.fileSystem ?? 'Unavailable' },
        { label: 'Attributes', value: attributesText(item) },
        ...(item.hardLinkCount === null
          ? []
          : [{ label: 'Hard links', value: String(item.hardLinkCount) }]),
        ...(item.linkTarget === null ? [] : [{ label: 'Target', value: item.linkTarget }]),
      ],
    },
  ];

  if (item.kind === 'drive' && item.volume) {
    const usedPercent =
      item.volume.usedBytes !== null && item.volume.totalBytes
        ? Math.round((item.volume.usedBytes / item.volume.totalBytes) * 100)
        : null;
    sections.splice(1, 2, {
      id: 'drive',
      title: 'Drive',
      rows: [
        { label: 'Label', value: item.volume.label ?? 'No label' },
        { label: 'Drive type', value: item.volume.kind.replace('-', ' ') },
        { label: 'Filesystem', value: item.volume.fileSystem ?? 'Unavailable' },
        { label: 'Capacity', value: formatBytes(item.volume.totalBytes) },
        { label: 'Used', value: formatBytes(item.volume.usedBytes) },
        { label: 'Free', value: formatBytes(item.volume.freeBytes) },
        { label: 'Usage', value: usedPercent === null ? 'Unavailable' : `${usedPercent}%` },
      ],
    });
  }
  if (!item.accessible && item.accessError) {
    sections.unshift({
      id: 'access',
      title: 'Access',
      rows: [{ label: item.accessError.code, value: item.accessError.message }],
    });
  }
  return sections;
}

function typeSpecificRows(descriptor: NativeFilePreviewDescriptor | null): PropertyRow[] {
  if (!descriptor) return [];
  const rows: PropertyRow[] = [];
  if (descriptor.sourceWidth !== null && descriptor.sourceHeight !== null) {
    rows.push({
      label: 'Dimensions',
      value: `${descriptor.sourceWidth} × ${descriptor.sourceHeight} pixels`,
    });
  }
  if (descriptor.pageCount !== null) {
    rows.push({ label: 'Pages', value: new Intl.NumberFormat().format(descriptor.pageCount) });
  }
  if (descriptor.durationMs !== null) {
    rows.push({ label: 'Duration', value: formatDuration(descriptor.durationMs) });
  }
  return rows;
}

function terminalMeasurement(snapshot: DirectoryMeasurementSnapshot) {
  return ['completed', 'cancelled', 'failed'].includes(snapshot.state);
}

export function FilePropertiesDialog({
  paths,
  filesystem,
  previewScheduler,
  refreshToken,
  onClose,
}: {
  paths: readonly string[];
  filesystem: FilesystemService;
  previewScheduler: NativePreviewScheduler;
  refreshToken: number;
  onClose: () => void;
}) {
  const [properties, setProperties] = useState<NativeFileProperties | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [measurement, setMeasurement] = useState<DirectoryMeasurementSnapshot | null>(null);
  const [descriptor, setDescriptor] = useState<NativeFilePreviewDescriptor | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const measurementId = useRef<string | null>(null);
  const preview = useRef<ScheduledNativePreview | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    void filesystem.getProperties(paths).then((result) => {
      if (!live) return;
      if (result.status === 'success') setProperties(result.value);
      else setError(result.status === 'error' ? result.error.message : result.reason);
    });
    return () => {
      live = false;
    };
  }, [filesystem, paths, refreshToken]);

  const single = properties?.items.length === 1 ? properties.items[0] : null;
  const category = single ? categoryFor(single) : null;
  useEffect(() => {
    setDescriptor(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (!single || single.kind !== 'file' || !['image', 'pdf', 'video'].includes(category ?? '')) {
      return;
    }
    let live = true;
    let url: string | null = null;
    const scheduled = previewScheduler.schedule(
      {
        path: single.path,
        mode: 'image-preview',
        requestedWidth: 512,
        requestedHeight: 512,
      },
      'high',
    );
    preview.current = scheduled;
    void scheduled.promise.then((outcome) => {
      if (!live || outcome.status !== 'success') return;
      setDescriptor(outcome.value.descriptor);
      if (outcome.value.bytes) {
        url = URL.createObjectURL(
          new Blob([Uint8Array.from(outcome.value.bytes)], { type: 'image/png' }),
        );
        setPreviewUrl(url);
      }
    });
    return () => {
      live = false;
      scheduled.cancel();
      if (url) URL.revokeObjectURL(url);
    };
  }, [category, previewScheduler, single]);

  useEffect(
    () => () => {
      preview.current?.cancel();
      const id = measurementId.current;
      if (id) {
        measurementId.current = null;
        void filesystem.cancelDirectoryMeasurement(id);
        void filesystem.releaseDirectoryMeasurement(id);
      }
    },
    [filesystem],
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const startMeasurement = async () => {
    setError(null);
    const started = await filesystem.startDirectoryMeasurement(paths);
    if (started.status !== 'success') {
      setError(started.status === 'error' ? started.error.message : started.reason);
      return;
    }
    measurementId.current = started.value.id;
    setMeasurement(started.value);
    let snapshot = started.value;
    while (!terminalMeasurement(snapshot) && measurementId.current === snapshot.id) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      if (measurementId.current !== snapshot.id) return;
      const polled = await filesystem.getDirectoryMeasurement(snapshot.id);
      if (polled.status !== 'success') {
        setError(polled.status === 'error' ? polled.error.message : polled.reason);
        await filesystem.releaseDirectoryMeasurement(snapshot.id);
        measurementId.current = null;
        break;
      }
      snapshot = polled.value;
      setMeasurement(snapshot);
    }
    if (measurementId.current === snapshot.id && terminalMeasurement(snapshot)) {
      await filesystem.releaseDirectoryMeasurement(snapshot.id);
      measurementId.current = null;
    }
  };

  const cancelMeasurement = async () => {
    const id = measurementId.current;
    if (!id) return;
    const result = await filesystem.cancelDirectoryMeasurement(id);
    if (result.status === 'success') setMeasurement(result.value);
  };

  const sections = useMemo(() => {
    if (!properties) return [];
    const base = aggregateSections(properties);
    const rows = typeSpecificRows(descriptor);
    return rows.length > 0 ? [...base, { id: 'media', title: category ?? 'Media', rows }] : base;
  }, [category, descriptor, properties]);
  const canMeasure = Boolean(
    properties && properties.driveCount === 0 && properties.containsUnmeasuredFolders,
  );
  const title = properties
    ? properties.itemCount === 1
      ? properties.items[0].name
      : `${properties.itemCount} items`
    : 'Properties';
  const HeaderIcon = single ? iconFor(single) : File;

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-[3px]"
      onContextMenu={(event) => event.stopPropagation()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-properties-title"
        className="flex max-h-[88%] w-full max-w-xl flex-col overflow-hidden border border-[#4aa3ff]/20 bg-[#07111b]/98 shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center border border-[#4aa3ff]/20 bg-[#4aa3ff]/[0.06]">
            <HeaderIcon size={20} className="text-[#4aa3ff]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#4a88b8]">
              Advanced properties · Read only
            </div>
            <h2 id="file-properties-title" className="mt-1 truncate text-[13px] text-[#dce9f3]">
              {title}
            </h2>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="p-2 text-[#688198] hover:bg-white/[0.04] hover:text-white"
            aria-label="Close properties"
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4 os-scrollbar">
          {!properties && !error && (
            <div className="grid h-32 place-items-center">
              <LoaderCircle size={18} className="animate-spin text-[#4aa3ff]" />
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 border border-[#ff6b6b]/20 bg-[#ff6b6b]/[0.04] p-3 font-mono text-[9px] leading-4 text-[#dba0a0]">
              <CircleAlert size={13} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          {previewUrl && (
            <div className="mb-4 grid max-h-44 place-items-center overflow-hidden border border-white/[0.06] bg-black/25 p-2">
              <img src={previewUrl} alt="" className="max-h-40 max-w-full object-contain" />
            </div>
          )}
          <div className="space-y-3">
            {sections.map((section) => (
              <section key={section.id} className="border border-white/[0.055] bg-white/[0.012]">
                <div className="border-b border-white/[0.05] px-3 py-2 font-mono text-[8px] uppercase tracking-[0.18em] text-[#4c789a]">
                  {section.title}
                </div>
                <dl className="divide-y divide-white/[0.035]">
                  {section.rows.map((row) => (
                    <div
                      key={`${section.id}-${row.label}`}
                      className="grid grid-cols-[120px_1fr] gap-3 px-3 py-2"
                    >
                      <dt className="font-mono text-[8px] uppercase tracking-[0.08em] text-[#52697c]">
                        {row.label}
                      </dt>
                      <dd className="min-w-0 break-all text-[10px] text-[#b9cbd9]">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>

          {canMeasure && (
            <section className="mt-3 border border-white/[0.055] bg-white/[0.012] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] text-[#c5d5e1]">Folder contents</div>
                  <div className="mt-1 font-mono text-[8px] leading-4 text-[#536d82]">
                    Recursive size is calculated only on request. Links and junctions are not
                    followed.
                  </div>
                </div>
                {!measurement || terminalMeasurement(measurement) ? (
                  <button
                    type="button"
                    onClick={() => void startMeasurement()}
                    className="flex shrink-0 items-center gap-1.5 border border-[#4aa3ff]/30 bg-[#4aa3ff]/[0.07] px-2.5 py-1.5 font-mono text-[8px] text-[#b9dcf7] hover:bg-[#4aa3ff]/[0.12]"
                  >
                    <Calculator size={11} /> {measurement ? 'Recalculate' : 'Calculate'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void cancelMeasurement()}
                    className="shrink-0 border border-[#ff8787]/25 px-2.5 py-1.5 font-mono text-[8px] text-[#d79a9a] hover:bg-[#ff6b6b]/[0.06]"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {measurement && (
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-white/[0.05] pt-3 font-mono text-[8px] text-[#688298]">
                  <span>
                    {measurement.state === 'running' ? 'Calculating…' : measurement.state}
                  </span>
                  <span className="text-right">{Math.round(measurement.durationMs)} ms</span>
                  <span>{new Intl.NumberFormat().format(measurement.filesScanned)} files</span>
                  <span className="text-right">{formatBytes(measurement.logicalBytes)}</span>
                  <span>
                    {new Intl.NumberFormat().format(measurement.directoriesScanned)} folders
                  </span>
                  <span className="text-right">
                    {measurement.allocatedBytes === null
                      ? 'Disk allocation unavailable'
                      : `${formatBytes(measurement.allocatedBytes)} on disk`}
                  </span>
                  {(measurement.skippedEntries > 0 || measurement.reparsePointsSkipped > 0) && (
                    <span className="col-span-2 text-[#9a8060]">
                      {measurement.skippedEntries} inaccessible/skipped ·{' '}
                      {measurement.reparsePointsSkipped} links not followed
                    </span>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
