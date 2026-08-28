import { useState } from 'react';
import { Users, FileText, Folder } from 'lucide-react';
import type { CloudFile } from '../types/cloudTypes';
import {
  formatBytes,
  formatDate,
  getProviderColor,
  getProviderName,
} from '../services/cloudClient';

interface SharedViewProps {
  files: CloudFile[];
  onOpenFile: (file: CloudFile) => void;
  onPreviewFile: (file: CloudFile) => void;
  onShowDetails: (file: CloudFile) => void;
  onToggleStar: (file: CloudFile) => void;
}

export default function CloudSharedView({ files, onOpenFile, onPreviewFile }: SharedViewProps) {
  const [search, setSearch] = useState('');

  const filtered = files.filter((f) =>
    f.file_name.toLowerCase().includes(search.trim().toLowerCase()),
  );

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
            return (
              <div
                key={file.id}
                onDoubleClick={() => (file.is_folder ? onOpenFile(file) : onPreviewFile(file))}
                className="grid w-full grid-cols-[1fr_130px_120px_100px_80px_70px] items-center px-3 py-2 text-left transition-colors hover:bg-white/[0.03] cursor-pointer"
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

          {!filtered.length && (
            <div className="grid h-48 place-items-center font-mono text-[9px] text-[#43586b]">
              No shared resources discovered
            </div>
          )}
        </div>
      </div>
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.05] bg-white/[0.01] px-3 font-mono text-[8px] text-[#465c6f]">
        <span>{filtered.length} shared resources</span>
        <span>Double-click to open</span>
      </div>
    </div>
  );
}
