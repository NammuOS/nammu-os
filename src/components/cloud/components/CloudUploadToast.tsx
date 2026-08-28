import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  X,
  Check,
  Upload,
  Download,
  FolderPlus,
  Edit3,
  Trash2,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { UploadTask } from '../types/cloudTypes';

interface UploadToastProps {
  tasks: UploadTask[];
  onDismiss: () => void;
}

export default function CloudUploadToast({ tasks, onDismiss }: UploadToastProps) {
  const [minimized, setMinimized] = useState(false);

  if (!tasks.length) return null;

  const activeCount = tasks.filter(
    (t) => !['completed', 'failed', 'cancelled'].includes(t.status),
  ).length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  const avgProgress = Math.round(
    tasks.reduce((sum, t) => sum + (t.progress_percentage || 0), 0) / tasks.length,
  );

  const getTaskIcon = (type: UploadTask['type']) => {
    switch (type) {
      case 'upload':
        return <Upload size={12} className="text-[#4aa3ff]" />;
      case 'download':
        return <Download size={12} className="text-[#2ee6a6]" />;
      case 'create-folder':
        return <FolderPlus size={12} className="text-[#6ec8d4]" />;
      case 'rename':
        return <Edit3 size={12} className="text-amber-400" />;
      case 'delete':
        return <Trash2 size={12} className="text-red-400" />;
      default:
        return <Upload size={12} className="text-[#4aa3ff]" />;
    }
  };

  const titleText =
    activeCount > 0
      ? `Cloud Stream: ${activeCount} transfer${activeCount > 1 ? 's' : ''}`
      : failedCount > 0
        ? `Stream warning (${failedCount} failed)`
        : `Cloud transfer complete (${completedCount})`;

  return (
    <div className="absolute bottom-3 right-3 z-[60] w-80 overflow-hidden rounded-xl border border-white/[0.08] bg-[#070b12]/95 shadow-[0_16px_40px_rgba(0,0,0,0.85)] backdrop-blur-2xl transition-all">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          {activeCount > 0 ? (
            <Loader2 size={13} className="animate-spin text-[#4aa3ff]" />
          ) : (
            <Check size={13} className="text-[#2ee6a6]" />
          )}
          <span className="font-mono text-[10px] font-medium tracking-wide text-[#dce7f2]">
            {titleText}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(!minimized)}
            className="grid h-5 w-5 place-items-center rounded text-[#647c90] hover:bg-white/[0.04] hover:text-[#d0e0ed]"
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button
            onClick={onDismiss}
            className="grid h-5 w-5 place-items-center rounded text-[#647c90] hover:bg-white/[0.04] hover:text-[#d0e0ed]"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Progress Bar Header */}
      {!minimized && (
        <div className="space-y-1.5 border-b border-white/[0.04] bg-white/[0.008] px-3.5 py-2">
          <div className="flex justify-between font-mono text-[8px] text-[#556f84]">
            <span>{activeCount ? 'STREAMING DATA' : 'FINISHED'}</span>
            <span className="text-[#4aa3ff]">{avgProgress}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full bg-[#4aa3ff] transition-all duration-200 shadow-[0_0_8px_rgba(74,163,255,0.7)]"
              style={{ width: `${avgProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Task List */}
      {!minimized && (
        <div className="max-h-48 overflow-y-auto p-1.5 os-scrollbar">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="group flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[10px] hover:bg-white/[0.025]"
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="grid h-5 w-5 place-items-center rounded bg-white/[0.04]">
                  {getTaskIcon(task.type)}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-mono text-[9px] text-[#cfe0ee]">
                    {task.fromName && task.toName ? `${task.fromName} → ${task.toName}` : task.name}
                  </div>
                  <div className="font-mono text-[8px] text-[#4d667a]">
                    {task.status === 'completed'
                      ? 'Synced'
                      : task.status === 'failed'
                        ? task.error || 'Failed'
                        : `${task.progress_percentage}%`}
                  </div>
                </div>
              </div>

              <div>
                {task.status === 'completed' ? (
                  <Check size={12} className="text-[#2ee6a6]" />
                ) : task.status === 'failed' ? (
                  <AlertCircle size={12} className="text-red-400" />
                ) : (
                  <Loader2 size={12} className="animate-spin text-[#4aa3ff]" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
