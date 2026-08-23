'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

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
import { TOOLS, findToolById, findToolsByFileType } from '../../lib/toolRegistry';

// Tool imports
import {
  ImgToWebp,
  ImgToAvif,
  ImgToPng,
  ImgToJpg,
  SvgToPng,
  SvgToWebp,
  VideoConverter,
  VideoToHls,
  VideoToGif,
  GifToVideo,
  VideoToAudio,
  AudioConverter,
  PdfToImages,
  ImagesToPdf,
  JsonYaml,
  JsonCsv,
  UnixTimestamp,
  OvenTemp,
} from '../../tools/Converters';
import {
  ImgCompress,
  ImgResize,
  ImgCrop,
  BulkImgConvert,
  ImgMetadataClean,
  ColorExtract,
  PaletteGen,
  SvgOptimize,
} from '../../tools/Image';
import {
  VideoCompress,
  VideoTrim,
  FrameExtract,
  VideoThumbnails,
  VideoMetadata,
} from '../../tools/Video';
import { AudioCompress, AudioTrim, Id3Edit, WaveformGen } from '../../tools/Audio';
import {
  PdfMerge,
  PdfSplit,
  PdfCompress,
  PdfExtractReorder,
  PdfMetadata,
  PdfPassword,
  PdfWatermark,
} from '../../tools/PDF';
import {
  JsonFormat,
  Base64,
  UrlEncode,
  JwtInspect,
  HashGen,
  UuidGen,
  RegexTester,
  DiffChecker,
  MarkdownPreview,
  CodeMinify,
  DEVELOPER_TOOLS,
} from '../../tools/Developer';
import { QrGen, UTILITY_TOOLS } from '../../tools/Utilities';
import { CALCULATOR_TOOLS } from '../../tools/CalculatorSuite';
import { GENERATOR_TOOLS } from '../../tools/Generators';
import { TEXT_TOOLS } from '../../tools/TextTools';
import { COLOR_TOOLS } from '../../tools/ColorTools';
import { Music } from '../os/Music';

const TOOL_COMPONENTS: Record<string, React.FC<any>> = {
  ImgToWebp,
  ImgToAvif,
  ImgToPng,
  ImgToJpg,
  SvgToPng,
  SvgToWebp,
  VideoConverter,
  VideoToHls,
  VideoToGif,
  GifToVideo,
  VideoToAudio,
  AudioConverter,
  PdfToImages,
  ImagesToPdf,
  JsonYaml,
  JsonCsv,
  UnixTimestamp,
  OvenTemp,
  ImgCompress,
  ImgResize,
  ImgCrop,
  BulkImgConvert,
  ImgMetadataClean,
  ColorExtract,
  PaletteGen,
  SvgOptimize,
  VideoCompress,
  VideoTrim,
  FrameExtract,
  VideoThumbnails,
  VideoMetadata,
  AudioCompress,
  AudioTrim,
  Id3Edit,
  WaveformGen,
  PdfMerge,
  PdfSplit,
  PdfCompress,
  PdfExtractReorder,
  PdfMetadata,
  PdfPassword,
  PdfWatermark,
  ...DEVELOPER_TOOLS,
  ...UTILITY_TOOLS,
  ...CALCULATOR_TOOLS,
  ...GENERATOR_TOOLS,
  ...TEXT_TOOLS,
  ...COLOR_TOOLS,
};

const DEFAULT_PINS = ['firefox', 'whatsapp', 'files', 'terminal', 'cloud', 'settings'];

function getPinned(): string[] {
  try {
    const item = localStorage.getItem('nammu-pinned');
    if (item === null) {
      localStorage.setItem('nammu-pinned', JSON.stringify(DEFAULT_PINS));
      return DEFAULT_PINS;
    }
    return JSON.parse(item);
  } catch {
    return DEFAULT_PINS;
  }
}
function setPinned(pinned: string[]) {
  localStorage.setItem('nammu-pinned', JSON.stringify(pinned));
}

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem('nammu-recent') || '[]');
  } catch {
    return [];
  }
}
function setRecent(recent: string[]) {
  localStorage.setItem('nammu-recent', JSON.stringify(recent.slice(0, 10)));
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
  const [pinnedTools, setPinnedTools] = useState<string[]>(getPinned());
  const [recentTools, setRecentTools] = useState<string[]>(getRecent());
  const [suggestedTools, setSuggestedTools] = useState<string[]>([]);
  const [musicOpen, setMusicOpen] = useState(true);
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
      fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_id: toolId, tool_name: tool.name, category: tool.category }),
      }).catch(() => {});
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
    fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned_tools: pinnedTools, settings: {} }),
    }).catch(() => {});
  }, [pinnedTools]);

  // Load preferences from API on mount
  useEffect(() => {
    fetch('/api/preferences')
      .then((r) => r.json())
      .then((data) => {
        if (
          localStorage.getItem('nammu-pinned') === null &&
          data?.pinned_tools &&
          Array.isArray(data.pinned_tools)
        ) {
          setPinnedTools(data.pinned_tools);
          localStorage.setItem('nammu-pinned', JSON.stringify(data.pinned_tools));
        }
      })
      .catch(() => {});
    fetch('/api/history')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const recent = data.map((h: any) => h.tool_id).slice(0, 10);
          setRecentTools(recent);
          localStorage.setItem('nammu-recent', JSON.stringify(recent));
        }
      })
    // Initialize OS Theme
    try {
      const saved = localStorage.getItem('nammu-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.themeStyle) {
          document.documentElement.setAttribute('data-theme', parsed.themeStyle);
        }
        if (parsed.accentColor) {
          document.documentElement.style.setProperty('--os-accent', parsed.accentColor);
        }
      }
    } catch {}

    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: string }>;
      if (customEvent.detail?.theme) {
        document.documentElement.setAttribute('data-theme', customEvent.detail.theme);
      }
    };
    window.addEventListener('nammu-theme-change', handleThemeChange);
    return () => window.removeEventListener('nammu-theme-change', handleThemeChange);
  }, []);

  return (
    <ContextMenuProvider safeArea={contextMenuSafeArea}>
      <div
        className={`h-screen w-screen overflow-hidden relative ${musicOpen ? 'music-panel-open' : 'music-panel-minimized'}`}
        style={{ background: '#050505' }}
      >
        {/* Subtle scanline */}
        <div className="os-scanline" />

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
            >
              {systemApp ? (
                <SystemAppContent appId={systemApp.id} />
              ) : Component ? (
                <div className="h-full p-3">
                  <Component initialData={win.data} />
                </div>
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
          onOpenSystemApp={openSystemApp}
          musicOpen={musicOpen}
          onToggleMusic={() => setMusicOpen((current) => !current)}
        />
      </div>
      <ContextMenu />
    </ContextMenuProvider>
  );
}
