import { X, FileText, Folder } from 'lucide-react';
import type { CloudFile } from '../types/cloudTypes';
import {
  formatBytes,
  formatDate,
  getProviderColor,
  getProviderName,
} from '../services/cloudClient';

interface DetailsModalProps {
  file: CloudFile | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function CloudFileDetailsModal({ file, isOpen, onClose }: DetailsModalProps) {
  if (!isOpen || !file) return null;

  const providerName = getProviderName(file.provider);
  const providerColor = getProviderColor(file.provider);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-white/[0.08] bg-[#070b12] text-[#d5e0ea] shadow-[0_24px_70px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.015] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-6 w-6 place-items-center rounded bg-[#4aa3ff]/10 text-[#4aa3ff]">
              {file.is_folder ? <Folder size={13} /> : <FileText size={13} />}
            </div>
            <span className="font-medium text-[12px] text-[#e3edf7]">Resource Properties</span>
          </div>
          <button
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded text-[#6a8094] hover:bg-white/[0.05] hover:text-[#d5e4f0]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-4 p-5 text-[11px]">
          {/* File Name & Provider Pill */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3.5">
            <div className="break-all font-medium text-[13px] text-white">{file.file_name}</div>
            <div className="mt-2 flex items-center gap-2">
              <span
                className="rounded border border-white/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider"
                style={{ backgroundColor: `${providerColor}15`, color: providerColor }}
              >
                {providerName}
              </span>
              <span className="font-mono text-[9px] text-[#556f84]">
                {file.email || 'operator'}
              </span>
            </div>
          </div>

          <div className="space-y-2 font-mono text-[10px]">
            <div className="flex justify-between border-b border-white/[0.04] py-1.5">
              <span className="text-[#556f84]">Resource Type</span>
              <span className="text-[#c5d6e6]">
                {file.is_folder ? 'Directory' : file.mime_type || 'File'}
              </span>
            </div>
            <div className="flex justify-between border-b border-white/[0.04] py-1.5">
              <span className="text-[#556f84]">Size</span>
              <span className="text-[#c5d6e6]">
                {file.is_folder ? '—' : formatBytes(file.size)}
              </span>
            </div>
            <div className="flex justify-between border-b border-white/[0.04] py-1.5">
              <span className="text-[#556f84]">Virtual Path</span>
              <span className="text-[#c5d6e6]">{file.virtual_path}</span>
            </div>
            <div className="flex justify-between border-b border-white/[0.04] py-1.5">
              <span className="text-[#556f84]">Provider ID</span>
              <span className="max-w-[200px] truncate text-[#c5d6e6]" title={file.email}>
                {file.email || 'Primary'}
              </span>
            </div>
            <div className="flex justify-between border-b border-white/[0.04] py-1.5">
              <span className="text-[#556f84]">Account ID</span>
              <span className="max-w-[200px] truncate text-[#86a2ba]" title={file.cloud_account_id}>
                {file.cloud_account_id}
              </span>
            </div>
            <div className="flex justify-between border-b border-white/[0.04] py-1.5">
              <span className="text-[#556f84]">Remote File ID</span>
              <span className="truncate max-w-[200px] text-[#86a2ba]">
                {file.remote_file_id || 'synced-node'}
              </span>
            </div>
            <div className="flex justify-between border-b border-white/[0.04] py-1.5">
              <span className="text-[#556f84]">Last Modified</span>
              <span className="text-[#c5d6e6]">{formatDate(file.updated_at)}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-[#556f84]">Created Time</span>
              <span className="text-[#c5d6e6]">{formatDate(file.created_at)}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-white/[0.06] bg-white/[0.01] px-5 py-3 text-right">
          <button
            onClick={onClose}
            className="rounded border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 font-mono text-[9px] uppercase tracking-wider text-[#8da6bc] hover:bg-white/[0.06] hover:text-[#dbe7f2]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
