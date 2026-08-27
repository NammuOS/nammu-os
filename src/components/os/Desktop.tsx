import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Clipboard,
  Cloud,
  FilePlus2,
  FolderOpen,
  LayoutGrid,
  Settings,
  SlidersHorizontal,
  FileText,
  Code,
  Wrench,
  X,
  RefreshCw,
  Maximize,
  Wifi,
  BatteryFull,
} from 'lucide-react';
import { TOOLS } from '../../lib/toolRegistry';
import Identity from './Identity';
import type { SystemAppId } from './systemAppRegistry';
import { useContextMenu } from '../context-menu/useContextMenu';
import type { ContextMenuEntry } from '../context-menu/contextMenuTypes';
import WallpaperLayer from './WallpaperLayer';

interface DesktopProps {
  onOpenTool: (toolId: string) => void;
  onOpenSystemApp: (appId: SystemAppId) => void;
  onOpenLauncher: () => void;
  onFileDrop: (files: File[]) => void;
  suggestedTools: string[];
  onClearSuggestions: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchActive: boolean;
  onSearchActiveChange: (active: boolean) => void;
}

export default function Desktop({
  onOpenTool,
  onOpenSystemApp,
  onOpenLauncher,
  onFileDrop,
  suggestedTools,
  onClearSuggestions,
  searchQuery,
  onSearchQueryChange,
  searchActive,
  onSearchActiveChange,
}: DesktopProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [menuBarTime, setMenuBarTime] = useState<Date | null>(null);
  const dragCounter = useRef(0);
  const contextMenu = useContextMenu();

  useEffect(() => {
    setMenuBarTime(new Date());
    const timer = window.setInterval(() => setMenuBarTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDraggingOver(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFileDrop(files);
    },
    [onFileDrop],
  );

  const desktopMenu: ContextMenuEntry[] = [
    {
      id: 'desktop-open-launcher',
      label: 'Open Launcher',
      icon: LayoutGrid,
      shortcut: 'WIN',
      action: onOpenLauncher,
    },
    {
      id: 'desktop-new',
      label: 'New',
      icon: FilePlus2,
      items: [
        {
          id: 'desktop-new-note',
          label: 'Note',
          icon: FileText,
          action: () => onOpenSystemApp('notes'),
        },
        {
          id: 'desktop-new-editor',
          label: 'Editor document',
          icon: Code,
          action: () => onOpenSystemApp('editor'),
        },
        {
          id: 'desktop-open-files',
          label: 'Open Files',
          icon: FolderOpen,
          action: () => onOpenSystemApp('files'),
        },
        {
          id: 'desktop-open-cloud',
          label: 'Open Cloud',
          icon: Cloud,
          action: () => onOpenSystemApp('cloud'),
        },
      ],
    },
    { id: 'desktop-sep-1', type: 'separator' },
    { id: 'desktop-paste', label: 'Paste', icon: Clipboard, shortcut: 'CTRL V', disabled: true },
    {
      id: 'desktop-refresh',
      label: 'Refresh desktop',
      icon: RefreshCw,
      shortcut: 'F5',
      action: () => window.location.reload(),
    },
    {
      id: 'desktop-view',
      label: 'Display',
      icon: SlidersHorizontal,
      items: [
        {
          id: 'desktop-fullscreen',
          label: document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen',
          icon: Maximize,
          action: () =>
            document.fullscreenElement
              ? document.exitFullscreen()
              : document.documentElement.requestFullscreen(),
        },
        {
          id: 'desktop-settings',
          label: 'Display settings',
          icon: Settings,
          action: () => onOpenSystemApp('settings'),
        },
      ],
    },
  ];

  return (
    <div
      className="os-desktop fixed inset-0 overflow-hidden"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={(event) =>
        contextMenu.openAtEvent(event, desktopMenu, { ariaLabel: 'Desktop menu' })
      }
      onKeyDown={(event) =>
        contextMenu.openForKeyboard(event, desktopMenu, { ariaLabel: 'Desktop menu' })
      }
      onPointerDown={(event) =>
        contextMenu.startLongPress(event, desktopMenu, { ariaLabel: 'Desktop menu' })
      }
      onPointerUp={contextMenu.cancelLongPress}
      onPointerCancel={contextMenu.cancelLongPress}
      onPointerMove={contextMenu.cancelLongPress}
      tabIndex={-1}
    >
      {/* Wallpaper layer */}
      <WallpaperLayer />

      <div className="macos-menu-bar" aria-label="MacOS menu bar">
        <div className="macos-menu-leading">
          <span className="macos-menu-mark" aria-hidden="true">
            ●
          </span>
          <strong>Nammu OS</strong>
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>Window</span>
          <span>Help</span>
        </div>
        <div className="macos-menu-trailing">
          <Wifi size={14} strokeWidth={2.2} />
          <BatteryFull size={16} strokeWidth={2.1} />
          {menuBarTime && (
            <>
              <span>
                {menuBarTime.toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              <strong>
                {menuBarTime.toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </strong>
            </>
          )}
        </div>
      </div>

      {/* Subtle grid overlay */}
      <div
        className="desktop-grid absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(6,182,212,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.3) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      />

      {/* NammuOS identity and command search */}
      <Identity
        onOpenTool={onOpenTool}
        onOpenSystemApp={onOpenSystemApp}
        query={searchQuery}
        onQueryChange={onSearchQueryChange}
        searchActive={searchActive}
        onSearchActiveChange={onSearchActiveChange}
      />

      {/* Drop zone overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="drop-zone drag-over p-12 rounded-lg">
            <div className="text-center">
              <div className="text-2xl font-light text-os-accent mb-2">Drop files here</div>
              <div className="text-xs text-os-text-muted">NammuOS will suggest valid tools</div>
            </div>
          </div>
        </div>
      )}

      {/* Suggested tools after drop */}
      {suggestedTools.length > 0 && !isDraggingOver && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 glass-panel rounded-lg p-4 w-80 z-40">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wrench size={14} className="text-os-amber" />
              <span className="text-xs font-semibold text-os-text">Suggested Actions</span>
            </div>
            <button onClick={onClearSuggestions} className="p-1 hover:bg-os-surface/50 rounded-sm">
              <X size={12} className="text-os-text-muted" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {suggestedTools.map((toolId) => {
              const tool = TOOLS.find((t) => t.id === toolId);
              if (!tool) return null;
              const Icon = tool.icon;
              return (
                <button
                  key={toolId}
                  onClick={() => onOpenTool(toolId)}
                  className="flex items-center gap-2 p-2 rounded-sm hover:bg-os-surface/40 transition-all text-left"
                >
                  <Icon size={16} className="text-os-accent" />
                  <div className="flex-1">
                    <div className="text-xs text-os-text">{tool.name}</div>
                    <div className="text-[10px] text-os-text-muted">{tool.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* System status indicator (top right micro) */}
      <div className="desktop-system-status absolute top-2 right-3 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className="status-dot" />
          <span className="text-[9px] text-os-emerald tracking-wider uppercase">Online</span>
        </div>
      </div>
    </div>
  );
}
