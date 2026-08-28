import { useState } from 'react';
import { Clock, File, FileText, Film, Folder, Image as ImageIcon, Music, Star } from 'lucide-react';
import type { CloudFile } from '../types/cloudTypes';
import {
  formatBytes,
  formatDate,
  getFilePreviewType,
  getProviderColor,
  getProviderName,
} from '../services/cloudClient';

interface RecentViewProps {
  files: CloudFile[];
  onOpenFile: (file: CloudFile) => void;
  onPreviewFile: (file: CloudFile) => void;
  onToggleStar: (file: CloudFile) => void;
}

export default function CloudRecentView({
  files,
  onOpenFile,
  onPreviewFile,
  onToggleStar,
}: RecentViewProps) {
  const [search, setSearch] = useState('');

  const filtered = files.filter((f) =>
    f.file_name.toLowerCase().includes(search.trim().toLowerCase()),
  );

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
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.06] bg-white/[0.01] px-3">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-[#4aa3ff]" />
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#556f84]">
            Recent Cloud Activity ({filtered.length})
          </span>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter recent items"
          className="w-44 rounded border border-white/[0.06] bg-black/30 px-2 py-1 text-[9px] text-[#c9d8e4] outline-none"
        />
      </div>

      <div className="flex-1 overflow-auto os-scrollbar">
        <div className="grid grid-cols-[1fr_120px_100px_100px_80px_28px] border-b border-white/[0.05] px-3 py-2 font-mono text-[8px] uppercase tracking-wider text-[#476077]">
          <span>Name</span>
          <span>Provider</span>
          <span>Location</span>
          <span>Last Synced</span>
          <span className="text-right">Size</span>
          <span />
        </div>

        <div className="divide-y divide-white/[0.02]">
          {filtered.map((file) => {
            const providerColor = getProviderColor(file.provider);
            return (
              <div
                key={file.id}
                onDoubleClick={() => (file.is_folder ? onOpenFile(file) : onPreviewFile(file))}
                className="grid w-full grid-cols-[1fr_120px_100px_100px_80px_28px] items-center px-3 py-2 text-left transition-colors hover:bg-white/[0.03] cursor-pointer"
              >
                {/* 1. Direct Name with Icon */}
                <div className="flex min-w-0 items-center gap-2">
                  {getFileIcon(file)}
                  <span className="truncate text-[#c9d8e5]">{file.file_name}</span>
                </div>

                {/* 2. Provider */}
                <div className="flex items-center gap-1.5 truncate">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: providerColor }}
                  />
                  <span className="truncate font-mono text-[9px] text-[#6d859a]">
                    {getProviderName(file.provider)}
                  </span>
                </div>

                {/* 3. Location */}
                <span className="truncate font-mono text-[8px] text-[#536a7d]">
                  {file.virtual_path}
                </span>

                {/* 4. Synced */}
                <span className="font-mono text-[8px] text-[#465c6f]">
                  {formatDate(file.updated_at)}
                </span>

                {/* 5. Size */}
                <span className="text-right font-mono text-[8px] text-[#465c6f]">
                  {file.is_folder ? '—' : formatBytes(file.size)}
                </span>

                {/* 6. Star Toggle */}
                <div className="flex items-center justify-end">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar(file);
                    }}
                    className={`transition-colors ${
                      file.is_starred
                        ? 'text-amber-400 opacity-100'
                        : 'text-[#3d5366] hover:text-white opacity-40 hover:opacity-100'
                    }`}
                    title={file.is_starred ? 'Starred' : 'Add to Starred'}
                  >
                    <Star size={11} fill={file.is_starred ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </div>
            );
          })}

          {!filtered.length && (
            <div className="grid h-48 place-items-center font-mono text-[9px] text-[#43586b]">
              No recent files found
            </div>
          )}
        </div>
      </div>
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.05] bg-white/[0.01] px-3 font-mono text-[8px] text-[#465c6f]">
        <span>{filtered.length} recent resources</span>
        <span>Double-click to preview</span>
      </div>
    </div>
  );
}
