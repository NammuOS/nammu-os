import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Edit3,
  Eye,
  File,
  FileText,
  Film,
  Filter,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  Image as ImageIcon,
  Info,
  List,
  Loader2,
  Music,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { CloudAccount, CloudFile, CloudProvider } from '../types/cloudTypes';
import {
  cloudApi,
  formatBytes,
  formatDate,
  getFilePreviewType,
  getProviderColor,
  getProviderName,
} from '../services/cloudClient';

interface MyDriveViewProps {
  accounts: CloudAccount[];
  currentPath: string;
  files: CloudFile[];
  onNavigatePath: (path: string) => void;
  onCreateFolder: (name: string, accountId?: string, provider?: CloudProvider) => Promise<void>;
  onUploadFiles: (files: File[], accountId?: string, provider?: CloudProvider) => Promise<void>;
  onRenameFile: (fileId: string, newName: string) => Promise<void>;
  onDeleteFile: (fileId: string) => Promise<void>;
  onBulkDelete: (fileIds: string[]) => Promise<void>;
  onToggleStar: (file: CloudFile) => Promise<void>;
  onPreviewFile: (file: CloudFile) => void;
  onShowDetails: (file: CloudFile) => void;
  onDownloadFile?: (file: CloudFile) => void;
  onRefresh: () => void;
}

const ALL_PROVIDERS: { id: CloudProvider; name: string }[] = [
  { id: 'google_drive', name: 'Google Drive' },
  { id: 'onedrive', name: 'OneDrive' },
  { id: 'dropbox', name: 'Dropbox' },
  { id: 'mega', name: 'MEGA' },
  { id: 'pcloud', name: 'pCloud' },
  { id: 'yandex', name: 'Yandex Disk' },
  { id: 's3', name: 'S3-Compatible Storage' },
];

type SortColumn = 'name' | 'provider' | 'type' | 'modified' | 'size';
type SortDirection = 'asc' | 'desc';

interface ContextMenuState {
  x: number;
  y: number;
  file: CloudFile;
}

export default function CloudMyDriveView({
  accounts,
  currentPath,
  files,
  onNavigatePath,
  onCreateFolder,
  onUploadFiles,
  onRenameFile,
  onDeleteFile,
  onBulkDelete,
  onToggleStar,
  onPreviewFile,
  onShowDetails,
  onDownloadFile,
  onRefresh,
}: MyDriveViewProps) {
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CloudFile[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<CloudProvider | 'all'>(
    'all',
  );
  const [selectedAccountFilter, setSelectedAccountFilter] = useState<string | 'all'>('all');
  const [expandedProviderFilter, setExpandedProviderFilter] = useState<CloudProvider | null>(null);
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [isUploadTargetOpen, setIsUploadTargetOpen] = useState(false);
  const [uploadTargetAccountId, setUploadTargetAccountId] = useState<'context' | 'auto' | string>(
    'context',
  );

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Selection & Active
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  // Context Menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Modals / Inputs
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFile, setRenamingFile] = useState<CloudFile | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const uploadTargetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dismissPopups = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!filterDropdownRef.current?.contains(target)) {
        setIsFilterDropdownOpen(false);
        setExpandedProviderFilter(null);
      }
      if (!uploadTargetRef.current?.contains(target)) setIsUploadTargetOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsFilterDropdownOpen(false);
      setExpandedProviderFilter(null);
      setIsUploadTargetOpen(false);
    };
    document.addEventListener('pointerdown', dismissPopups, true);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissPopups, true);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, []);

  // Global / Subfolder search across entire cloud database
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await cloudApi.searchFiles(query);
        setSearchResults(results);
      } catch (err) {
        console.error('Search across folders failed:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Base displayed files before provider filtering
  const rawDisplayedFiles = searchResults !== null ? searchResults : files;

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountFilter) || null,
    [accounts, selectedAccountFilter],
  );
  const hasActiveProviderFilter =
    selectedProviderFilter !== 'all' || selectedAccountFilter !== 'all';
  const activeFilterLabel = selectedAccount
    ? selectedAccount.email
    : selectedProviderFilter !== 'all'
      ? getProviderName(selectedProviderFilter)
      : 'All Providers';
  const connectedProviderCount = useMemo(
    () => accounts.filter((account) => account.status === 'active').length,
    [accounts],
  );
  const explicitUploadAccount = accounts.find((account) => account.id === uploadTargetAccountId);
  const effectiveUploadAccount =
    uploadTargetAccountId === 'context'
      ? selectedAccount
      : uploadTargetAccountId === 'auto'
        ? null
        : explicitUploadAccount || null;
  const explicitUploadProvider = uploadTargetAccountId.startsWith('provider:')
    ? (uploadTargetAccountId.slice('provider:'.length) as CloudProvider)
    : null;
  const effectiveUploadProvider = effectiveUploadAccount
    ? undefined
    : explicitUploadProvider ||
      (uploadTargetAccountId === 'context' && selectedProviderFilter !== 'all'
        ? selectedProviderFilter
        : undefined);
  const uploadTargetLabel = effectiveUploadAccount
    ? effectiveUploadAccount.email
    : explicitUploadProvider
      ? `Any ${getProviderName(explicitUploadProvider)}`
      : uploadTargetAccountId === 'context' && selectedProviderFilter !== 'all'
        ? `Smart · ${getProviderName(selectedProviderFilter)}`
        : 'Smart allocation';

  useEffect(() => {
    if (selectedAccountFilter !== 'all' && !selectedAccount) {
      setSelectedAccountFilter('all');
    }
  }, [selectedAccount, selectedAccountFilter]);

  useEffect(() => {
    if (
      uploadTargetAccountId !== 'context' &&
      uploadTargetAccountId !== 'auto' &&
      !uploadTargetAccountId.startsWith('provider:') &&
      !explicitUploadAccount
    ) {
      setUploadTargetAccountId('context');
    }
  }, [explicitUploadAccount, uploadTargetAccountId]);

  // Filtered by provider and then by a specific connected account when selected.
  const providerFilteredFiles = useMemo(() => {
    return rawDisplayedFiles.filter((file) => {
      if (selectedProviderFilter !== 'all' && file.provider !== selectedProviderFilter) {
        return false;
      }
      if (selectedAccountFilter !== 'all' && file.cloud_account_id !== selectedAccountFilter) {
        return false;
      }
      return true;
    });
  }, [rawDisplayedFiles, selectedAccountFilter, selectedProviderFilter]);

  // Sorted displayed files
  const displayedFiles = useMemo(() => {
    return [...providerFilteredFiles].sort((a, b) => {
      // Folders always pinned to top
      if (a.is_folder && !b.is_folder) return -1;
      if (!a.is_folder && b.is_folder) return 1;

      let compareVal = 0;
      const nameA = a.file_name || (a as any).name || '';
      const nameB = b.file_name || (b as any).name || '';

      switch (sortColumn) {
        case 'name':
          compareVal = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
          break;
        case 'provider':
          compareVal = (a.provider || '').localeCompare(b.provider || '');
          break;
        case 'type':
          compareVal = (a.mime_type || '').localeCompare(b.mime_type || '');
          break;
        case 'modified': {
          const timeA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
          const timeB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
          compareVal = timeA - timeB;
          break;
        }
        case 'size':
          compareVal = (Number(a.size) || 0) - (Number(b.size) || 0);
          break;
      }
      return sortDirection === 'asc' ? compareVal : -compareVal;
    });
  }, [providerFilteredFiles, sortColumn, sortDirection]);

  // Toggle sort column
  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  // Breadcrumbs calculation
  const breadcrumbParts = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean);
    const crumbs = [{ label: 'My Drive', path: '/' }];
    let acc = '/';
    for (const part of parts) {
      acc += `${part}/`;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }, [currentPath]);

  const activeFile = displayedFiles.find((f) => f.id === activeFileId);

  const selectAll = () => {
    if (selectedIds.size === displayedFiles.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedFiles.map((f) => f.id)));
    }
  };

  const handleItemClick = (file: CloudFile, e?: React.MouseEvent) => {
    setContextMenu(null);
    if (e?.ctrlKey || e?.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(file.id)) next.delete(file.id);
        else next.add(file.id);
        return next;
      });
    } else {
      setActiveFileId(file.id);
    }
  };

  const handleItemDoubleClick = useCallback(
    (file: CloudFile) => {
      setContextMenu(null);
      if (file.is_folder) {
        if (selectedAccountFilter === 'all' && file.provider) {
          setSelectedProviderFilter(file.provider);
          setSelectedAccountFilter(file.cloud_account_id);
        }
        const nextPath = `${file.virtual_path}${file.file_name}/`;
        setSearchQuery('');
        setSearchResults(null);
        onNavigatePath(nextPath);
      } else {
        onPreviewFile(file);
      }
    },
    [onNavigatePath, onPreviewFile, selectedAccountFilter],
  );

  const handleContextMenu = (e: React.MouseEvent, file: CloudFile) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveFileId(file.id);

    const rect = containerRef.current?.getBoundingClientRect();
    const offsetX = rect ? e.clientX - rect.left : e.clientX;
    const offsetY = rect ? e.clientY - rect.top : e.clientY;

    setContextMenu({
      x: Math.min(offsetX, (rect?.width || 800) - 180),
      y: Math.min(offsetY, (rect?.height || 600) - 220),
      file,
    });
  };

  const handleDownloadFile = async (file: CloudFile) => {
    if (onDownloadFile) {
      onDownloadFile(file);
      return;
    }
    try {
      const blob = await cloudApi.downloadFileWithProgress(file, () => undefined);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.file_name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch {}
  };

  const handleBulkDownload = () => {
    const selectedFiles = displayedFiles.filter((f) => selectedIds.has(f.id) && !f.is_folder);
    for (const f of selectedFiles) {
      handleDownloadFile(f);
    }
  };

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isNewFolderOpen || renamingFile) return;

      if (e.key === 'Escape') {
        setContextMenu(null);
        setSelectedIds(new Set());
        if (searchQuery) {
          setSearchQuery('');
          setSearchResults(null);
        }
        return;
      }

      if (!displayedFiles.length) return;

      const currentIndex = displayedFiles.findIndex((f) => f.id === activeFileId);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = currentIndex < displayedFiles.length - 1 ? currentIndex + 1 : 0;
        setActiveFileId(displayedFiles[nextIndex].id);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : displayedFiles.length - 1;
        setActiveFileId(displayedFiles[prevIndex].id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeFile) handleItemDoubleClick(activeFile);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) {
          onBulkDelete(Array.from(selectedIds));
          setSelectedIds(new Set());
        } else if (activeFile) {
          onDeleteFile(activeFile.id);
        }
      }
    },
    [
      activeFile,
      activeFileId,
      displayedFiles,
      handleItemDoubleClick,
      isNewFolderOpen,
      onDeleteFile,
      onBulkDelete,
      renamingFile,
      searchQuery,
      selectedIds,
    ],
  );

  const submitCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await onCreateFolder(newFolderName.trim(), effectiveUploadAccount?.id, effectiveUploadProvider);
    setNewFolderName('');
    setIsNewFolderOpen(false);
  };

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingFile || !renameValue.trim()) return;
    await onRenameFile(renamingFile.id, renameValue.trim());
    setRenamingFile(null);
    setRenameValue('');
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploaded = Array.from(e.target.files || []);
    if (uploaded.length) {
      onUploadFiles(uploaded, effectiveUploadAccount?.id, effectiveUploadProvider);
    }
    if (e.target) e.target.value = '';
  };

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

  const renderSortIndicator = (col: SortColumn) => {
    if (sortColumn !== col) return null;
    return sortDirection === 'asc' ? (
      <ArrowUp size={9} className="ml-1 text-[#4aa3ff] inline" />
    ) : (
      <ArrowDown size={9} className="ml-1 text-[#4aa3ff] inline" />
    );
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={() => setContextMenu(null)}
      onDrop={(event) => {
        event.preventDefault();
        const dropped = Array.from(event.dataTransfer.files || []);
        if (dropped.length) {
          void onUploadFiles(dropped, effectiveUploadAccount?.id, effectiveUploadProvider);
        }
      }}
      className="relative flex flex-1 flex-col overflow-hidden bg-[#05080d] text-[11px] outline-none select-none"
    >
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        {...({ webkitdirectory: '', directory: '' } as any)}
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Action Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-white/[0.06] bg-white/[0.01] px-3">
        <button
          onClick={() => setIsNewFolderOpen(true)}
          className="flex items-center gap-1 border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[9px] text-[#8fa5b8] hover:bg-white/[0.05] hover:text-[#d6e5f0] transition-colors"
        >
          <FolderPlus size={11} className="text-[#4aa3ff]" />
          <span>New Folder</span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[9px] text-[#8fa5b8] hover:bg-white/[0.05] hover:text-[#d6e5f0] transition-colors"
        >
          <Upload size={11} className="text-[#2ee6a6]" />
          <span>Upload</span>
        </button>

        <button
          onClick={() => folderInputRef.current?.click()}
          className="hidden sm:flex items-center gap-1 border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[9px] text-[#8fa5b8] hover:bg-white/[0.05] hover:text-[#d6e5f0] transition-colors"
        >
          <FolderOpen size={11} />
          <span>Upload Folder</span>
        </button>

        <div ref={uploadTargetRef} className="relative">
          <button
            onClick={() => {
              setIsUploadTargetOpen((open) => !open);
              setIsFilterDropdownOpen(false);
              setExpandedProviderFilter(null);
            }}
            className="flex max-w-44 items-center gap-1 border border-white/[0.06] bg-white/[0.02] px-2 py-1 font-mono text-[8px] text-[#71889d] transition-colors hover:bg-white/[0.05] hover:text-[#d6e5f0]"
            title={`Upload target: ${uploadTargetLabel}`}
          >
            <Database size={10} className="shrink-0 text-[#4aa3ff]" />
            <span className="truncate">{uploadTargetLabel}</span>
            <ChevronDown size={9} className="shrink-0 opacity-70" />
          </button>

          {isUploadTargetOpen && (
            <div
              className="absolute left-0 top-full z-[70] mt-1 w-72 border border-white/[0.08] bg-[#080d15] p-1 shadow-2xl backdrop-blur-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="px-2 py-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-[#557087]">
                Upload destination
              </div>
              <button
                onClick={() => {
                  setUploadTargetAccountId('context');
                  setIsUploadTargetOpen(false);
                }}
                className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-[10px] ${
                  uploadTargetAccountId === 'context'
                    ? 'bg-[#4aa3ff]/15 text-[#a8d3ff]'
                    : 'text-[#c0d0de] hover:bg-white/[0.05]'
                }`}
              >
                <span>Follow current view</span>
                <span className="font-mono text-[8px] text-[#557087]">Default</span>
              </button>
              <button
                onClick={() => {
                  setUploadTargetAccountId('auto');
                  setIsUploadTargetOpen(false);
                }}
                className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-[10px] ${
                  uploadTargetAccountId === 'auto'
                    ? 'bg-[#4aa3ff]/15 text-[#a8d3ff]'
                    : 'text-[#c0d0de] hover:bg-white/[0.05]'
                }`}
              >
                <span>Smart allocation</span>
                <span className="font-mono text-[8px] text-[#557087]">Any provider</span>
              </button>
              <div className="my-1 border-t border-white/[0.04]" />
              <div className="px-2 py-1 font-mono text-[8px] uppercase tracking-[0.14em] text-[#557087]">
                Any account from provider
              </div>
              {[...new Set(accounts.map((account) => account.provider))].map((provider) => (
                <button
                  key={provider}
                  onClick={() => {
                    setUploadTargetAccountId(`provider:${provider}`);
                    setIsUploadTargetOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] ${
                    uploadTargetAccountId === `provider:${provider}`
                      ? 'bg-[#4aa3ff]/15 text-[#a8d3ff]'
                      : 'text-[#c0d0de] hover:bg-white/[0.05]'
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: getProviderColor(provider) }}
                  />
                  <span className="flex-1">Any {getProviderName(provider)}</span>
                  <span className="font-mono text-[8px] text-[#557087]">
                    {accounts.filter((account) => account.provider === provider).length} IDs
                  </span>
                </button>
              ))}
              <div className="my-1 border-t border-white/[0.04]" />
              <div className="px-2 py-1 font-mono text-[8px] uppercase tracking-[0.14em] text-[#557087]">
                Specific provider ID
              </div>
              {accounts.map((account) => (
                <button
                  key={account.id}
                  disabled={account.status !== 'active'}
                  onClick={() => {
                    setUploadTargetAccountId(account.id);
                    setIsUploadTargetOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] disabled:cursor-not-allowed disabled:opacity-40 ${
                    uploadTargetAccountId === account.id
                      ? 'bg-[#4aa3ff]/15 text-[#a8d3ff]'
                      : 'text-[#c0d0de] hover:bg-white/[0.05]'
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: getProviderColor(account.provider) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{account.email}</span>
                    <span className="block truncate font-mono text-[8px] text-[#557087]">
                      {getProviderName(account.provider)} · {account.id}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onRefresh}
          className="grid h-6 w-6 place-items-center rounded border border-white/[0.06] text-[#71889d] hover:bg-white/[0.04] hover:text-[#bcd0df]"
          title="Refresh"
        >
          <RefreshCw size={10} />
        </button>

        {/* Provider-Wise Filter Dropdown */}
        <div ref={filterDropdownRef} className="relative ml-auto">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsFilterDropdownOpen(!isFilterDropdownOpen);
              if (isFilterDropdownOpen) setExpandedProviderFilter(null);
            }}
            className={`flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-all ${
              hasActiveProviderFilter
                ? 'border-[#4aa3ff]/50 bg-[#4aa3ff]/15 text-[#badeff]'
                : 'border-white/[0.06] bg-white/[0.02] text-[#8fa5b8] hover:bg-white/[0.05] hover:text-[#d6e5f0]'
            }`}
          >
            <Filter size={10} className={hasActiveProviderFilter ? 'text-[#4aa3ff]' : ''} />
            {hasActiveProviderFilter && selectedProviderFilter !== 'all' ? (
              <div className="flex items-center gap-1">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: getProviderColor(selectedProviderFilter) }}
                />
                <span className="max-w-32 truncate">{activeFilterLabel}</span>
              </div>
            ) : (
              <span>All Providers</span>
            )}
            <ChevronDown size={9} className="opacity-70" />
          </button>

          {isFilterDropdownOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-white/[0.08] bg-[#080d15] p-1 shadow-2xl backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  setSelectedProviderFilter('all');
                  setSelectedAccountFilter('all');
                  setExpandedProviderFilter(null);
                  setIsFilterDropdownOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[10px] transition-colors ${
                  !hasActiveProviderFilter
                    ? 'bg-[#4aa3ff]/15 text-[#a8d3ff] font-medium'
                    : 'text-[#c0d0de] hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                <span>All Providers</span>
                <span className="font-mono text-[8px] opacity-60">
                  {connectedProviderCount} provider{connectedProviderCount === 1 ? '' : 's'}
                </span>
              </button>

              <div className="my-1 border-t border-white/[0.04]" />

              {ALL_PROVIDERS.map((prov) => {
                const providerAccounts = accounts.filter((account) => account.provider === prov.id);
                const count = providerAccounts.length;
                const isSelected =
                  selectedProviderFilter === prov.id && selectedAccountFilter === 'all';
                const isExpanded = expandedProviderFilter === prov.id;
                return (
                  <div key={prov.id} className="relative">
                    <button
                      onMouseEnter={() => setExpandedProviderFilter(prov.id)}
                      onClick={() => setExpandedProviderFilter(isExpanded ? null : prov.id)}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[10px] transition-colors ${
                        isSelected || isExpanded
                          ? 'bg-[#4aa3ff]/15 text-[#a8d3ff] font-medium'
                          : 'text-[#c0d0de] hover:bg-white/[0.05] hover:text-white'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: getProviderColor(prov.id) }}
                        />
                        <span className="truncate">{prov.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[8px] opacity-60">{count}</span>
                        <ChevronRight size={9} className="opacity-65" />
                      </div>
                    </button>

                    {isExpanded && (
                      <div
                        className="absolute right-full top-0 z-[60] mr-1 w-64 rounded-lg border border-white/[0.08] bg-[#080d15] p-1 shadow-2xl backdrop-blur-xl"
                        onMouseLeave={() => setExpandedProviderFilter(null)}
                      >
                        <div className="px-2 py-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-[#557087]">
                          {prov.name} accounts
                        </div>
                        <button
                          onClick={() => {
                            setSelectedProviderFilter(prov.id);
                            setSelectedAccountFilter('all');
                            setExpandedProviderFilter(null);
                            setIsFilterDropdownOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[10px] transition-colors ${
                            isSelected
                              ? 'bg-[#4aa3ff]/15 text-[#a8d3ff]'
                              : 'text-[#c0d0de] hover:bg-white/[0.05] hover:text-white'
                          }`}
                        >
                          <span>All {prov.name} accounts</span>
                          <span className="font-mono text-[8px] opacity-60">{count}</span>
                        </button>

                        <div className="my-1 border-t border-white/[0.04]" />
                        {providerAccounts.length ? (
                          providerAccounts.map((account) => {
                            const accountCount = rawDisplayedFiles.filter(
                              (file) => file.cloud_account_id === account.id,
                            ).length;
                            const accountSelected = selectedAccountFilter === account.id;
                            return (
                              <button
                                key={account.id}
                                onClick={() => {
                                  setSelectedProviderFilter(prov.id);
                                  setSelectedAccountFilter(account.id);
                                  setExpandedProviderFilter(null);
                                  setIsFilterDropdownOpen(false);
                                }}
                                className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[10px] transition-colors ${
                                  accountSelected
                                    ? 'bg-[#4aa3ff]/15 text-[#a8d3ff]'
                                    : 'text-[#c0d0de] hover:bg-white/[0.05] hover:text-white'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="truncate">{account.email}</div>
                                  <div className="font-mono text-[8px] uppercase text-[#557087]">
                                    {account.status.replace('_', ' ')}
                                  </div>
                                </div>
                                <span className="shrink-0 font-mono text-[8px] opacity-60">
                                  {accountCount}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-2 py-2 text-[9px] text-[#557087]">
                            No connected accounts
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Search filter (Global Across All Subfolders) */}
        <div className="flex w-44 items-center gap-1.5 border border-white/[0.06] bg-black/30 px-2 py-1 rounded">
          {isSearching ? (
            <Loader2 size={10} className="animate-spin text-[#4aa3ff]" />
          ) : (
            <Search size={10} className="text-[#4aa3ff]" />
          )}
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all folders..."
            className="min-w-0 flex-1 bg-transparent text-[9px] text-[#c9d8e4] outline-none placeholder:text-[#4d6477]"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSearchResults(null);
              }}
              className="text-[#556f84] hover:text-white"
            >
              <X size={10} />
            </button>
          )}
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 border-l border-white/[0.06] pl-1.5">
          <button
            onClick={() => setViewMode('list')}
            className={`p-1 transition-colors ${viewMode === 'list' ? 'text-[#4aa3ff]' : 'text-[#52697c]'}`}
            title="List view"
          >
            <List size={12} />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1 transition-colors ${viewMode === 'grid' ? 'text-[#4aa3ff]' : 'text-[#52697c]'}`}
            title="Grid view"
          >
            <Grid2X2 size={12} />
          </button>
        </div>
      </div>

      {/* Dedicated Breadcrumb Path */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-black/20 px-3">
        <FolderOpen size={10} className="shrink-0 text-[#4aa3ff]" />
        <div className="flex min-w-0 items-center font-mono text-[9px] text-[#557087]">
          {breadcrumbParts.map((crumb, idx) => (
            <div key={crumb.path} className="flex min-w-0 items-center">
              {idx > 0 && <ChevronRight size={10} className="mx-0.5 shrink-0 text-[#3d5366]" />}
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults(null);
                  onNavigatePath(crumb.path);
                }}
                className={`truncate transition-colors hover:text-[#4aa3ff] ${
                  idx === breadcrumbParts.length - 1
                    ? 'font-medium text-[#9ab3c7]'
                    : 'text-[#557087]'
                }`}
              >
                {crumb.label}
              </button>
            </div>
          ))}
        </div>
        <span className="ml-auto truncate font-mono text-[8px] text-[#3f596d]">{currentPath}</span>
      </div>

      {/* Global Search / Provider Filter Header Banner */}
      {(searchResults !== null || hasActiveProviderFilter) && (
        <div className="flex h-7 items-center justify-between border-b border-[#4aa3ff]/20 bg-[#4aa3ff]/10 px-3 font-mono text-[9px] text-[#bde0ff]">
          <div className="flex items-center gap-2">
            {searchResults !== null ? (
              <>
                <Search size={10} className="text-[#4aa3ff]" />
                <span>
                  Search "{searchQuery}"{hasActiveProviderFilter && ` on ${activeFilterLabel}`}:{' '}
                  {displayedFiles.length} result{displayedFiles.length === 1 ? '' : 's'}
                </span>
              </>
            ) : (
              <>
                <Filter size={10} className="text-[#4aa3ff]" />
                <span className="flex items-center gap-1">
                  Provider Filter:
                  <span
                    className="h-1.5 w-1.5 rounded-full inline-block ml-1"
                    style={{
                      backgroundColor: getProviderColor(selectedProviderFilter as CloudProvider),
                    }}
                  />
                  <strong className="text-white">{activeFilterLabel}</strong>(
                  {displayedFiles.length} items in path)
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-wider">
            {hasActiveProviderFilter && (
              <button
                onClick={() => {
                  setSelectedProviderFilter('all');
                  setSelectedAccountFilter('all');
                }}
                className="text-[#84a3be] hover:text-white flex items-center gap-1"
              >
                <span>Clear Provider Filter</span>
                <X size={9} />
              </button>
            )}
            {searchResults !== null && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults(null);
                }}
                className="text-[#84a3be] hover:text-white flex items-center gap-1"
              >
                <span>Exit Search</span>
                <X size={9} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Multi-Selection Action Bar */}
      {selectedIds.size > 0 && searchResults === null && (
        <div className="flex h-7 items-center justify-between border-b border-[#4aa3ff]/20 bg-[#4aa3ff]/10 px-3 font-mono text-[9px] text-[#bde0ff]">
          <div className="flex items-center gap-2">
            <span>
              {selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected
            </span>
            <button onClick={selectAll} className="text-[#72b8f8] hover:underline">
              {selectedIds.size === displayedFiles.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkDownload}
              className="flex items-center gap-1 rounded bg-[#2ee6a6]/20 px-2 py-0.5 text-[#2ee6a6] hover:bg-[#2ee6a6]/30"
            >
              <Download size={10} /> Download Selected
            </button>
            <button
              onClick={() => {
                onBulkDelete(Array.from(selectedIds));
                setSelectedIds(new Set());
              }}
              className="flex items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 text-red-300 hover:bg-red-500/30"
            >
              <Trash2 size={10} /> Delete Selected
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-[#84a3be] hover:text-white"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Center Explorer & Side Inspector */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto os-scrollbar p-2">
          {viewMode === 'list' && (
            <div className="grid grid-cols-[1fr_120px_110px_90px_70px_28px] border-b border-white/[0.05] px-3 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[#43586b]">
              <button
                onClick={() => handleSort('name')}
                className="flex items-center text-left hover:text-[#bcd2e4] transition-colors"
              >
                <span>Name</span>
                {renderSortIndicator('name')}
              </button>
              <button
                onClick={() => handleSort('provider')}
                className="flex items-center text-left hover:text-[#bcd2e4] transition-colors"
              >
                <span>{searchResults !== null ? 'Path / Location' : 'Provider'}</span>
                {renderSortIndicator('provider')}
              </button>
              <button
                onClick={() => handleSort('type')}
                className="flex items-center text-left hover:text-[#bcd2e4] transition-colors"
              >
                <span>Type</span>
                {renderSortIndicator('type')}
              </button>
              <button
                onClick={() => handleSort('modified')}
                className="flex items-center text-left hover:text-[#bcd2e4] transition-colors"
              >
                <span>Modified</span>
                {renderSortIndicator('modified')}
              </button>
              <button
                onClick={() => handleSort('size')}
                className="flex items-center justify-end text-right hover:text-[#bcd2e4] transition-colors"
              >
                <span>Size</span>
                {renderSortIndicator('size')}
              </button>
              <span />
            </div>
          )}

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 p-1">
              {displayedFiles.map((file) => {
                const isSelected = selectedIds.has(file.id);
                const isActive = activeFileId === file.id;
                const providerColor = getProviderColor(file.provider);
                return (
                  <div
                    key={file.id}
                    onClick={(e) => handleItemClick(file, e)}
                    onDoubleClick={() => handleItemDoubleClick(file)}
                    onContextMenu={(e) => handleContextMenu(e, file)}
                    className={`group relative flex min-h-28 flex-col items-center justify-between rounded border p-2.5 transition-all cursor-pointer ${
                      isActive || isSelected
                        ? 'border-[#4aa3ff]/40 bg-[#4aa3ff]/10'
                        : 'border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/[0.08]'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: providerColor }}
                        title={getProviderName(file.provider)}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStar(file);
                        }}
                        className={`transition-opacity ${
                          file.is_starred
                            ? 'text-amber-400 opacity-100'
                            : 'text-[#476077] opacity-0 group-hover:opacity-100 hover:text-white'
                        }`}
                        title={file.is_starred ? 'Starred' : 'Add to Starred'}
                      >
                        <Star size={11} fill={file.is_starred ? 'currentColor' : 'none'} />
                      </button>
                    </div>

                    <div className="my-1">{getFileIcon(file)}</div>

                    <div className="w-full text-center">
                      <div className="truncate text-[10px] text-[#c6d4df]">{file.file_name}</div>
                      {searchResults !== null ? (
                        <div className="truncate font-mono text-[7.5px] text-[#4d697f]">
                          {file.virtual_path}
                        </div>
                      ) : (
                        <div className="font-mono text-[8px] text-[#536a7d]">
                          {file.is_folder ? 'Folder' : formatBytes(file.size)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-white/[0.02]">
              {displayedFiles.map((file) => {
                const isSelected = selectedIds.has(file.id);
                const isActive = activeFileId === file.id;
                const providerColor = getProviderColor(file.provider);
                return (
                  <div
                    key={file.id}
                    onClick={(e) => handleItemClick(file, e)}
                    onDoubleClick={() => handleItemDoubleClick(file)}
                    onContextMenu={(e) => handleContextMenu(e, file)}
                    className={`grid w-full grid-cols-[1fr_120px_110px_90px_70px_28px] items-center px-3 py-1.5 text-left transition-colors cursor-pointer ${
                      isActive || isSelected
                        ? 'bg-[#4aa3ff]/10 text-[#e4f0fa]'
                        : 'hover:bg-white/[0.025] text-[#c9d7e2]'
                    }`}
                  >
                    {/* 1. Name with direct icon */}
                    <div className="flex min-w-0 items-center gap-2">
                      {getFileIcon(file)}
                      <span className="truncate text-[11px] font-normal">{file.file_name}</span>
                    </div>

                    {/* 2. Path (if searching) or Provider */}
                    {searchResults !== null ? (
                      <span className="truncate font-mono text-[8px] text-[#6d859a]">
                        {file.virtual_path}
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5 truncate">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: providerColor }}
                        />
                        <span className="truncate font-mono text-[8px] text-[#6d859a]">
                          {getProviderName(file.provider)}
                        </span>
                      </div>
                    )}

                    {/* 3. Type */}
                    <span className="truncate font-mono text-[8px] text-[#536a7d]">
                      {file.is_folder ? 'Folder' : file.mime_type || 'File'}
                    </span>

                    {/* 4. Modified */}
                    <span className="font-mono text-[8px] text-[#465c6f]">
                      {formatDate(file.updated_at)}
                    </span>

                    {/* 5. Size */}
                    <span className="text-right font-mono text-[8px] text-[#465c6f]">
                      {file.is_folder ? '—' : formatBytes(file.size)}
                    </span>

                    {/* 6. Star on the right */}
                    <div className="flex items-center justify-end">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStar(file);
                        }}
                        className={`transition-colors ${
                          file.is_starred
                            ? 'text-amber-400 opacity-100'
                            : 'text-[#3d5366] hover:text-[#8ea9bf] opacity-40 hover:opacity-100'
                        }`}
                        title={file.is_starred ? 'Starred' : 'Add to Starred'}
                      >
                        <Star size={11} fill={file.is_starred ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!displayedFiles.length && (
            <div className="grid h-48 place-items-center font-mono text-[10px] text-[#43586b]">
              <div className="flex flex-col items-center gap-2">
                <Folder size={24} strokeWidth={1} />
                <span>
                  {searchResults !== null
                    ? `No cloud resources matching "${searchQuery}"${
                        hasActiveProviderFilter ? ` for ${activeFilterLabel}` : ''
                      }`
                    : hasActiveProviderFilter
                      ? `No resources in this folder for ${activeFilterLabel}`
                      : 'No resources found in this path'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Side Inspector Panel (Files app aesthetic) */}
        <aside className="hidden w-48 shrink-0 border-l border-white/[0.06] bg-white/[0.01] p-3 md:block">
          <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#43586b]">
            Resource Inspector
          </div>
          {activeFile ? (
            <div className="mt-4 space-y-3">
              <div className="grid h-16 place-items-center rounded border border-white/[0.05] bg-white/[0.015]">
                {getFileIcon(activeFile)}
              </div>
              <div className="break-all font-medium text-[11px] text-[#d1deea]">
                {activeFile.file_name}
              </div>
              <div className="space-y-1 font-mono text-[8px] leading-relaxed text-[#536a7d]">
                <div>TYPE: {activeFile.is_folder ? 'Folder' : activeFile.mime_type || 'File'}</div>
                <div>PATH: {activeFile.virtual_path}</div>
                <div>SIZE: {activeFile.is_folder ? '—' : formatBytes(activeFile.size)}</div>
                <div>PROVIDER: {getProviderName(activeFile.provider)}</div>
                <div className="break-all">PROVIDER ID: {activeFile.email || 'Primary'}</div>
                <div className="break-all">ACCOUNT ID: {activeFile.cloud_account_id}</div>
                <div className="break-all">REMOTE ID: {activeFile.remote_file_id}</div>
                <div>MODIFIED: {formatDate(activeFile.updated_at)}</div>
              </div>

              <div className="flex flex-col gap-1.5 pt-2">
                {!activeFile.is_folder && (
                  <>
                    <button
                      onClick={() => onPreviewFile(activeFile)}
                      className="flex w-full items-center justify-center gap-1 rounded border border-[#4aa3ff]/30 bg-[#4aa3ff]/10 py-1 font-mono text-[8px] uppercase tracking-wider text-[#93c7fa] hover:bg-[#4aa3ff]/20"
                    >
                      <Eye size={10} /> Preview
                    </button>
                    <button
                      onClick={() => handleDownloadFile(activeFile)}
                      className="flex w-full items-center justify-center gap-1 rounded border border-[#2ee6a6]/30 bg-[#2ee6a6]/10 py-1 font-mono text-[8px] uppercase tracking-wider text-[#79ecd4] hover:bg-[#2ee6a6]/20"
                    >
                      <Download size={10} /> Download
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    setRenamingFile(activeFile);
                    setRenameValue(activeFile.file_name);
                  }}
                  className="flex w-full items-center justify-center gap-1 rounded border border-white/[0.06] bg-white/[0.02] py-1 font-mono text-[8px] uppercase tracking-wider text-[#8fa5b8] hover:bg-white/[0.05]"
                >
                  <Edit3 size={10} /> Rename
                </button>
                <button
                  onClick={() => onShowDetails(activeFile)}
                  className="flex w-full items-center justify-center gap-1 rounded border border-white/[0.06] bg-white/[0.02] py-1 font-mono text-[8px] uppercase tracking-wider text-[#8fa5b8] hover:bg-white/[0.05]"
                >
                  <Info size={10} /> Properties
                </button>
                <button
                  onClick={() => onDeleteFile(activeFile.id)}
                  className="flex w-full items-center justify-center gap-1 rounded border border-red-500/20 bg-red-500/10 py-1 font-mono text-[8px] uppercase tracking-wider text-red-400 hover:bg-red-500/20"
                >
                  <Trash2 size={10} /> Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 font-mono text-[8px] text-[#43586b]">Select a resource</div>
          )}
        </aside>
      </div>

      {/* Custom Context Menu */}
      {contextMenu && (
        <div
          className="nammu-context-surface nammu-context-legacy absolute z-50 w-44 overflow-hidden rounded-lg border border-white/[0.08] bg-[#090e17]/95 p-1 shadow-2xl backdrop-blur-2xl text-[10px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="nammu-context-title truncate px-2 py-1 font-mono text-[8px] text-[#5e788e] border-b border-white/[0.04]">
            {contextMenu.file.file_name}
          </div>
          {!contextMenu.file.is_folder && (
            <>
              <button
                onClick={() => {
                  onPreviewFile(contextMenu.file);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[#cadbe8] hover:bg-white/[0.06] hover:text-white"
              >
                <Eye size={11} className="text-[#4aa3ff]" />
                <span>Preview</span>
              </button>
              <button
                onClick={() => {
                  handleDownloadFile(contextMenu.file);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[#cadbe8] hover:bg-white/[0.06] hover:text-white"
              >
                <Download size={11} className="text-[#2ee6a6]" />
                <span>Download</span>
              </button>
            </>
          )}
          <button
            onClick={() => {
              onToggleStar(contextMenu.file);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[#cadbe8] hover:bg-white/[0.06] hover:text-white"
          >
            <Star
              size={11}
              className={
                contextMenu.file.is_starred ? 'text-amber-400 fill-amber-400' : 'text-[#8da3b5]'
              }
            />
            <span>{contextMenu.file.is_starred ? 'Unstar' : 'Add to Starred'}</span>
          </button>
          <button
            onClick={() => {
              setRenamingFile(contextMenu.file);
              setRenameValue(contextMenu.file.file_name);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[#cadbe8] hover:bg-white/[0.06] hover:text-white"
          >
            <Edit3 size={11} className="text-amber-400" />
            <span>Rename</span>
          </button>
          <button
            onClick={() => {
              onShowDetails(contextMenu.file);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[#cadbe8] hover:bg-white/[0.06] hover:text-white"
          >
            <Info size={11} className="text-[#9ab7ce]" />
            <span>Properties</span>
          </button>
          <div className="my-1 border-t border-white/[0.04]" />
          <button
            onClick={() => {
              onDeleteFile(contextMenu.file.id);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 size={11} />
            <span>Delete</span>
          </button>
        </div>
      )}

      {/* Footer status */}
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.05] bg-white/[0.01] px-3 font-mono text-[8px] text-[#465c6f]">
        <span>
          {displayedFiles.length} cloud resources
          {hasActiveProviderFilter && ` (Filter: ${activeFilterLabel})`}
          {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
        </span>
        <span>
          {searchResults !== null ? `Global Search: "${searchQuery}"` : 'Unified Virtual Namespace'}
        </span>
      </div>

      {/* New Folder Modal (Scoped Absolute) */}
      {isNewFolderOpen && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          onClick={() => setIsNewFolderOpen(false)}
        >
          <form
            onSubmit={submitCreateFolder}
            className="w-full max-w-sm rounded-xl border border-white/[0.08] bg-[#070b12] p-4 text-[#d5e0ea] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-medium text-[12px] text-white">Create New Folder</div>
            <p className="mt-1 font-mono text-[9px] text-[#557187]">
              Directory will be created in {currentPath}
            </p>
            <p className="mt-1 truncate font-mono text-[8px] text-[#3f596d]">
              Target: {uploadTargetLabel}
            </p>
            <input
              autoFocus
              required
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="mt-3 w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewFolderOpen(false)}
                className="rounded border border-white/[0.08] px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-[#7990a4] hover:bg-white/[0.04]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded border border-[#4aa3ff]/30 bg-[#4aa3ff]/15 px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-[#a5d2ff] hover:bg-[#4aa3ff]/25"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rename Modal (Scoped Absolute) */}
      {renamingFile && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          onClick={() => setRenamingFile(null)}
        >
          <form
            onSubmit={submitRename}
            className="w-full max-w-sm rounded-xl border border-white/[0.08] bg-[#070b12] p-4 text-[#d5e0ea] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-medium text-[12px] text-white">Rename Resource</div>
            <input
              autoFocus
              required
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="mt-3 w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenamingFile(null)}
                className="rounded border border-white/[0.08] px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-[#7990a4] hover:bg-white/[0.04]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded border border-[#4aa3ff]/30 bg-[#4aa3ff]/15 px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-[#a5d2ff] hover:bg-[#4aa3ff]/25"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
