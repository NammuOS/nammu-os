import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell,
  Clock3,
  Eye,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  Music,
  Pin,
  PinOff,
  Power,
  Settings,
  Sliders,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from 'lucide-react';
import type { WindowState } from '../../hooks/useWindowManager';
import { findToolById } from '../../lib/toolRegistry';
import { findSystemApp, findSystemAppByWindowId, type SystemAppId } from './systemAppRegistry';
import { useContextMenu } from '../context-menu/useContextMenu';
import type { ContextMenuEntry } from '../context-menu/contextMenuTypes';
import { useMasterVolume } from '../../hooks/useMasterVolume';
import { applyMasterVolumeToMedia } from '../../lib/osVolume';

interface TaskbarProps {
  autoHide?: boolean;
  windows: WindowState[];
  pinnedTools: string[];
  onToggleStartMenu: () => void;
  startMenuOpen: boolean;
  onOpenTool: (toolId: string) => void;
  onFocusWindow: (id: string) => void;
  onRestoreWindow: (id: string) => void;
  onMinimizeWindow: (id: string) => void;
  onMaximizeWindow: (id: string) => void;
  onCloseWindow: (id: string) => void;
  onPinTool: (toolId: string) => void;
  onUnpinTool: (toolId: string) => void;
  onReorderPinned: (sourceId: string, targetId: string) => void;
  onOpenSystemApp: (appId: SystemAppId) => void;
  musicOpen: boolean;
  onToggleMusic: () => void;
  onPowerOff: () => void;
  onFlyoutVisibilityChange?: (visible: boolean) => void;
}

function resolvePinnedItem(pinnedId: string) {
  const normalizedId = pinnedId.startsWith('system:') ? pinnedId.replace('system:', '') : pinnedId;
  const sysApp = findSystemApp(normalizedId as SystemAppId) || findSystemAppByWindowId(pinnedId);
  if (sysApp) {
    return {
      isSystemApp: true,
      id: sysApp.id,
      windowId: sysApp.windowId,
      name: sysApp.title,
      icon: sysApp.icon,
    };
  }
  const tool = findToolById(pinnedId);
  if (tool) {
    return {
      isSystemApp: false,
      id: tool.id,
      windowId: tool.id,
      name: tool.name,
      icon: tool.icon,
    };
  }
  return null;
}

export default function Taskbar({
  autoHide = false,
  windows,
  pinnedTools,
  onToggleStartMenu,
  startMenuOpen,
  onOpenTool,
  onFocusWindow,
  onRestoreWindow,
  onMinimizeWindow,
  onMaximizeWindow,
  onCloseWindow,
  onPinTool,
  onUnpinTool,
  onReorderPinned,
  onOpenSystemApp,
  musicOpen,
  onToggleMusic,
  onPowerOff,
  onFlyoutVisibilityChange,
}: TaskbarProps) {
  const [time, setTime] = useState(new Date());
  const { volume, setVolume: updateVolume } = useMasterVolume();
  const [lastVolume, setLastVolume] = useState<number>(72);
  const [showVolume, setShowVolume] = useState(false);
  const [showWheelTooltip, setShowWheelTooltip] = useState(false);
  const tooltipTimeoutRef = useRef<number | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showClock, setShowClock] = useState(false);
  const [showPower, setShowPower] = useState(false);
  const [clockSettings, setClockSettings] = useState({ showSeconds: false, showWeekday: true });
  const [draggedPinnedId, setDraggedPinnedId] = useState<string | null>(null);
  const [notifications] = useState([
    { id: 1, text: 'NammuOS initialized', time: 'Just now', read: true },
    { id: 2, text: 'All systems nominal', time: 'Just now', read: true },
  ]);
  const contextMenu = useContextMenu();

  useEffect(() => {
    onFlyoutVisibilityChange?.(showVolume || showNotifications || showClock || showPower);
  }, [onFlyoutVisibilityChange, showClock, showNotifications, showPower, showVolume]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const syncClockSettings = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('nammu-settings') || '{}');
        setClockSettings({
          showSeconds: saved.showSeconds === true,
          showWeekday: saved.showWeekday !== false,
        });
      } catch {
        setClockSettings({ showSeconds: false, showWeekday: true });
      }
    };
    syncClockSettings();
    window.addEventListener('nammu-theme-change', syncClockSettings);
    window.addEventListener('storage', syncClockSettings);
    return () => {
      window.removeEventListener('nammu-theme-change', syncClockSettings);
      window.removeEventListener('storage', syncClockSettings);
    };
  }, []);

  const closeFlyouts = useCallback(() => {
    setShowVolume(false);
    setShowNotifications(false);
    setShowClock(false);
    setShowPower(false);
  }, []);

  useEffect(() => {
    if (!showVolume && !showNotifications && !showClock && !showPower) return;

    const handlePointerDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest('.taskbar-flyout-root')) return;
      closeFlyouts();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFlyouts();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeFlyouts, showClock, showNotifications, showPower, showVolume]);

  useEffect(() => {
    applyMasterVolumeToMedia(volume);
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) =>
          Array.from(record.addedNodes).some(
            (node) =>
              node instanceof HTMLMediaElement ||
              (node instanceof Element && Boolean(node.querySelector('audio, video'))),
          ),
        )
      ) {
        applyMasterVolumeToMedia(volume);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [volume]);

  const toggleMute = () => {
    if (volume > 0) {
      setLastVolume(volume);
      updateVolume(0);
    } else {
      updateVolume(lastVolume > 0 ? lastVolume : 72);
    }
  };

  const handleVolumeWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 5 : -5;
    updateVolume(volume + delta);

    setShowWheelTooltip(true);
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    tooltipTimeoutRef.current = window.setTimeout(() => setShowWheelTooltip(false), 1500);
  };

  const handleTaskbarWheel = (e: React.WheelEvent) => {
    const running = windows.filter((w) => !w.isMinimized);
    if (running.length <= 1) return;
    e.preventDefault();
    const focusedIdx = running.findIndex((w) => w.isFocused);
    if (e.deltaY > 0) {
      const next = (focusedIdx + 1) % running.length;
      onFocusWindow(running[next].id);
    } else {
      const prev = (focusedIdx - 1 + running.length) % running.length;
      onFocusWindow(running[prev].id);
    }
  };

  const openTools = windows.filter((w) => !w.isMinimized);
  const minimizedTools = windows.filter((w) => w.isMinimized);

  const isPinnedWindow = (win: WindowState) => {
    return pinnedTools.some((p) => {
      const norm = p.startsWith('system:') ? p.replace('system:', '') : p;
      const winNorm = win.toolId.startsWith('system:')
        ? win.toolId.replace('system:', '')
        : win.toolId;
      return p === win.toolId || norm === winNorm || p === `system:${winNorm}`;
    });
  };

  const unpinnedOpenTools = openTools.filter((win) => !isPinnedWindow(win));
  const unpinnedMinimizedTools = minimizedTools.filter((win) => !isPinnedWindow(win));

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: clockSettings.showSeconds ? '2-digit' : undefined,
      hour12: true,
    });
  const formatFullTime = (d: Date) =>
    d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: clockSettings.showSeconds ? '2-digit' : undefined,
      hour12: true,
    });
  const formatDate = (d: Date) => {
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    const day = d.getDate();
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    return `${weekday}, ${day} ${month}`;
  };
  const formatFullDate = (d: Date) =>
    d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  const calendarDays = (() => {
    const year = time.getFullYear();
    const month = time.getMonth();
    const leadingDays = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => {
      const day = index - leadingDays + 1;
      return day >= 1 && day <= daysInMonth ? day : null;
    });
  })();

  const taskbarMenu: ContextMenuEntry[] = [
    { id: 'taskbar-header', type: 'header', label: 'Taskbar' },
    {
      id: 'taskbar-show-desktop',
      label: 'Show desktop',
      icon: LayoutDashboard,
      action: () =>
        windows.filter((win) => !win.isMinimized).forEach((win) => onMinimizeWindow(win.id)),
    },
    {
      id: 'taskbar-restore-all',
      label: 'Restore all windows',
      icon: Eye,
      disabled: !minimizedTools.length,
      action: () => minimizedTools.forEach((win) => onRestoreWindow(win.id)),
    },
    {
      id: 'taskbar-music',
      label: musicOpen ? 'Hide music sidebar' : 'Show music sidebar',
      icon: Music,
      checked: musicOpen,
      action: onToggleMusic,
    },
    { id: 'taskbar-sep-1', type: 'separator' },
    {
      id: 'taskbar-settings',
      label: 'Taskbar settings',
      icon: Settings,
      action: () => onOpenSystemApp('settings'),
    },
    {
      id: 'taskbar-close-all',
      label: 'Close all windows',
      icon: X,
      danger: true,
      disabled: !windows.length,
      action: () => windows.forEach((win) => onCloseWindow(win.id)),
    },
  ];

  return (
    <>
      {autoHide && <div className="taskbar-reveal-zone" aria-hidden="true" />}
      <div
        className={`os-taskbar fixed bottom-0 left-0 right-0 h-[32px] z-9998 flex items-center px-2 gap-1 ${autoHide ? 'taskbar-auto-hide' : ''}`}
        onContextMenu={(event) =>
          contextMenu.openAtEvent(event, taskbarMenu, {
            safeArea: { left: 0, right: 0, bottom: 32 },
            ariaLabel: 'Taskbar menu',
          })
        }
        onPointerDown={(event) =>
          contextMenu.startLongPress(event, taskbarMenu, {
            safeArea: { left: 0, right: 0, bottom: 32 },
            ariaLabel: 'Taskbar menu',
          })
        }
        onPointerUp={contextMenu.cancelLongPress}
        onPointerCancel={contextMenu.cancelLongPress}
        onPointerMove={contextMenu.cancelLongPress}
      >
        {/* Launcher button */}
        <button
          onClick={onToggleStartMenu}
          className={`taskbar-start-button flex h-7 w-8 items-center justify-center transition-colors ${startMenuOpen ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
          title="NammuOS apps"
          aria-label="Toggle NammuOS apps"
        >
          <img src="/branding/nammu-logo.webp" alt="" aria-hidden="true" draggable={false} />
        </button>

        <div className="w-px h-5 bg-os-border/30 mx-1" />

        {/* Pinned apps & tools */}
        <div className="flex items-center gap-0.5">
          {pinnedTools.map((pinnedId, pinnedIndex) => {
            const item = resolvePinnedItem(pinnedId);
            if (!item) return null;
            const isOpen = openTools.some(
              (w) => w.toolId === item.windowId || w.toolId === item.id,
            );
            const isMinimized = minimizedTools.some(
              (w) => w.toolId === item.windowId || w.toolId === item.id,
            );
            const existing = windows.find(
              (w) => w.toolId === item.windowId || w.toolId === item.id,
            );
            const Icon = item.icon;
            return (
              <button
                key={pinnedId}
                draggable
                onDragStart={(event) => {
                  setDraggedPinnedId(pinnedId);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', pinnedId);
                }}
                onDragOver={(event) => {
                  if (!draggedPinnedId || draggedPinnedId === pinnedId) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = draggedPinnedId || event.dataTransfer.getData('text/plain');
                  if (sourceId && sourceId !== pinnedId) onReorderPinned(sourceId, pinnedId);
                  setDraggedPinnedId(null);
                }}
                onDragEnd={() => setDraggedPinnedId(null)}
                onClick={() => {
                  if (!existing) {
                    if (item.isSystemApp) onOpenSystemApp(item.id as SystemAppId);
                    else onOpenTool(item.id);
                  } else if (existing.isMinimized) {
                    onRestoreWindow(existing.id);
                  } else if (existing.isFocused) {
                    onMinimizeWindow(existing.id);
                  } else {
                    onFocusWindow(existing.id);
                  }
                }}
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button !== 1 || !existing) return;
                  event.preventDefault();
                  onCloseWindow(existing.id);
                }}
                className={`taskbar-button taskbar-button-pinned relative ${isOpen || isMinimized ? 'active' : ''} ${isOpen ? 'pinned' : ''} ${draggedPinnedId === pinnedId ? 'opacity-40' : ''}`}
                title={`${item.name}${existing ? ' · Middle-click to close' : ''}`}
                onContextMenu={(event) => {
                  contextMenu.openAtEvent(
                    event,
                    [
                      { id: `pinned-${pinnedId}-header`, type: 'header', label: item.name },
                      {
                        id: `pinned-${pinnedId}-open`,
                        label: !existing
                          ? 'Open'
                          : existing.isMinimized
                            ? 'Restore'
                            : existing.isFocused
                              ? 'Minimize'
                              : 'Bring to front',
                        icon: existing?.isFocused ? Minimize2 : Eye,
                        action: () => {
                          if (!existing) {
                            if (item.isSystemApp) onOpenSystemApp(item.id as SystemAppId);
                            else onOpenTool(item.id);
                          } else if (existing.isMinimized) {
                            onRestoreWindow(existing.id);
                          } else if (existing.isFocused) {
                            onMinimizeWindow(existing.id);
                          } else {
                            onFocusWindow(existing.id);
                          }
                        },
                      },
                      {
                        id: `pinned-${pinnedId}-unpin`,
                        label: 'Unpin from taskbar',
                        icon: PinOff,
                        action: () => onUnpinTool(pinnedId),
                      },
                      {
                        id: `pinned-${pinnedId}-move-left`,
                        label: 'Move left',
                        disabled: pinnedIndex === 0,
                        action: () => onReorderPinned(pinnedId, pinnedTools[pinnedIndex - 1]),
                      },
                      {
                        id: `pinned-${pinnedId}-move-right`,
                        label: 'Move right',
                        disabled: pinnedIndex === pinnedTools.length - 1,
                        action: () => onReorderPinned(pinnedId, pinnedTools[pinnedIndex + 1]),
                      },
                      ...(existing
                        ? [
                            { id: `pinned-${pinnedId}-sep`, type: 'separator' as const },
                            {
                              id: `pinned-${pinnedId}-close`,
                              label: 'Exit',
                              icon: X,
                              danger: true,
                              action: () => onCloseWindow(existing.id),
                            },
                          ]
                        : []),
                    ],
                    {
                      safeArea: { left: 0, right: 0, bottom: 32 },
                      ariaLabel: `${item.name} taskbar menu`,
                    },
                  );
                }}
              >
                <Icon size={16} className={isOpen ? 'text-os-accent' : 'text-os-text-muted'} />
                {isOpen && (
                  <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full bg-os-accent" />
                )}
              </button>
            );
          })}
        </div>

        <div className="w-px h-5 bg-os-border/30 mx-1" />

        {/* Open/running apps (unpinned) - Supports Mouse Wheel Window Switching */}
        <div
          className="flex items-center gap-0.5 flex-1 overflow-hidden"
          onWheel={handleTaskbarWheel}
          title="Scroll with mouse wheel to switch open apps"
        >
          {unpinnedOpenTools.map((win) => {
            const app = findToolById(win.toolId) ?? findSystemAppByWindowId(win.toolId);
            if (!app) return null;
            const targetPinId = win.toolId.startsWith('system:')
              ? win.toolId.replace('system:', '')
              : win.toolId;
            const isPinned = pinnedTools.includes(targetPinId) || pinnedTools.includes(win.toolId);
            const Icon = app.icon;
            return (
              <button
                key={win.id}
                onClick={() => (win.isFocused ? onMinimizeWindow(win.id) : onFocusWindow(win.id))}
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button !== 1) return;
                  event.preventDefault();
                  onCloseWindow(win.id);
                }}
                className={`taskbar-button taskbar-button-unpinned max-w-35 ${win.isFocused ? 'active' : ''}`}
                title={win.title}
                onContextMenu={(event) =>
                  contextMenu.openAtEvent(
                    event,
                    [
                      { id: `running-${win.id}-header`, type: 'header', label: win.title },
                      {
                        id: `running-${win.id}-minimize`,
                        label: 'Minimize',
                        icon: Minimize2,
                        action: () => onMinimizeWindow(win.id),
                      },
                      {
                        id: `running-${win.id}-maximize`,
                        label: win.isMaximized ? 'Restore' : 'Maximize',
                        icon: Maximize2,
                        action: () => onMaximizeWindow(win.id),
                      },
                      {
                        id: `running-${win.id}-pin`,
                        label: isPinned ? 'Unpin from taskbar' : 'Pin to taskbar',
                        icon: isPinned ? PinOff : Pin,
                        action: () =>
                          isPinned ? onUnpinTool(targetPinId) : onPinTool(targetPinId),
                      },
                      { id: `running-${win.id}-sep`, type: 'separator' },
                      {
                        id: `running-${win.id}-close`,
                        label: 'Exit',
                        icon: X,
                        danger: true,
                        action: () => onCloseWindow(win.id),
                      },
                    ],
                    {
                      safeArea: { left: 0, right: 0, bottom: 32 },
                      ariaLabel: `${win.title} taskbar menu`,
                    },
                  )
                }
              >
                <Icon
                  size={16}
                  className={win.isFocused ? 'text-os-accent' : 'text-os-text-muted'}
                />
                <span className="text-[10px] text-os-text truncate hidden md:block">
                  {win.title}
                </span>
                {win.isFocused && (
                  <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full bg-os-accent" />
                )}
              </button>
            );
          })}
          {unpinnedMinimizedTools.map((win) => {
            const app = findToolById(win.toolId) ?? findSystemAppByWindowId(win.toolId);
            if (!app) return null;
            const targetPinId = win.toolId.startsWith('system:')
              ? win.toolId.replace('system:', '')
              : win.toolId;
            const isPinned = pinnedTools.includes(targetPinId) || pinnedTools.includes(win.toolId);
            const Icon = app.icon;
            return (
              <button
                key={win.id}
                onClick={() => onRestoreWindow(win.id)}
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button !== 1) return;
                  event.preventDefault();
                  onCloseWindow(win.id);
                }}
                className="taskbar-button taskbar-button-unpinned"
                title={win.title}
                onContextMenu={(event) =>
                  contextMenu.openAtEvent(
                    event,
                    [
                      { id: `minimized-${win.id}-header`, type: 'header', label: win.title },
                      {
                        id: `minimized-${win.id}-restore`,
                        label: 'Restore',
                        icon: Eye,
                        action: () => onRestoreWindow(win.id),
                      },
                      {
                        id: `minimized-${win.id}-pin`,
                        label: isPinned ? 'Unpin from taskbar' : 'Pin to taskbar',
                        icon: isPinned ? PinOff : Pin,
                        action: () =>
                          isPinned ? onUnpinTool(targetPinId) : onPinTool(targetPinId),
                      },
                      { id: `minimized-${win.id}-sep`, type: 'separator' },
                      {
                        id: `minimized-${win.id}-close`,
                        label: 'Exit',
                        icon: X,
                        danger: true,
                        action: () => onCloseWindow(win.id),
                      },
                    ],
                    {
                      safeArea: { left: 0, right: 0, bottom: 32 },
                      ariaLabel: `${win.title} taskbar menu`,
                    },
                  )
                }
              >
                <Icon size={16} className="text-os-text-muted" />
              </button>
            );
          })}
        </div>

        {/* System tray */}
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-2.5 px-2">
            {/* Music sidebar toggle */}
            <button
              title={musicOpen ? 'Hide music sidebar' : 'Show music sidebar'}
              onClick={onToggleMusic}
              className={`cursor-pointer flex items-center bg-transparent border-0 p-0 transition-colors ${
                musicOpen ? 'text-os-accent' : 'text-os-text-muted hover:text-os-accent'
              }`}
            >
              <Music size={13} />
            </button>

            <span
              title="Connected"
              className="cursor-pointer text-os-text-muted hover:text-os-accent flex items-center transition-colors"
            >
              <Wifi size={13} />
            </span>

            {/* Volume control with mouse wheel support */}
            <div
              className="taskbar-flyout-root relative flex items-center"
              onWheel={handleVolumeWheel}
            >
              <button
                title={`Volume: ${volume}% (Scroll mouse wheel to adjust)`}
                onClick={() => {
                  setShowVolume(!showVolume);
                  setShowNotifications(false);
                  setShowClock(false);
                  setShowPower(false);
                }}
                className="cursor-pointer text-os-text-muted hover:text-os-accent flex items-center bg-transparent border-0 p-0 transition-colors"
              >
                {volume === 0 ? (
                  <VolumeX size={13} className="text-os-red" />
                ) : (
                  <Volume2 size={13} />
                )}
              </button>

              {/* Wheel percentage status badge tooltip */}
              {showWheelTooltip && (
                <div className="absolute bottom-9 left-1/2 -translate-x-1/2 bg-[#090d18] border border-[#4aa3ff]/60 shadow-2xl px-2.5 py-1 rounded-[3px] text-[10px] font-mono text-os-text flex items-center gap-1.5 whitespace-nowrap z-50 animate-fade-in pointer-events-none">
                  {volume === 0 ? (
                    <VolumeX size={11} className="text-[#f43f5e]" />
                  ) : (
                    <Volume2 size={11} className="text-os-accent" />
                  )}
                  <span className="font-semibold text-os-accent">
                    {volume === 0 ? 'Muted (0%)' : `${volume}%`}
                  </span>
                </div>
              )}

              {/* Volume Popover - Styled to match OS Start Menu and Theme */}
              {showVolume && (
                <div
                  className="taskbar-popover absolute bottom-10 right-0 z-50 flex w-64 flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="taskbar-popover-header flex h-9 items-center justify-between px-3">
                    <div className="flex items-center gap-1.5">
                      <Sliders size={11} className="text-os-accent" />
                      <span className="font-mono text-[8px] font-medium uppercase tracking-[0.16em] text-os-text-muted">
                        Master Volume
                      </span>
                    </div>
                    <span className="font-mono text-[8px] tracking-wider text-os-text-dim">
                      {volume === 0 ? 'MUTED' : `${volume}%`}
                    </span>
                  </div>

                  <div className="taskbar-popover-control flex items-center gap-2.5 p-3">
                    <button
                      onClick={toggleMute}
                      className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center border transition-colors ${
                        volume === 0
                          ? 'border-os-red/30 bg-os-red/10 text-os-red'
                          : 'border-os-border/25 bg-os-surface/20 text-os-text-muted hover:border-os-border/50 hover:bg-os-surface/35 hover:text-os-accent'
                      }`}
                      title={volume === 0 ? 'Unmute' : 'Mute'}
                    >
                      {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
                    </button>

                    <div className="relative flex-1 flex items-center">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={volume}
                        onChange={(e) => updateVolume(Number(e.target.value))}
                        className="os-range"
                        style={{
                          background: `linear-gradient(90deg, var(--color-os-accent) 0%, var(--color-os-accent) ${volume}%, color-mix(in srgb, var(--color-os-text) 10%, transparent) ${volume}%, color-mix(in srgb, var(--color-os-text) 10%, transparent) 100%)`,
                        }}
                        aria-label="Volume slider"
                      />
                    </div>

                    <span className="w-9 shrink-0 text-right font-mono text-[10px] font-medium text-os-text">
                      {volume}%
                    </span>
                  </div>

                  <div className="taskbar-popover-presets grid grid-cols-5">
                    {[0, 25, 50, 75, 100].map((level) => (
                      <button
                        key={level}
                        onClick={() => updateVolume(level)}
                        className={`border-r py-1.5 font-mono text-[8px] transition-colors last:border-r-0 ${
                          volume === level
                            ? 'bg-os-accent/10 font-semibold text-os-accent'
                            : 'text-os-text-dim hover:bg-os-surface/30 hover:text-os-text-muted'
                        }`}
                      >
                        {level === 0 ? 'Mute' : `${level}%`}
                      </button>
                    ))}
                  </div>

                  <div className="taskbar-popover-footer px-3 py-2 font-mono text-[7.5px] uppercase tracking-[0.12em] text-os-text-dim">
                    Scroll over the tray icon to adjust
                  </div>
                </div>
              )}
            </div>

            {/* Notifications bell */}
            <div className="taskbar-flyout-root relative flex items-center">
              <button
                title="Notifications"
                onClick={() => {
                  setShowNotifications(!showNotifications);
                  setShowVolume(false);
                  setShowClock(false);
                  setShowPower(false);
                }}
                className="cursor-pointer text-os-text-muted hover:text-os-accent flex items-center bg-transparent border-0 p-0 transition-colors relative"
              >
                <Bell size={13} />
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-os-accent" />
              </button>
              {showNotifications && (
                <div className="taskbar-popover absolute bottom-9 right-0 z-50 w-72">
                  <div className="taskbar-popover-header flex h-9 items-center justify-between px-3">
                    <span className="flex items-center gap-1.5 font-mono text-[8px] font-medium uppercase tracking-[0.16em] text-os-text-muted">
                      <Bell size={11} className="text-os-accent" /> Notifications
                    </span>
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="taskbar-tray-button"
                      aria-label="Close notifications"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto os-scrollbar">
                    {notifications.map((n) => (
                      <div key={n.id} className="taskbar-popover-item flex gap-2.5 px-3 py-2.5">
                        <span className="mt-1 h-1 w-1 shrink-0 bg-os-accent" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="text-[10px] font-medium text-os-text">{n.text}</div>
                          <div className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-os-text-dim">
                            {n.time}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="taskbar-flyout-root relative flex items-center">
              <button
                title="Power"
                aria-label="Power options"
                aria-expanded={showPower}
                onClick={() => {
                  setShowPower((current) => !current);
                  setShowVolume(false);
                  setShowNotifications(false);
                  setShowClock(false);
                }}
                className={`taskbar-tray-button ${showPower ? 'text-os-accent' : ''}`}
              >
                <Power size={13} />
              </button>
              {showPower && (
                <div className="taskbar-popover absolute bottom-9 right-0 z-50 w-64">
                  <div className="taskbar-popover-header flex h-9 items-center gap-1.5 px-3 font-mono text-[8px] font-medium uppercase tracking-[0.16em] text-os-text-muted">
                    <Power size={11} className="text-os-accent" /> Power controls
                  </div>
                  <div className="p-3">
                    <p className="mb-3 text-[10px] leading-relaxed text-os-text-muted">
                      End this desktop session and return to the secure lock screen.
                    </p>
                    <button
                      onClick={() => {
                        closeFlyouts();
                        onPowerOff();
                      }}
                      className="taskbar-power-action flex h-8 w-full items-center justify-center gap-2 font-mono text-[8px] font-medium uppercase tracking-[0.12em]"
                    >
                      <Power size={11} /> Power off &amp; lock
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="w-px h-4 bg-os-border/30" />

          {/* Date & Time display */}
          <div className="taskbar-flyout-root relative flex items-center">
            <button
              onClick={() => {
                setShowClock(!showClock);
                setShowVolume(false);
                setShowNotifications(false);
                setShowPower(false);
              }}
              className="flex flex-col items-end px-2 py-0.5 text-right hover:bg-white/[0.04] rounded transition-colors"
              title={formatFullDate(time)}
            >
              <span className="text-[11px] font-mono text-os-text leading-tight font-medium">
                {formatTime(time)}
              </span>
              {clockSettings.showWeekday && (
                <span className="text-[9px] font-mono text-os-text-muted leading-tight">
                  {formatDate(time)}
                </span>
              )}
            </button>
            {showClock && (
              <div className="taskbar-popover absolute bottom-9 right-0 z-50 w-64">
                <div className="taskbar-popover-header flex h-9 items-center gap-1.5 px-3 font-mono text-[8px] font-medium uppercase tracking-[0.16em] text-os-text-muted">
                  <Clock3 size={11} className="text-os-accent" /> System clock
                </div>
                <div className="px-3 py-4 text-left">
                  <div className="font-mono text-[24px] font-medium leading-none tracking-[0.08em] text-os-text">
                    {formatFullTime(time)}
                  </div>
                  <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.08em] text-os-text-muted">
                    {formatFullDate(time)}
                  </div>
                </div>
                <div className="border-t border-os-border/20 px-3 pb-3 pt-2.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-medium text-os-text">
                      {time.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </span>
                    <span className="font-mono text-[7px] uppercase tracking-[0.12em] text-os-text-dim">
                      Current month
                    </span>
                  </div>
                  <div className="grid grid-cols-7 text-center font-mono text-[7px] uppercase text-os-text-dim">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                      <span key={`${day}-${index}`} className="py-1">
                        {day}
                      </span>
                    ))}
                    {calendarDays.map((day, index) => {
                      const isToday = day === time.getDate();
                      return (
                        <span
                          key={`${day ?? 'empty'}-${index}`}
                          className={`grid h-6 place-items-center text-[8px] ${day === null ? 'text-transparent' : isToday ? 'bg-os-accent font-semibold text-[#05080d]' : 'text-os-text-muted'}`}
                        >
                          {day ?? '·'}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
