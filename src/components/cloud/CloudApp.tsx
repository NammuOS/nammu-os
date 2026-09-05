import { useState, useEffect, useCallback, useMemo } from 'react';
import { UploadCloud } from 'lucide-react';
import type {
  AllocationConfig,
  CloudAccount,
  CloudProvider,
  CloudFile,
  CloudNavSection,
  StorageStats,
  UploadTask,
} from './types/cloudTypes';
import { cloudApi } from './services/cloudClient';
import { getPlatformCapabilities } from '../../platform';

import CloudSidebar from './CloudSidebar';
import CloudHomeView from './views/CloudHomeView';
import CloudMyDriveView from './views/CloudMyDriveView';
import CloudSharedView from './views/CloudSharedView';
import CloudRecentView from './views/CloudRecentView';
import CloudStarredView from './views/CloudStarredView';
import CloudTrashView from './views/CloudTrashView';

import CloudConnectModal from './components/CloudConnectModals';
import CloudFilePreviewModal from './components/CloudFilePreviewModal';
import CloudFileDetailsModal from './components/CloudFileDetailsModal';
import CloudUploadToast from './components/CloudUploadToast';

export default function CloudApp() {
  const [section, setSection] = useState<CloudNavSection>('home');
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [currentPathFiles, setCurrentPathFiles] = useState<CloudFile[]>([]);
  const [recentFiles, setRecentFiles] = useState<CloudFile[]>([]);
  const [starredFiles, setStarredFiles] = useState<CloudFile[]>([]);
  const [sharedFiles, setSharedFiles] = useState<CloudFile[]>([]);
  const [trashFiles, setTrashFiles] = useState<CloudFile[]>([]);
  const [allocation, setAllocation] = useState<AllocationConfig>({ strategy: 'round_robin' });

  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  // Modals
  const [previewFile, setPreviewFile] = useState<CloudFile | null>(null);
  const [detailsFile, setDetailsFile] = useState<CloudFile | null>(null);
  const [connectProvider, setConnectProvider] = useState<CloudProvider | null>(null);

  // Storage Stats
  const stats: StorageStats = useMemo(() => {
    return cloudApi.getStorageStats(accounts);
  }, [accounts]);

  // Data Loading
  const loadData = useCallback(async () => {
    try {
      const [accs, alloc, recents, starred, shared, trashed] = await Promise.all([
        cloudApi.listAccounts(),
        cloudApi.getAllocation(),
        cloudApi.listRecentFiles(),
        cloudApi.listStarredFiles(),
        cloudApi.listSharedFiles(),
        cloudApi.listTrashFiles(),
      ]);
      setAccounts(accs);
      setAllocation(alloc);
      setRecentFiles(recents);
      setStarredFiles(starred);
      setSharedFiles(shared);
      setTrashFiles(trashed);
    } catch (e) {
      console.error('Failed to load Cloud data:', e);
    }
  }, []);

  const loadPathFiles = useCallback(async (path: string) => {
    try {
      const f = await cloudApi.listFiles(path);
      setCurrentPathFiles(f);
    } catch (e) {
      console.error('Failed to load files for path:', path, e);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadPathFiles(currentPath);
  }, [currentPath, loadPathFiles]);

  // Actions
  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await cloudApi.runSync();
      await loadData();
      await loadPathFiles(currentPath);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateFolder = async (name: string, accountId?: string, provider?: CloudProvider) => {
    try {
      const task: UploadTask = {
        id: `task-${Date.now()}`,
        name: `Creating folder "${name}"`,
        type: 'create-folder',
        status: 'processing',
        progress_percentage: 50,
      };
      setTasks((prev) => [task, ...prev]);

      await cloudApi.createFolder(currentPath, name, accountId, provider);
      await loadPathFiles(currentPath);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: 'completed', progress_percentage: 100 } : t,
        ),
      );
    } catch (e: any) {
      console.error('Failed to create folder:', e);
    }
  };

  const handleUploadFiles = async (
    filesToUpload: File[],
    accountId?: string,
    provider?: CloudProvider,
  ) => {
    for (const file of filesToUpload) {
      const taskId = `up-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newTask: UploadTask = {
        id: taskId,
        name: file.name,
        size: file.size,
        type: 'upload',
        status: 'uploading',
        progress_percentage: 10,
      };

      setTasks((prev) => [newTask, ...prev]);

      try {
        await cloudApi.initiateAndUpload(
          file,
          currentPath,
          (percent) => {
            setTasks((prev) =>
              prev.map((t) => (t.id === taskId ? { ...t, progress_percentage: percent } : t)),
            );
          },
          accountId,
          provider,
        );

        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: 'completed', progress_percentage: 100 } : t,
          ),
        );
      } catch (err: any) {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: 'failed', error: err?.message } : t)),
        );
      }
    }

    await loadData();
    await loadPathFiles(currentPath);
  };

  const handleDownloadFile = async (file: CloudFile) => {
    const taskId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newTask: UploadTask = {
      id: taskId,
      name: file.file_name,
      size: file.size,
      type: 'download',
      status: 'downloading',
      progress_percentage: 5,
    };

    setTasks((prev) => [newTask, ...prev]);

    try {
      const blob = await cloudApi.downloadFileWithProgress(file, (percent) => {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, progress_percentage: percent } : t)),
        );
      });

      const platform = getPlatformCapabilities();
      if (platform.runtime === 'tauri') {
        const saved = await platform.files.save({
          suggestedName: file.file_name,
          contents: new Uint8Array(await blob.arrayBuffer()),
          mimeType: blob.type || file.mime_type,
        });
        if (saved.status === 'cancelled') {
          throw new DOMException('Download cancelled.', 'AbortError');
        }
        if (saved.status !== 'success') {
          throw new Error('Nammu could not save the downloaded file.');
        }
      } else {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = file.file_name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
      }

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: 'completed', progress_percentage: 100 } : t,
        ),
      );
    } catch (err: any) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: err?.name === 'AbortError' ? 'cancelled' : 'failed',
                error: err?.name === 'AbortError' ? undefined : err?.message,
              }
            : t,
        ),
      );
    }
  };

  const handleRenameFile = async (fileId: string, newName: string) => {
    await cloudApi.renameFile(fileId, newName);
    await loadPathFiles(currentPath);
    await loadData();
  };

  const handleDeleteFile = async (fileId: string) => {
    await cloudApi.deleteFile(fileId);
    await loadPathFiles(currentPath);
    await loadData();
  };

  const handleBulkDelete = async (fileIds: string[]) => {
    await cloudApi.bulkDelete(fileIds);
    await loadPathFiles(currentPath);
    await loadData();
  };

  const handleToggleStar = async (file: CloudFile) => {
    const nextVal = !file.is_starred;
    await cloudApi.toggleStar(file.id, nextVal);
    await loadPathFiles(currentPath);
    await loadData();
  };

  const handleRestoreFile = async (fileId: string) => {
    await cloudApi.restoreFile(fileId);
    await loadData();
    await loadPathFiles(currentPath);
  };

  const handleDeletePermanently = async (fileId: string) => {
    await cloudApi.deleteFilePermanently(fileId);
    await loadData();
  };

  const handleEmptyTrash = async () => {
    await cloudApi.emptyTrash();
    await loadData();
  };

  useEffect(() => {
    const handleOAuthPayload = async (payload: unknown) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'type' in payload &&
        payload.type === 'cloud_oauth_complete'
      ) {
        await loadData();
        await loadPathFiles(currentPath);
        setConnectProvider(null);
      }
    };

    const handleOAuthMessage = (e: MessageEvent) => void handleOAuthPayload(e.data);
    const oauthChannel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('nammu-cloud-oauth');

    if (oauthChannel) {
      oauthChannel.onmessage = (e) => void handleOAuthPayload(e.data);
    }

    window.addEventListener('message', handleOAuthMessage);
    return () => {
      window.removeEventListener('message', handleOAuthMessage);
      oauthChannel?.close();
    };
  }, [currentPath, loadData, loadPathFiles]);

  const handleConnectProvider = async (
    provider: CloudProvider,
    data: any,
    signal?: AbortSignal,
  ) => {
    const isOAuth = ['google_drive', 'onedrive', 'dropbox', 'yandex'].includes(provider);
    if (isOAuth) {
      const platform = getPlatformCapabilities();
      const service = await platform.services.ready();
      if (service.runtime === 'desktop-local') {
        if (provider !== 'google_drive') {
          throw new Error('Only Google Drive desktop authorization is available right now.');
        }
        const attempt = await cloudApi.startDesktopOAuth('google_drive', data?.label);
        const opened = await platform.external.openUrl(attempt.authorizationUrl);
        if (opened.status !== 'success') {
          await cloudApi.cancelDesktopOAuth(attempt.attemptId).catch(() => undefined);
          throw new Error(
            opened.status === 'cancelled'
              ? 'Google Drive authorization was cancelled.'
              : 'Nammu could not open the system browser for Google authorization.',
          );
        }

        const poll = async () => {
          while (!signal?.aborted) {
            const status = await cloudApi.getDesktopOAuthStatus(attempt.attemptId);
            if (status.status === 'completed') return status;
            if (['cancelled', 'expired', 'failed'].includes(status.status)) {
              throw new Error(status.error?.message || 'Google Drive was not connected.');
            }
            await new Promise<void>((resolve, reject) => {
              const timer = window.setTimeout(resolve, 700);
              signal?.addEventListener(
                'abort',
                () => {
                  window.clearTimeout(timer);
                  reject(new DOMException('Authorization cancelled.', 'AbortError'));
                },
                { once: true },
              );
            });
          }
          throw new DOMException('Authorization cancelled.', 'AbortError');
        };

        try {
          await poll();
        } catch (error) {
          if (signal?.aborted) {
            await cloudApi.cancelDesktopOAuth(attempt.attemptId).catch(() => undefined);
          }
          throw error;
        }
        await loadData();
        await loadPathFiles(currentPath);
        return;
      }

      const width = 560;
      const height = 680;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        'about:blank',
        `Connect_${provider}`,
        `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes`,
      );

      try {
        const authUrl = await cloudApi.getOAuthConnectUrl(provider);
        if (popup) {
          popup.location.href = authUrl;
        } else {
          window.location.href = authUrl;
        }
      } catch (err: any) {
        if (popup) popup.close();
        throw err;
      }
      return;
    }

    await cloudApi.connectAccount(provider, data);
    await loadData();
    await loadPathFiles(currentPath);
  };

  const handleDisconnectAccount = async (accountId: string) => {
    await cloudApi.disconnectAccount(accountId);
    await loadData();
  };

  const handleUpdateAllocation = async (config: AllocationConfig) => {
    await cloudApi.updateAllocation(config);
    setAllocation(config);
  };

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    const handledByActiveView = e.defaultPrevented;
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (handledByActiveView) return;
    const droppedFiles = Array.from(e.dataTransfer.files || []);
    if (droppedFiles.length) {
      if (section !== 'my-drive') setSection('my-drive');
      handleUploadFiles(droppedFiles);
    }
  };

  return (
    <div
      className="relative flex h-full w-full select-none overflow-hidden bg-[#05080d] text-[11px] text-[#c5d2de]"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Global Drag & Drop Overlay */}
      {isDragActive && (
        <div className="absolute inset-0 z-[9999] flex flex-col items-center justify-center bg-[#070e18]/90 p-8 backdrop-blur-md border-2 border-dashed border-[#4aa3ff]/60">
          <UploadCloud size={48} className="text-[#4aa3ff] animate-bounce" />
          <div className="mt-3 font-medium text-[14px] text-white">
            Drop files to stream into the Cloud
          </div>
          <div className="mt-1 font-mono text-[9px] text-[#749bb8]">
            Target Path: {currentPath} · Automated Allocation Active
          </div>
        </div>
      )}

      {/* Left Sidebar */}
      <CloudSidebar currentSection={section} onSelectSection={(s) => setSection(s)} stats={stats} />

      {/* Main View Router */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {section === 'home' && (
          <CloudHomeView
            stats={stats}
            accounts={accounts}
            allocation={allocation}
            onNavigate={(sec) => setSection(sec)}
            onOpenFile={(file) => {
              if (file.is_folder) {
                setCurrentPath(`${file.virtual_path}${file.file_name}/`);
                setSection('my-drive');
              } else {
                setPreviewFile(file);
              }
            }}
            onOpenConnect={(p) => setConnectProvider(p || 'google_drive')}
            onDisconnectAccount={handleDisconnectAccount}
            onUpdateAllocation={handleUpdateAllocation}
            onSync={handleSync}
            isSyncing={isSyncing}
          />
        )}

        {section === 'my-drive' && (
          <CloudMyDriveView
            accounts={accounts}
            currentPath={currentPath}
            files={currentPathFiles}
            onNavigatePath={(p) => setCurrentPath(p)}
            onCreateFolder={handleCreateFolder}
            onUploadFiles={handleUploadFiles}
            onRenameFile={handleRenameFile}
            onDeleteFile={handleDeleteFile}
            onBulkDelete={handleBulkDelete}
            onToggleStar={handleToggleStar}
            onPreviewFile={(f) => setPreviewFile(f)}
            onShowDetails={(f) => setDetailsFile(f)}
            onDownloadFile={handleDownloadFile}
            onRefresh={() => {
              loadPathFiles(currentPath);
              loadData();
            }}
          />
        )}

        {section === 'shared-with-me' && (
          <CloudSharedView
            files={sharedFiles}
            onOpenFolder={(file) => cloudApi.listSharedFiles(file.id)}
            onPreviewFile={(f) => setPreviewFile(f)}
            onDownloadFile={handleDownloadFile}
            onShowDetails={(f) => setDetailsFile(f)}
            onToggleStar={handleToggleStar}
          />
        )}

        {section === 'recent' && (
          <CloudRecentView
            files={recentFiles}
            onOpenFile={(file) => {
              setCurrentPath(`${file.virtual_path}${file.file_name}/`);
              setSection('my-drive');
            }}
            onPreviewFile={(f) => setPreviewFile(f)}
            onDownloadFile={handleDownloadFile}
            onShowDetails={(f) => setDetailsFile(f)}
            onToggleStar={handleToggleStar}
          />
        )}

        {section === 'starred' && (
          <CloudStarredView
            files={starredFiles}
            onOpenFile={(file) => {
              setCurrentPath(`${file.virtual_path}${file.file_name}/`);
              setSection('my-drive');
            }}
            onPreviewFile={(f) => setPreviewFile(f)}
            onDownloadFile={handleDownloadFile}
            onShowDetails={(f) => setDetailsFile(f)}
            onToggleStar={handleToggleStar}
          />
        )}

        {section === 'trash' && (
          <CloudTrashView
            files={trashFiles}
            onRestore={handleRestoreFile}
            onDeletePermanently={handleDeletePermanently}
            onEmptyTrash={handleEmptyTrash}
            onShowDetails={(f) => setDetailsFile(f)}
          />
        )}
      </main>

      {/* Floating Upload Progress Toast */}
      <CloudUploadToast tasks={tasks} onDismiss={() => setTasks([])} />

      {/* Modals */}
      <CloudConnectModal
        provider={connectProvider}
        isOpen={Boolean(connectProvider)}
        onClose={() => setConnectProvider(null)}
        onConnect={handleConnectProvider}
      />

      <CloudFilePreviewModal
        file={previewFile}
        isOpen={Boolean(previewFile)}
        onClose={() => setPreviewFile(null)}
        onToggleStar={handleToggleStar}
        onDownloadFile={handleDownloadFile}
      />

      <CloudFileDetailsModal
        file={detailsFile}
        isOpen={Boolean(detailsFile)}
        onClose={() => setDetailsFile(null)}
      />
    </div>
  );
}
