import type { ReactNode } from 'react';
import {
  Download,
  Eye,
  File,
  FileText,
  Film,
  Folder,
  Image as ImageIcon,
  Info,
  Music,
  Star,
} from 'lucide-react';
import type { CloudFile } from '../types/cloudTypes';
import {
  formatBytes,
  formatDate,
  getFilePreviewType,
  getProviderName,
} from '../services/cloudClient';

interface CloudResourceInspectorProps {
  file: CloudFile | null;
  onPreviewFile?: (file: CloudFile) => void;
  onDownloadFile?: (file: CloudFile) => void;
  onShowDetails?: (file: CloudFile) => void;
  onToggleStar?: (file: CloudFile) => void;
  actions?: ReactNode;
}

function getFileIcon(file: CloudFile) {
  if (file.is_folder) return <Folder size={22} className="text-[#4aa3ff]" />;

  switch (getFilePreviewType(file.mime_type, file.file_name)) {
    case 'image':
      return <ImageIcon size={22} className="text-[#2ee6a6]" />;
    case 'video':
      return <Film size={22} className="text-[#e68c2e]" />;
    case 'audio':
      return <Music size={22} className="text-[#9334e6]" />;
    case 'pdf':
      return <FileText size={22} className="text-[#ef4444]" />;
    default:
      return <File size={22} className="text-[#7f95a8]" />;
  }
}

export default function CloudResourceInspector({
  file,
  onPreviewFile,
  onDownloadFile,
  onShowDetails,
  onToggleStar,
  actions,
}: CloudResourceInspectorProps) {
  return (
    <aside className="hidden w-48 shrink-0 border-l border-white/[0.06] bg-white/[0.01] p-3 md:block">
      <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#43586b]">
        Resource Inspector
      </div>

      {file ? (
        <div className="mt-4 space-y-3">
          <div className="grid h-16 place-items-center rounded border border-white/[0.05] bg-white/[0.015]">
            {getFileIcon(file)}
          </div>
          <div className="break-all text-[11px] font-medium text-[#d1deea]">{file.file_name}</div>
          <div className="space-y-1 font-mono text-[8px] leading-relaxed text-[#536a7d]">
            <div>TYPE: {file.is_folder ? 'Folder' : file.mime_type || 'File'}</div>
            <div>PATH: {file.virtual_path}</div>
            <div>SIZE: {file.is_folder ? '—' : formatBytes(file.size)}</div>
            <div>PROVIDER: {getProviderName(file.provider)}</div>
            <div className="break-all">PROVIDER ID: {file.email || 'Primary'}</div>
            <div className="break-all">ACCOUNT ID: {file.cloud_account_id}</div>
            <div className="break-all">REMOTE ID: {file.remote_file_id}</div>
            <div>MODIFIED: {formatDate(file.updated_at)}</div>
          </div>

          <div className="flex flex-col gap-1.5 pt-2">
            {!file.is_folder && onPreviewFile && (
              <button
                onClick={() => onPreviewFile(file)}
                className="flex w-full items-center justify-center gap-1 rounded border border-[#4aa3ff]/30 bg-[#4aa3ff]/10 py-1 font-mono text-[8px] uppercase tracking-wider text-[#93c7fa] hover:bg-[#4aa3ff]/20"
              >
                <Eye size={10} /> Preview
              </button>
            )}
            {!file.is_folder && onDownloadFile && (
              <button
                onClick={() => onDownloadFile(file)}
                className="flex w-full items-center justify-center gap-1 rounded border border-[#2ee6a6]/30 bg-[#2ee6a6]/10 py-1 font-mono text-[8px] uppercase tracking-wider text-[#79ecd4] hover:bg-[#2ee6a6]/20"
              >
                <Download size={10} /> Download
              </button>
            )}
            {onToggleStar && (
              <button
                onClick={() => onToggleStar(file)}
                className="flex w-full items-center justify-center gap-1 rounded border border-white/[0.06] bg-white/[0.02] py-1 font-mono text-[8px] uppercase tracking-wider text-[#8fa5b8] hover:bg-white/[0.05]"
              >
                <Star size={10} fill={file.is_starred ? 'currentColor' : 'none'} />
                {file.is_starred ? 'Unstar' : 'Add to Starred'}
              </button>
            )}
            {onShowDetails && (
              <button
                onClick={() => onShowDetails(file)}
                className="flex w-full items-center justify-center gap-1 rounded border border-white/[0.06] bg-white/[0.02] py-1 font-mono text-[8px] uppercase tracking-wider text-[#8fa5b8] hover:bg-white/[0.05]"
              >
                <Info size={10} /> Properties
              </button>
            )}
            {actions}
          </div>
        </div>
      ) : (
        <div className="mt-6 font-mono text-[8px] text-[#43586b]">Select a resource</div>
      )}
    </aside>
  );
}
