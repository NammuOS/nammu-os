import { useState } from 'react';
import {
  Trash2,
  RotateCcw,
  File,
  Folder,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
} from 'lucide-react';
import type { CloudFile } from '../types/cloudTypes';
import {
  formatBytes,
  formatDate,
  getFilePreviewType,
  getProviderColor,
  getProviderName,
} from '../services/cloudClient';

interface TrashViewProps {
  files: CloudFile[];
  onRestore: (fileId: string) => Promise<void>;
  onDeletePermanently: (fileId: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
}

export default function CloudTrashView({
  files,
  onRestore,
  onDeletePermanently,
  onEmptyTrash,
}: TrashViewProps) {
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const getFileIcon = (file: CloudFile) => {
    if (file.is_folder) return <Folder size={14} className="shrink-0 text-[#4aa3ff]" />;
    const type = getFilePreviewType(file.mime_type, file.file_name);
    switch (type) {
      case 'image':
        return <ImageIcon size={14} className="shrink-0 text-[#2ee6a6]" />;
      case 'video':
        return <Film size={14} className="shrink-0 text-[#e68c2e]" />;
      case 'audio':
        return <Music size={14} className="shrink-0 text-[#9334e6]" />;
      case 'pdf':
        return <FileText size={14} className="shrink-0 text-[#ef4444]" />;
      default:
        return <File size={14} className="shrink-0 text-[#7f95a8]" />;
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#05080d] text-[11px]">
      {/* Action Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.06] bg-white/[0.01] px-3">
        <div className="flex items-center gap-2">
          <Trash2 size={13} className="text-red-400" />
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#dce7f2]">
            Recycle Bin & Trash ({files.length})
          </span>
        </div>

        {files.length > 0 && (
          <div className="flex items-center gap-2">
            {confirmEmpty ? (
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[8.5px] text-red-300">
                  Permanently empty all items?
                </span>
                <button
                  onClick={async () => {
                    await onEmptyTrash();
                    setConfirmEmpty(false);
                  }}
                  className="rounded bg-red-500/30 px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-red-200 hover:bg-red-500/40"
                >
                  Yes, Empty
                </button>
                <button
                  onClick={() => setConfirmEmpty(false)}
                  className="rounded border border-white/[0.06] px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-[#8da2b5] hover:bg-white/[0.04]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmEmpty(true)}
                className="flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-red-300 hover:bg-red-500/20 transition-colors"
              >
                <Trash2 size={11} />
                <span>Empty Trash</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-[1fr_130px_110px_90px_70px_110px] border-b border-white/[0.05] px-3 py-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[#43586b]">
        <span>Name</span>
        <span>Original Path</span>
        <span>Provider</span>
        <span>Deleted</span>
        <span className="text-right">Size</span>
        <span className="text-right pr-2">Actions</span>
      </div>

      {/* Files List */}
      <div className="min-w-0 flex-1 overflow-auto os-scrollbar p-2">
        {files.length > 0 ? (
          <div className="divide-y divide-white/[0.02]">
            {files.map((file) => {
              const providerColor = getProviderColor(file.provider);
              return (
                <div
                  key={file.id}
                  className="grid w-full grid-cols-[1fr_130px_110px_90px_70px_110px] items-center px-3 py-2 text-left hover:bg-white/[0.02] text-[#c9d7e2] transition-colors"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {getFileIcon(file)}
                    <span className="truncate text-[11px] font-normal">{file.file_name}</span>
                  </div>

                  <span className="truncate font-mono text-[8px] text-[#6d859a]">
                    {file.virtual_path}
                  </span>

                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: providerColor }}
                    />
                    <span className="truncate font-mono text-[8px] text-[#6d859a]">
                      {getProviderName(file.provider)}
                    </span>
                  </div>

                  <span className="font-mono text-[8px] text-[#465c6f]">
                    {formatDate(file.updated_at)}
                  </span>

                  <span className="text-right font-mono text-[8px] text-[#465c6f]">
                    {file.is_folder ? '—' : formatBytes(file.size)}
                  </span>

                  <div className="flex items-center justify-end gap-1.5 pr-1">
                    <button
                      onClick={() => onRestore(file.id)}
                      className="flex items-center gap-1 rounded border border-[#2ee6a6]/30 bg-[#2ee6a6]/10 px-1.5 py-0.5 font-mono text-[7.5px] uppercase tracking-wider text-[#2ee6a6] hover:bg-[#2ee6a6]/20 transition-colors"
                      title="Restore file to original location"
                    >
                      <RotateCcw size={9} /> Restore
                    </button>
                    <button
                      onClick={() => onDeletePermanently(file.id)}
                      className="flex items-center gap-1 rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 font-mono text-[7.5px] uppercase tracking-wider text-red-400 hover:bg-red-500/20 transition-colors"
                      title="Delete permanently"
                    >
                      <Trash2 size={9} /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid h-56 place-items-center font-mono text-[10px] text-[#43586b]">
            <div className="flex flex-col items-center gap-2">
              <Trash2 size={26} strokeWidth={1} />
              <span>Trash is empty</span>
              <span className="text-[8.5px] text-[#3b4f60]">
                Items deleted from your drives will appear here for recovery
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.05] bg-white/[0.01] px-3 font-mono text-[8px] text-[#465c6f]">
        <span>{files.length} items in recycle bin</span>
        <span>Soft-Delete Protection Enabled</span>
      </div>
    </div>
  );
}
