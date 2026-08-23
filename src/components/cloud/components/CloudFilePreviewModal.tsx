import { useEffect, useState } from 'react';
import {
  X,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Star,
  Loader2,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import type { CloudFile } from '../types/cloudTypes';
import {
  cloudApi,
  formatBytes,
  formatDate,
  getFilePreviewType,
  getProviderColor,
  getProviderName,
} from '../services/cloudClient';

interface PreviewModalProps {
  file: CloudFile | null;
  isOpen: boolean;
  onClose: () => void;
  onToggleStar?: (file: CloudFile) => void;
  onDownloadFile?: (file: CloudFile) => void;
}

export default function CloudFilePreviewModal({
  file,
  isOpen,
  onClose,
  onToggleStar,
  onDownloadFile,
}: PreviewModalProps) {
  if (!isOpen || !file) return null;

  const previewType = file.previewType || getFilePreviewType(file.mime_type, file.file_name);
  const providerName = getProviderName(file.provider);
  const providerColor = getProviderColor(file.provider);
  const previewUrl = cloudApi.getPreviewUrl(file.id);
  const downloadUrl = cloudApi.getDownloadUrl(file.id);

  const [docContent, setDocContent] = useState<string>('');
  const [docLoading, setDocLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setMediaError(false);
    setDownloadError(null);
    if (previewType === 'document') {
      setDocLoading(true);
      fetch(previewUrl, { credentials: 'include' })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((text) => {
          setDocContent(text);
          setDocLoading(false);
        })
        .catch(() => {
          setDocContent(
            `# ${file.file_name}\n\nVirtual Path: ${file.virtual_path}\nStorage Provider: ${providerName}\nAccount: ${file.email || 'Primary'}\nSize: ${formatBytes(file.size)}\nLast Modified: ${formatDate(file.updated_at)}\n\n[Live Stream Link Ready]`,
          );
          setDocLoading(false);
        });
    }
  }, [file.id, previewType, previewUrl, providerName]);

  const handleDownload = async () => {
    if (onDownloadFile) {
      onDownloadFile(file);
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(downloadUrl, { credentials: 'include' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(payload.error || `Download failed: HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.file_name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (err: any) {
      console.error('Download error:', err);
      setDownloadError(err.message || 'Download failed');
      // fallback
      window.open(downloadUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  const handleCopyText = () => {
    if (docContent) {
      navigator.clipboard.writeText(docContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#06090e] shadow-[0_24px_80px_rgba(0,0,0,0.9)] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.015] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-6 items-center gap-1 rounded border border-white/10 px-2 font-mono text-[9px] uppercase tracking-wider"
              style={{ backgroundColor: `${providerColor}15`, color: providerColor }}
            >
              {providerName}
            </div>
            <div className="truncate font-medium text-[12px] text-[#e3edf7]">{file.file_name}</div>
          </div>

          <div className="flex items-center gap-1.5">
            {onToggleStar && (
              <button
                onClick={() => onToggleStar(file)}
                className={`grid h-7 w-7 place-items-center rounded transition-colors ${
                  file.is_starred ? 'text-amber-400' : 'text-[#61788c] hover:text-[#bcd2e4]'
                }`}
                title={file.is_starred ? 'Starred' : 'Add to Starred'}
              >
                <Star size={13} fill={file.is_starred ? 'currentColor' : 'none'} />
              </button>
            )}
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-1.5 rounded border border-[#4aa3ff]/30 bg-[#4aa3ff]/15 px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-[#a5d2ff] hover:bg-[#4aa3ff]/25 transition-all disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Download size={11} />
              )}
              <span>{downloading ? 'Downloading...' : `Download (${formatBytes(file.size)})`}</span>
            </button>
            <button
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded text-[#6a8094] hover:bg-white/[0.05] hover:text-[#d5e4f0]"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {downloadError && (
          <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/10 px-4 py-2 font-mono text-[9px] text-red-300">
            <AlertCircle size={12} className="text-red-400" />
            <span>Error: {downloadError}</span>
          </div>
        )}

        {/* Content Viewer Area */}
        <div className="relative flex min-h-[380px] max-h-[68vh] flex-1 items-center justify-center overflow-auto bg-[#040609] p-4 os-scrollbar">
          {previewType === 'image' && !mediaError ? (
            <div className="relative flex max-h-[60vh] max-w-full items-center justify-center">
              <img
                src={previewUrl}
                alt={file.file_name}
                className="max-h-[58vh] max-w-full rounded-lg object-contain shadow-2xl transition-all"
                onError={() => setMediaError(true)}
              />
            </div>
          ) : previewType === 'video' && !mediaError ? (
            <div className="flex max-h-[60vh] w-full max-w-2xl flex-col items-center justify-center">
              <video
                src={previewUrl}
                controls
                autoPlay
                className="max-h-[58vh] w-full rounded-lg bg-black shadow-2xl"
                onError={() => setMediaError(true)}
              >
                Your browser does not support video playback.
              </video>
            </div>
          ) : previewType === 'audio' && !mediaError ? (
            <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-6 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-[#2ee6a6]/10 text-[#2ee6a6]">
                <Music size={28} />
              </div>
              <div>
                <div className="text-[13px] font-medium text-[#e3edf7]">{file.file_name}</div>
                <div className="mt-1 font-mono text-[9px] text-[#587388]">
                  {providerName} · {formatBytes(file.size)}
                </div>
              </div>
              <audio
                src={previewUrl}
                controls
                autoPlay
                className="mt-2 w-full"
                onError={() => setMediaError(true)}
              />
            </div>
          ) : previewType === 'pdf' ? (
            <iframe
              src={previewUrl}
              title={file.file_name}
              className="h-[60vh] w-full rounded-lg border border-white/[0.06] bg-white"
            />
          ) : previewType === 'document' ? (
            <div className="relative h-full w-full">
              {docLoading ? (
                <div className="flex h-64 items-center justify-center gap-2 font-mono text-[10px] text-[#6d8599]">
                  <Loader2 size={16} className="animate-spin text-[#4aa3ff]" />
                  Loading document stream...
                </div>
              ) : (
                <>
                  <div className="absolute right-3 top-3 z-10">
                    <button
                      onClick={handleCopyText}
                      className="flex items-center gap-1 rounded border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-[8px] text-[#a0bad0] backdrop-blur hover:bg-white/10"
                    >
                      {copied ? <Check size={10} className="text-[#2ee6a6]" /> : <Copy size={10} />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <pre className="h-full max-h-[58vh] w-full overflow-auto rounded border border-white/[0.06] bg-black/50 p-4 font-mono text-[11px] leading-relaxed text-[#a8c6df] os-scrollbar">
                    {docContent}
                  </pre>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-full border border-white/[0.06] bg-white/[0.02] text-[#6d889e]">
                <FileText size={28} />
              </div>
              <div className="font-medium text-[12px] text-[#dce7f2]">{file.file_name}</div>
              <div className="font-mono text-[9px] text-[#556f84]">
                {file.mime_type || 'Binary Data'} · {formatBytes(file.size)}
              </div>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="mt-2 flex items-center gap-1.5 rounded border border-[#4aa3ff]/30 bg-[#4aa3ff]/15 px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-[#a5d2ff] hover:bg-[#4aa3ff]/25"
              >
                {downloading ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Download size={11} />
                )}
                <span>Download File</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between border-t border-white/[0.05] bg-white/[0.01] px-4 py-2 font-mono text-[8px] text-[#4d667a]">
          <div className="flex items-center gap-4">
            <span>LOCATION: {file.virtual_path}</span>
            <span>ACCOUNT: {file.email || 'Primary'}</span>
          </div>
          <div>MODIFIED: {formatDate(file.updated_at)}</div>
        </div>
      </div>
    </div>
  );
}
