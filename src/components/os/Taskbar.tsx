import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Battery,
  Bell,
  Eye,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  Music,
  Pin,
  PinOff,
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

interface TaskbarProps {
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
  onOpenSystemApp: (appId: SystemAppId) => void;
  musicOpen: boolean;
  onToggleMusic: () => void;
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
  onOpenSystemApp,
  musicOpen,
  onToggleMusic,
}: TaskbarProps) {
  const [time, setTime] = useState(new Date());
  const [volume, setVolume] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('nammu-volume');
      return saved !== null ? Number(saved) : 72;
    } catch {
      return 72;
    }
  });
  const [lastVolume, setLastVolume] = useState<number>(72);
  const [showVolume, setShowVolume] = useState(false);
  const [showWheelTooltip, setShowWheelTooltip] = useState(false);
  const tooltipTimeoutRef = useRef<number | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showClock, setShowClock] = useState(false);
  const [notifications] = useState([
    { id: 1, text: 'NammuOS initialized', time: 'Just now', read: true },
    { id: 2, text: 'All systems nominal', time: 'Just now', read: true },
  ]);
  const contextMenu = useContextMenu();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const updateVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    setVolume(clamped);
    try {
      localStorage.setItem('nammu-volume', String(clamped));
    } catch {}

    // Synchronize HTMLMediaElements across the whole OS
    document.querySelectorAll('audio, video').forEach((el) => {
      try {
        (el as HTMLMediaElement).volume = clamped / 100;
      } catch {}
    });

    // Broadcast system volume event
    window.dispatchEvent(
      new CustomEvent('nammu-volume-change', {
        detail: { volume: clamped / 100 },
      }),
    );
  }, []);

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
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const formatFullTime = (d: Date) =>
    d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
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
    <div
      className="fixed bottom-0 left-0 right-0 h-[32px] z-9998 flex items-center px-2 gap-1"
      style={{
        background: 'linear-gradient(180deg, rgba(10,14,26,0.95) 0%, rgba(5,5,5,0.98) 100%)',
        borderTop: '1px solid rgba(30,58,138,0.35)',
      }}
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
        className={`flex h-7 w-8 items-center justify-center transition-colors ${startMenuOpen ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
        title="NammuOS apps"
        aria-label="Toggle NammuOS apps"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="9" cy="7" r="5" stroke="#4aa3ff" strokeWidth="1.15" />
          <path d="M4.4 4.4a5 5 0 000 5.2" stroke="#8ec4ff" strokeWidth="1.15" />
          <ellipse
            cx="9"
            cy="7"
            rx="7.2"
            ry="1.7"
            stroke="#8bb4d4"
            strokeWidth="0.6"
            opacity="0.55"
            transform="rotate(-18 9 7)"
          />
        </svg>
      </button>

      <div className="w-px h-5 bg-os-border/30 mx-1" />

      {/* Pinned apps & tools */}
      <div className="flex items-center gap-0.5">
        {pinnedTools.map((pinnedId) => {
          const item = resolvePinnedItem(pinnedId);
          if (!item) return null;
          const isOpen = openTools.some((w) => w.toolId === item.windowId || w.toolId === item.id);
          const isMinimized = minimizedTools.some(
            (w) => w.toolId === item.windowId || w.toolId === item.id,
          );
          const existing = windows.find((w) => w.toolId === item.windowId || w.toolId === item.id);
          const Icon = item.icon;
          return (
            <button
              key={pinnedId}
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
              className={`taskbar-button relative ${isOpen || isMinimized ? 'active' : ''} ${isOpen ? 'pinned' : ''}`}
              title={item.name}
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
              className={`taskbar-button max-w-35 ${win.isFocused ? 'active' : ''}`}
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
                      action: () => (isPinned ? onUnpinTool(targetPinId) : onPinTool(targetPinId)),
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
              <Icon size={16} className={win.isFocused ? 'text-os-accent' : 'text-os-text-muted'} />
              <span className="text-[10px] text-os-text truncate hidden md:block">{win.title}</span>
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
              className="taskbar-button opacity-60 hover:opacity-100"
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
                      action: () => (isPinned ? onUnpinTool(targetPinId) : onPinTool(targetPinId)),
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
          <div className="relative flex items-center" onWheel={handleVolumeWheel}>
            <button
              title={`Volume: ${volume}% (Scroll mouse wheel to adjust)`}
              onClick={() => {
                setShowVolume(!showVolume);
                setShowNotifications(false);
                setShowClock(false);
              }}
              className="cursor-pointer text-os-text-muted hover:text-os-accent flex items-center bg-transparent border-0 p-0 transition-colors"
            >
              {volume === 0 ? <VolumeX size={13} className="text-os-red" /> : <Volume2 size={13} />}
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
                className="absolute bottom-10 right-0 w-64 border border-white/[0.09] bg-[#070b12]/96 p-3.5 shadow-[0_24px_60px_rgba(0,0,0,0.7)] backdrop-blur-2xl rounded-lg z-50 flex flex-col gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                  <div className="flex items-center gap-1.5 text-[#8aa0b2]">
                    <Sliders size={12} className="text-[#4aa3ff]" />
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8aa0b2] font-medium">
                      Master Volume
                    </span>
                  </div>
                  <span className="font-mono text-[9px] text-[#4a5c6c] tracking-wider">
                    {volume === 0 ? 'MUTED' : `${volume}%`}
                  </span>
                </div>

                {/* Slider Row */}
                <div className="flex items-center gap-2.5 bg-black/25 p-2 rounded border border-white/[0.05]">
                  <button
                    onClick={toggleMute}
                    className={`cursor-pointer p-1.5 rounded transition-all flex items-center justify-center shrink-0 ${
                      volume === 0
                        ? 'bg-rose-500/20 text-[#f43f5e] border border-rose-500/30'
                        : 'text-[#8aa0b2] hover:text-[#4aa3ff] hover:bg-white/[0.05]'
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
                      className="w-full h-2 bg-[#141b27] border border-white/20 rounded-full cursor-pointer appearance-none accent-[#4aa3ff] focus:outline-none"
                      style={{
                        background: `linear-gradient(90deg, #4aa3ff 0%, #4aa3ff ${volume}%, rgba(255,255,255,0.12) ${volume}%, rgba(255,255,255,0.12) 100%)`,
                      }}
                      aria-label="Volume slider"
                    />
                  </div>

                  <span className="font-mono text-[11px] font-medium text-[#d5e0ea] w-9 text-right shrink-0">
                    {volume}%
                  </span>
                </div>

                {/* Quick Presets */}
                <div className="grid grid-cols-5 gap-1 pt-0.5">
                  {[0, 25, 50, 75, 100].map((level) => (
                    <button
                      key={level}
                      onClick={() => updateVolume(level)}
                      className={`py-1 rounded text-[9px] font-mono transition-all border ${
                        volume === level
                          ? 'border-[#4aa3ff]/60 bg-[#4aa3ff]/15 text-[#4aa3ff] font-semibold'
                          : 'border-white/[0.06] bg-white/[0.02] text-[#6b8296] hover:text-[#c5d2de] hover:border-white/20 hover:bg-white/[0.06]'
                      }`}
                    >
                      {level === 0 ? 'Mute' : `${level}%`}
                    </button>
                  ))}
                </div>

                <div className="text-[9px] text-[#4a5c6c] font-mono text-center pt-1 border-t border-white/[0.04]">
                  Tip: Scroll on taskbar volume icon
                </div>
              </div>
            )}
          </div>

          {/* Notifications bell */}
          <div className="relative flex items-center">
            <button
              title="Notifications"
              onClick={() => {
                setShowNotifications(!showNotifications);
                setShowVolume(false);
                setShowClock(false);
              }}
              className="cursor-pointer text-os-text-muted hover:text-os-accent flex items-center bg-transparent border-0 p-0 transition-colors relative"
            >
              <Bell size={13} />
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-os-accent" />
            </button>
            {showNotifications && (
              <div className="absolute bottom-9 right-0 w-64 bg-[#0a0e1a]/95 border border-os-border/40 rounded shadow-2xl p-3 z-50 backdrop-blur-md">
                <div className="flex items-center justify-between pb-2 border-b border-os-border/20 text-[11px] font-semibold text-os-text">
                  <span>Notifications</span>
                  <button
                    onClick={() => setShowNotifications(false)}
                    className="text-os-text-muted hover:text-os-text"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto os-scrollbar">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className="p-1.5 rounded bg-os-surface/40 border border-os-border/20 text-[10px]"
                    >
                      <div className="text-os-text font-medium">{n.text}</div>
                      <div className="text-os-text-dim text-[9px] mt-0.5">{n.time}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <span title="Battery: 100%" className="text-os-text-muted flex items-center">
            <Battery size={13} />
          </span>
        </div>

        <div className="w-px h-4 bg-os-border/30" />

        {/* Date & Time display */}
        <div className="relative flex items-center">
          <button
            onClick={() => {
              setShowClock(!showClock);
              setShowVolume(false);
              setShowNotifications(false);
            }}
            className="flex flex-col items-end px-2 py-0.5 text-right hover:bg-white/[0.04] rounded transition-colors"
            title={formatFullDate(time)}
          >
            <span className="text-[11px] font-mono text-[#d5e0ea] leading-tight font-medium">
              {formatTime(time)}
            </span>
            <span className="text-[9px] font-mono text-[#6d8294] leading-tight">
              {formatDate(time)}
            </span>
          </button>
          {showClock && (
            <div className="absolute bottom-9 right-0 w-64 bg-[#0a0e1a]/95 border border-os-border/40 rounded shadow-2xl p-3 z-50 backdrop-blur-md">
              <div className="text-center pb-1">
                <div className="text-xl font-mono text-os-accent font-semibold tracking-wider">
                  {formatFullTime(time)}
                </div>
                <div className="text-xs font-mono text-os-text-muted mt-1">
                  {formatFullDate(time)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
