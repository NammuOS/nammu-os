import { useRef, useState } from 'react';
import { ChevronRight, FileText, Folder, Loader2, Users } from 'lucide-react';
import type { CloudFile } from '../types/cloudTypes';
import {
  formatBytes,
  formatDate,
  getProviderColor,
  getProviderName,
} from '../services/cloudClient';
import CloudResourceInspector from '../components/CloudResourceInspector';

interface SharedViewProps {
  files: CloudFile[];
  onOpenFolder: (file: CloudFile) => Promise<CloudFile[]>;
  onPreviewFile: (file: CloudFile) => void;
  onDownloadFile: (file: CloudFile) => void;
  onShowDetails: (file: CloudFile) => void;
  onToggleStar: (file: CloudFile) => void;
}

export default function CloudSharedView({
  files,
  onOpenFolder,
  onPreviewFile,
  onDownloadFile,
  onShowDetails,
  onToggleStar,
}: SharedViewProps) {
  const [search, setSearch] = useState('');
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [folderStack, setFolderStack] = useState<CloudFile[]>([]);
  const [folderFiles, setFolderFiles] = useState<CloudFile[]>([]);
  const [isLoadingFolder, setIsLoadingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const navigationSequence = useRef(0);

  const visibleFiles = folderStack.length ? folderFiles : files;
  const filtered = visibleFiles.filter((f) =>
    f.file_name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const activeFile = filtered.find((file) => file.id === activeFileId) ?? null;

  const navigateToFolder = async (folder: CloudFile, nextStack: CloudFile[]) => {
    const sequence = ++navigationSequence.current;
    setIsLoadingFolder(true);
    setFolderError(null);
    setActiveFileId(null);
    setSearch('');
    try {
      const children = await onOpenFolder(folder);
      if (sequence !== navigationSequence.current) return;
      setFolderStack(nextStack);
      setFolderFiles(children);
    } catch (error) {
      if (sequence !== navigationSequence.current) return;
      setFolderError(error instanceof Error ? error.message : 'Unable to open this shared folder.');
    } finally {
      if (sequence === navigationSequence.current) setIsLoadingFolder(false);
    }
  };

  const showSharedRoot = () => {
    navigationSequence.current += 1;
    setFolderStack([]);
    setFolderFiles([]);
    setActiveFileId(null);
    setFolderError(null);
    setIsLoadingFolder(false);
    setSearch('');
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#05080d] text-[11px]">
      {/* Header bar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.06] bg-white/[0.01] px-3">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-[#4aa3ff]" />
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#556f84]">
            Shared with Me ({filtered.length})
          </span>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter shared resources"
          className="w-44 rounded border border-white/[0.06] bg-black/30 px-2 py-1 text-[9px] text-[#c9d8e4] outline-none"
        />
      </div>

      <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.05] bg-black/10 px-3 font-mono text-[8px] text-[#5f788d] os-scrollbar">
        <button onClick={showSharedRoot} className="shrink-0 hover:text-[#bcd2e4]">
          Shared with Me
        </button>
        {folderStack.map((folder, index) => (
          <div key={folder.id} className="flex shrink-0 items-center gap-1">
            <ChevronRight size={9} className="text-[#354a5c]" />
            <button
              onClick={() => {
                if (index === folderStack.length - 1) return;
                void navigateToFolder(folder, folderStack.slice(0, index + 1));
              }}
              className="max-w-40 truncate hover:text-[#bcd2e4]"
              title={folder.file_name}
            >
              {folder.file_name}
            </button>
          </div>
        ))}
        {isLoadingFolder && (
          <Loader2 size={10} className="ml-1 shrink-0 animate-spin text-[#4aa3ff]" />
        )}
      </div>
      {folderError && (
        <div className="shrink-0 border-b border-red-500/15 bg-red-500/[0.06] px-3 py-1 font-mono text-[8px] text-red-300">
          {folderError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-auto os-scrollbar">
            <div className="grid grid-cols-[1fr_130px_120px_100px_80px_70px] border-b border-white/[0.05] px-3 py-2 font-mono text-[8px] uppercase tracking-wider text-[#476077]">
              <span>Name</span>
              <span>Shared By</span>
              <span>Provider</span>
              <span>Type</span>
              <span>Modified</span>
              <span className="text-right">Size</span>
            </div>

            <div className="divide-y divide-white/[0.02]">
              {filtered.map((file) => {
                const providerColor = getProviderColor(file.provider);
                const isActive = activeFileId === file.id;
                return (
                  <div
                    key={file.id}
                    onClick={() => setActiveFileId(file.id)}
                    onDoubleClick={() =>
                      file.is_folder
                        ? void navigateToFolder(file, [...folderStack, file])
                        : onPreviewFile(file)
                    }
                    className={`grid w-full cursor-pointer grid-cols-[1fr_130px_120px_100px_80px_70px] items-center px-3 py-2 text-left transition-colors ${
                      isActive ? 'bg-[#4aa3ff]/10' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {file.is_folder ? (
                        <Folder size={13} className="shrink-0 text-[#4aa3ff]" />
                      ) : (
                        <FileText size={13} className="shrink-0 text-[#6ec8d4]" />
                      )}
                      <span className="truncate text-[#c9d8e5]">{file.file_name}</span>
                    </div>

                    <span className="truncate font-mono text-[9px] text-[#718da3]">
                      {file.email || 'partner@domain.com'}
                    </span>

                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: providerColor }}
                      />
                      <span className="font-mono text-[9px] text-[#6d859a]">
                        {getProviderName(file.provider)}
                      </span>
                    </div>

                    <span className="truncate font-mono text-[8px] text-[#536a7d]">
                      {file.is_folder ? 'Folder' : file.mime_type || 'File'}
                    </span>

                    <span className="font-mono text-[8px] text-[#465c6f]">
                      {formatDate(file.updated_at)}
                    </span>

                    <span className="text-right font-mono text-[8px] text-[#465c6f]">
                      {file.is_folder ? '—' : formatBytes(file.size)}
                    </span>
                  </div>
                );
              })}

              {!filtered.length && !isLoadingFolder && (
                <div className="grid h-48 place-items-center font-mono text-[9px] text-[#43586b]">
                  {folderError ||
                    (folderStack.length
                      ? 'This shared folder is empty'
                      : 'No shared resources discovered')}
                </div>
              )}
            </div>
          </div>
          <div className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.05] bg-white/[0.01] px-3 font-mono text-[8px] text-[#465c6f]">
            <span>{filtered.length} shared resources</span>
            <span>Double-click to open</span>
          </div>
        </div>
        <CloudResourceInspector
          file={activeFile}
          onPreviewFile={onPreviewFile}
          onDownloadFile={onDownloadFile}
          onShowDetails={onShowDetails}
          onToggleStar={onToggleStar}
        />
      </div>
    </div>
  );
}
