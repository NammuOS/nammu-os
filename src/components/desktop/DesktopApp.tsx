'use client';

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react';

import { useWindowManager } from '../../hooks/useWindowManager';
import Window from '../os/Window';
import Taskbar from '../os/Taskbar';
import Launcher from '../os/Launcher';
import Desktop from '../os/Desktop';
import StartMenu from '../os/StartMenu';
import Rail from '../os/Rail';
import ContextMenu from '../context-menu/ContextMenu';
import { ContextMenuProvider } from '../context-menu/contextMenuStore';
import { SystemAppContent } from '../os/SystemApps';
import { findSystemApp, findSystemAppByWindowId, type SystemAppId } from '../os/systemAppRegistry';
import { findToolById, findToolsByFileType } from '../../lib/toolRegistry';
import { Music } from '../os/Music';
import { TOOL_COMPONENTS } from './toolComponents';
import LockScreen from '../os/LockScreen';
import { OS_LOCK_STATE_KEY, getStoredLockState, saveLockState } from '../../lib/osLock';
import { applyIconSettings } from '../../lib/iconSettings';
import { getPlatformCapabilities } from '../../platform';
import { NAMMU_OPEN_DOCUMENT_EVENT, type NammuOpenDocumentDetail } from '../../lib/appLaunch';
import {
  DEFAULT_SYSTEM_ACCENT,
  DEFAULT_SYSTEM_THEME,
  resolveInitialSystemTheme,
} from '../../lib/systemTheme';

const DEFAULT_PINS = ['browser', 'whatsapp', 'files', 'terminal', 'cloud', 'settings'];
const platformServices = getPlatformCapabilities().services;

function uniqueIds(values: unknown[], limit?: number): string[] {
  const unique = [...new Set(values.filter((value): value is string => typeof value === 'string'))];
  return typeof limit === 'number' ? unique.slice(0, limit) : unique;
}

function normalizePinnedIds(values: unknown[]): string[] {
  return uniqueIds(values.map((value) => (value === 'firefox' ? 'browser' : value)));
}

function getPinned(): string[] {
  try {
    const item = localStorage.getItem('nammu-pinned');
    if (item === null) {
      localStorage.setItem('nammu-pinned', JSON.stringify(DEFAULT_PINS));
      return DEFAULT_PINS;
    }
    const parsed = JSON.parse(item);
    if (!Array.isArray(parsed)) return DEFAULT_PINS;

    const pinned = normalizePinnedIds(parsed);
    if (JSON.stringify(pinned) !== JSON.stringify(parsed)) {
      localStorage.setItem('nammu-pinned', JSON.stringify(pinned));
    }
    return pinned;
  } catch {
    return DEFAULT_PINS;
  }
}
function getRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('nammu-recent') || '[]');
    return Array.isArray(parsed) ? uniqueIds(parsed, 10) : [];
  } catch {
    return [];
  }
}
export default function DesktopApp() {
  const {
    windows,
    openWindow,
    closeWindow,
    focusWindow,
    minimizeWindow,
    restoreWindow,
    maximizeWindow,
    moveWindow,
    resizeWindow,
    snapWindow,
    fitWindows,
  } = useWindowManager();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [taskbarFlyoutOpen, setTaskbarFlyoutOpen] = useState(false);
  const [pinnedTools, setPinnedTools] = useState<string[]>(getPinned());
  const [recentTools, setRecentTools] = useState<string[]>(getRecent());
  const [suggestedTools, setSuggestedTools] = useState<string[]>([]);
  const [musicOpen, setMusicOpen] = useState(true);
  const [isLocked, setIsLocked] = useState(getStoredLockState);
  const contextMenuSafeArea = useMemo(
    () => ({ left: 36, right: musicOpen ? 292 : 0, bottom: 32, top: 0, margin: 6 }),
    [musicOpen],
  );

  const openTool = useCallback(
    (toolId: string, data?: any) => {
      const tool = findToolById(toolId);
      if (!tool) return;
      openWindow(toolId, tool.name, data, musicOpen ? 292 : 0);
      setRecentTools((prev) => {
        const filtered = prev.filter((id) => id !== toolId);
        const updated = [toolId, ...filtered].slice(0, 10);
        localStorage.setItem('nammu-recent', JSON.stringify(updated));
        return updated;
      });
      // Record history
      platformServices
        .request('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool_id: toolId, tool_name: tool.name, category: tool.category }),
        })
        .catch(() => {});
    },
    [musicOpen, openWindow],
  );

  const openSystemApp = useCallback(
    (appId: SystemAppId) => {
      const app = findSystemApp(appId);
      if (!app) return;
      const existing = windows.find((windowState) => windowState.toolId === app.windowId);
      if (existing) {
        if (existing.isMinimized) restoreWindow(existing.id);
        else focusWindow(existing.id);
        return;
      }
      openWindow(app.windowId, app.title, undefined, musicOpen ? 292 : 0);
    },
    [focusWindow, musicOpen, openWindow, restoreWindow, windows],
  );

  const toggleSystemApp = useCallback(
    (appId: SystemAppId) => {
      const app = findSystemApp(appId);
      if (!app) return;
      const existing = windows.find((windowState) => windowState.toolId === app.windowId);
      if (!existing) openWindow(app.windowId, app.title, undefined, musicOpen ? 292 : 0);
      else if (existing.isMinimized) restoreWindow(existing.id);
      else if (existing.isFocused) minimizeWindow(existing.id);
      else focusWindow(existing.id);
    },
    [focusWindow, minimizeWindow, musicOpen, openWindow, restoreWindow, windows],
  );

  useEffect(() => {
    const handleOpenDocument = (event: Event) => {
      const detail = (event as CustomEvent<NammuOpenDocumentDetail>).detail;
      if (detail?.appId !== 'pdf') return;
      const app = findSystemApp('pdf');
      if (!app) return;
      const existing = windows.find((windowState) => windowState.toolId === app.windowId);
      if (existing) {
        if (existing.isMinimized) restoreWindow(existing.id);
        else focusWindow(existing.id);
        return;
      }
      openWindow(app.windowId, app.title, { openRequest: detail.request }, musicOpen ? 292 : 0);
    };
    window.addEventListener(NAMMU_OPEN_DOCUMENT_EVENT, handleOpenDocument);
    return () => window.removeEventListener(NAMMU_OPEN_DOCUMENT_EVENT, handleOpenDocument);
  }, [focusWindow, musicOpen, openWindow, restoreWindow, windows]);

  useEffect(() => {
    fitWindows(musicOpen ? 292 : 0);
  }, [fitWindows, musicOpen]);

  const handlePin = useCallback((toolId: string) => {
    setPinnedTools((prev) => {
      const norm = toolId.startsWith('system:') ? toolId.replace('system:', '') : toolId;
      if (prev.includes(toolId) || prev.includes(norm) || prev.includes(`system:${norm}`)) {
        return prev;
      }
      const updated = [...prev, norm];
      localStorage.setItem('nammu-pinned', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleUnpin = useCallback((toolId: string) => {
    setPinnedTools((prev) => {
      const norm = toolId.startsWith('system:') ? toolId.replace('system:', '') : toolId;
      const updated = prev.filter((id) => id !== toolId && id !== norm && id !== `system:${norm}`);
      localStorage.setItem('nammu-pinned', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleReorderPinned = useCallback((sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setPinnedTools((current) => {
      const sourceIndex = current.indexOf(sourceId);
      const targetIndex = current.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const reordered = [...current];
      const [moved] = reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, moved);
      localStorage.setItem('nammu-pinned', JSON.stringify(reordered));
      return reordered;
    });
  }, []);

  const handleFileDrop = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const validTools = findToolsByFileType(file.type).map((t) => t.id);
    setSuggestedTools(validTools);
    setLauncherOpen(false);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault();
        setLauncherOpen((prev) => !prev);
        setStartMenuOpen(false);
      }
      if (e.key === 'Escape') {
        setLauncherOpen(false);
        setStartMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    const handleDesktopTyping = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      const hasVisibleWindow = windows.some((windowState) => !windowState.isMinimized);
      if (
        hasVisibleWindow ||
        launcherOpen ||
        startMenuOpen ||
        isEditable ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key.length !== 1
      )
        return;
      event.preventDefault();
      setSearchQuery(event.key);
      setLauncherOpen(true);
      setStartMenuOpen(false);
    };
    window.addEventListener('keydown', handleDesktopTyping);
    return () => window.removeEventListener('keydown', handleDesktopTyping);
  }, [launcherOpen, startMenuOpen, windows]);

  // Save preferences to API when they change
  useEffect(() => {
    platformServices
      .request('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned_tools: pinnedTools, settings: {} }),
      })
      .catch(() => {});
  }, [pinnedTools]);

  // Load preferences from API on mount
  useEffect(() => {
    platformServices
      .request('/api/preferences')
      .then((r) => r.json())
      .then((data) => {
        if (
          localStorage.getItem('nammu-pinned') === null &&
          data?.pinned_tools &&
          Array.isArray(data.pinned_tools)
        ) {
          const pinned = normalizePinnedIds(data.pinned_tools);
          setPinnedTools(pinned);
          localStorage.setItem('nammu-pinned', JSON.stringify(pinned));
        }
      })
      .catch(() => {});
    platformServices
      .request('/api/history')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const recent = uniqueIds(
            data.map((h: any) => h.tool_id),
            10,
          );
          setRecentTools(recent);
          localStorage.setItem('nammu-recent', JSON.stringify(recent));
        }
      });
    // Initialize OS Theme
    try {
      const saved = localStorage.getItem('nammu-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        applyIconSettings(document.documentElement, parsed);
        const { theme, migratedLegacyDefault } = resolveInitialSystemTheme(
          parsed.themeStyle,
          localStorage,
        );
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.setAttribute(
          'data-crt-scanlines',
          migratedLegacyDefault || parsed.enableScanlines === false ? 'off' : 'on',
        );
        if (parsed.themeStyle !== theme || migratedLegacyDefault) {
          localStorage.setItem(
            'nammu-settings',
            JSON.stringify({
              ...parsed,
              themeStyle: theme,
              accentColor: migratedLegacyDefault ? DEFAULT_SYSTEM_ACCENT : parsed.accentColor,
              enableScanlines: migratedLegacyDefault ? false : parsed.enableScanlines,
            }),
          );
        }
        const appearance = parsed.appearance === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-appearance', appearance);
        document.documentElement.style.colorScheme = appearance;
        const accentColor = migratedLegacyDefault ? DEFAULT_SYSTEM_ACCENT : parsed.accentColor;
        if (accentColor) {
          document.documentElement.style.setProperty('--os-accent', accentColor);
          document.documentElement.style.setProperty('--color-os-accent', accentColor);
        }
        document.documentElement.setAttribute(
          'data-reduced-motion',
          parsed.reduceMotion === true ? 'on' : 'off',
        );
      } else {
        resolveInitialSystemTheme(undefined, localStorage);
        applyIconSettings(document.documentElement, null);
        document.documentElement.setAttribute('data-theme', DEFAULT_SYSTEM_THEME);
        document.documentElement.setAttribute('data-appearance', 'dark');
        document.documentElement.setAttribute('data-crt-scanlines', 'off');
        document.documentElement.setAttribute('data-reduced-motion', 'off');
        document.documentElement.style.colorScheme = 'dark';
      }
    } catch {}

    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{
        theme: string;
        appearance?: 'light' | 'dark';
        enableScanlines?: boolean;
        reduceMotion?: boolean;
      }>;
      if (customEvent.detail?.theme) {
        document.documentElement.setAttribute('data-theme', customEvent.detail.theme);
      }
      if (customEvent.detail?.appearance) {
        document.documentElement.setAttribute('data-appearance', customEvent.detail.appearance);
        document.documentElement.style.colorScheme = customEvent.detail.appearance;
      }
      if (typeof customEvent.detail?.enableScanlines === 'boolean') {
        document.documentElement.setAttribute(
          'data-crt-scanlines',
          customEvent.detail.enableScanlines ? 'on' : 'off',
        );
      }
      if (typeof customEvent.detail?.reduceMotion === 'boolean') {
        document.documentElement.setAttribute(
          'data-reduced-motion',
          customEvent.detail.reduceMotion ? 'on' : 'off',
        );
      }
    };
    window.addEventListener('nammu-theme-change', handleThemeChange);
    return () => window.removeEventListener('nammu-theme-change', handleThemeChange);
  }, []);

  const powerOff = useCallback(() => {
    setLauncherOpen(false);
    setStartMenuOpen(false);
    saveLockState(true);
    setIsLocked(true);
  }, []);

  const powerOn = useCallback(() => {
    saveLockState(false);
    setIsLocked(false);
  }, []);

  useEffect(() => {
    let idleTimer: number | null = null;
    const readAutoLockMinutes = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('nammu-settings') || '{}');
        const minutes = Number(saved.autoLockMinutes);
        return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
      } catch {
        return 0;
      }
    };
    const scheduleAutoLock = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      const minutes = readAutoLockMinutes();
      if (minutes <= 0 || isLocked) return;
      idleTimer = window.setTimeout(powerOff, minutes * 60_000);
    };
    const handleLockNow = () => powerOff();
    const handleLockStorage = (event: StorageEvent) => {
      if (event.key === OS_LOCK_STATE_KEY && event.newValue === 'true') setIsLocked(true);
    };
    const activityEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, scheduleAutoLock, { passive: true }),
    );
    window.addEventListener('nammu-theme-change', scheduleAutoLock);
    window.addEventListener('nammu-lock-now', handleLockNow);
    window.addEventListener('storage', handleLockStorage);
    scheduleAutoLock();
    return () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      activityEvents.forEach((eventName) =>
        window.removeEventListener(eventName, scheduleAutoLock),
      );
      window.removeEventListener('nammu-theme-change', scheduleAutoLock);
      window.removeEventListener('nammu-lock-now', handleLockNow);
      window.removeEventListener('storage', handleLockStorage);
    };
  }, [isLocked, powerOff]);

  if (isLocked) return <LockScreen onUnlock={powerOn} />;

  return (
    <ContextMenuProvider safeArea={contextMenuSafeArea}>
      <div
        className={`nammu-os-shell h-screen w-screen overflow-hidden relative ${musicOpen ? 'music-panel-open' : 'music-panel-minimized'}`}
      >
        <div className="os-scanline" aria-hidden="true" />

        {/* Desktop */}
        <Desktop
          onOpenTool={openTool}
          onOpenSystemApp={openSystemApp}
          onOpenLauncher={() => {
            setLauncherOpen(true);
            setStartMenuOpen(false);
          }}
          onFileDrop={handleFileDrop}
          suggestedTools={suggestedTools}
          onClearSuggestions={() => setSuggestedTools([])}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchActive={launcherOpen}
          onSearchActiveChange={(active) => {
            setLauncherOpen(active);
            if (active) setStartMenuOpen(false);
          }}
        />

        <Rail
          windows={windows}
          searchActive={launcherOpen}
          onHome={() => {
            windows
              .filter((windowState) => !windowState.isMinimized)
              .forEach((windowState) => minimizeWindow(windowState.id));
            setLauncherOpen(false);
            setStartMenuOpen(false);
          }}
          onOpenSearch={() => {
            setLauncherOpen(true);
            setStartMenuOpen(false);
          }}
          onOpenSystemApp={toggleSystemApp}
          onFocusWindow={focusWindow}
          onRestoreWindow={restoreWindow}
          onMinimizeWindow={minimizeWindow}
          onCloseWindow={closeWindow}
        />

        {/* Right-side listening workspace */}
        <Music isOpen={musicOpen} onMinimize={() => setMusicOpen(false)} />

        {/* Windows */}
        {windows.map((win) => {
          const tool = findToolById(win.toolId);
          const systemApp = findSystemAppByWindowId(win.toolId);
          const Component = tool ? TOOL_COMPONENTS[tool.component] : null;
          if (!Component && !systemApp) return null;
          return (
            <Window
              key={win.id}
              win={win}
              onClose={closeWindow}
              onFocus={focusWindow}
              onMinimize={minimizeWindow}
              onMaximize={maximizeWindow}
              onSnap={snapWindow}
              onMove={moveWindow}
              onResize={resizeWindow}
              rightInset={musicOpen ? 292 : 0}
              shellOverlayActive={launcherOpen || startMenuOpen || taskbarFlyoutOpen}
            >
              {systemApp ? (
                <SystemAppContent appId={systemApp.id} initialData={win.data} />
              ) : Component ? (
                <Suspense
                  fallback={
                    <div className="horizon-app-loading h-full" aria-label="Opening tool" />
                  }
                >
                  <div
                    data-nammu-tool={tool?.id}
                    className={
                      tool?.id === 'subdomain-discovery'
                        ? 'nammu-app-surface h-full overflow-hidden'
                        : 'nammu-app-surface h-full overflow-auto p-3'
                    }
                  >
                    <Component initialData={win.data} />
                  </div>
                </Suspense>
              ) : null}
            </Window>
          );
        })}

        {/* Launcher */}
        <Launcher
          isOpen={launcherOpen}
          onClose={() => {
            setLauncherOpen(false);
            setSearchQuery('');
          }}
          onOpenTool={openTool}
          onOpenSystemApp={openSystemApp}
          pinnedTools={pinnedTools}
          recentTools={recentTools}
          onPinTool={handlePin}
          onUnpinTool={handleUnpin}
          suggestedTools={suggestedTools.length > 0 ? suggestedTools : undefined}
          searchQuery={searchQuery}
        />

        <StartMenu
          isOpen={startMenuOpen}
          onClose={() => setStartMenuOpen(false)}
          onOpenTool={openTool}
          onOpenSystemApp={openSystemApp}
        />

        {/* Taskbar */}
        <Taskbar
          windows={windows}
          pinnedTools={pinnedTools}
          onToggleStartMenu={() => {
            setStartMenuOpen((current) => !current);
            setLauncherOpen(false);
          }}
          startMenuOpen={startMenuOpen}
          onOpenTool={openTool}
          onFocusWindow={focusWindow}
          onRestoreWindow={restoreWindow}
          onMinimizeWindow={minimizeWindow}
          onMaximizeWindow={maximizeWindow}
          onCloseWindow={closeWindow}
          onPinTool={handlePin}
          onUnpinTool={handleUnpin}
          onReorderPinned={handleReorderPinned}
          onOpenSystemApp={openSystemApp}
          musicOpen={musicOpen}
          onToggleMusic={() => setMusicOpen((current) => !current)}
          onPowerOff={powerOff}
          onFlyoutVisibilityChange={setTaskbarFlyoutOpen}
        />
      </div>
      <ContextMenu />
    </ContextMenuProvider>
  );
}
