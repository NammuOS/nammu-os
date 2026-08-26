import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  Plus,
  Home,
  Lock,
  Search,
  Star,
  Globe,
  Share2,
  Terminal,
  History as HistoryIcon,
  ExternalLink,
  Cpu,
  Smartphone,
  Tablet,
  Laptop,
  Monitor,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Sparkles,
  Copy,
  Scissors,
  Clipboard,
  Volume2,
  VolumeX,
  Pin,
  FileCode,
  CornerDownLeft,
  Trash2,
} from 'lucide-react';
import {
  BrowserTab,
  Bookmark,
  HistoryEntry,
  DEFAULT_QUICK_DIALS,
  getStoredBookmarks,
  saveStoredBookmarks,
  getStoredHistory,
  saveStoredHistory,
  normalizeBrowserUrl,
  getDomainFavicon,
  SearchEngine,
} from './services/browserEngine';

const FIREFOX_RUNTIME_URL = '/firefox-wasm/index.html';

type GeckoRuntimeWindow = Window & {
  geckoEvalChrome?: (script: string) => Promise<unknown>;
};

interface GeckoPageState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

function getBrowserRuntimeUrl(url: string) {
  const params = new URLSearchParams({ app: '1', autostart: '1', url });
  return `${FIREFOX_RUNTIME_URL}?${params.toString()}`;
}

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  type: 'tab' | 'omnibox' | 'page' | 'bookmark';
  targetTabId?: string;
  targetBookmarkId?: string;
}

export default function BrowserApp() {
  // Tabs State
  const [tabs, setTabs] = useState<BrowserTab[]>([
    {
      id: 'tab-1',
      title: 'Nammu OS · Web Home',
      url: 'about:home',
      favicon: '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      history: ['about:home'],
      historyIndex: 0,
      engineMode: 'wasm',
      isPinned: false,
      isMuted: false,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');

  // Active tab reference
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Address Bar State
  const [omniboxInput, setOmniboxInput] = useState<string>(
    activeTab?.url === 'about:home' ? '' : activeTab?.url || '',
  );
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [searchEngine] = useState<SearchEngine>('google');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);

  // Bookmarks & History State
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(getStoredBookmarks);
  const [history, setHistory] = useState<HistoryEntry[]>(getStoredHistory);
  const [showBookmarksBar] = useState<boolean>(true);
  const [sidePanel, setSidePanel] = useState<'none' | 'history' | 'bookmarks' | 'devtools'>('none');

  // DevTools & Viewport State
  const [devLogs, setDevLogs] = useState<
    { type: 'log' | 'warn' | 'error'; msg: string; time: string }[]
  >([]);
  const [networkLogs, setNetworkLogs] = useState<
    { url: string; method: string; status: number; time: string }[]
  >([]);
  const [viewportMode, setViewportMode] = useState<'responsive' | 'desktop' | 'tablet' | 'mobile'>(
    'responsive',
  );
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  // Optimized In-Browser Context Menu State
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    type: 'page',
  });

  const browserRootRef = useRef<HTMLDivElement>(null);
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const runtimeInitialUrls = useRef<Record<string, string>>({});
  const lastObservedUrls = useRef<Record<string, string>>({});
  const omniboxRef = useRef<HTMLInputElement>(null);
  const [mountedTabIds, setMountedTabIds] = useState<string[]>([]);
  const [readyTabIds, setReadyTabIds] = useState<string[]>([]);

  // Sync address bar input when active tab changes
  useEffect(() => {
    if (activeTab) {
      setOmniboxInput(activeTab.url === 'about:home' ? '' : activeTab.url);
    }
  }, [activeTab]);

  const evaluateInRuntime = useCallback(async (tabId: string, script: string) => {
    const runtimeWindow = iframeRefs.current[tabId]?.contentWindow as GeckoRuntimeWindow | null;
    if (!runtimeWindow?.geckoEvalChrome) return null;
    return runtimeWindow.geckoEvalChrome(script);
  }, []);

  const mountRuntime = useCallback((tabId: string, url: string) => {
    if (!runtimeInitialUrls.current[tabId]) {
      runtimeInitialUrls.current[tabId] = url;
    }
    setMountedTabIds((current) => (current.includes(tabId) ? current : [...current, tabId]));
  }, []);

  // Close context menu on outside click or escape
  useEffect(() => {
    const handleDismiss = () => {
      if (contextMenu.isOpen) {
        setContextMenu((prev) => ({ ...prev, isOpen: false }));
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismiss();
    };
    window.addEventListener('click', handleDismiss);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleDismiss);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu.isOpen]);

  // Global browser keyboard shortcuts
  useEffect(() => {
    const handleBrowserShortcuts = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          handleNewTab();
        } else if (e.key === 'w' || e.key === 'W') {
          e.preventDefault();
          handleCloseTab(activeTabId);
        } else if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          handleReload();
        } else if (e.key === 'l' || e.key === 'L') {
          e.preventDefault();
          omniboxRef.current?.focus();
          omniboxRef.current?.select();
        } else if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          handleToggleBookmark();
        }
      }
    };
    window.addEventListener('keydown', handleBrowserShortcuts);
    return () => window.removeEventListener('keydown', handleBrowserShortcuts);
    // Handlers are declared below and intentionally rebound with the current browser state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeTab]);

  // Connect the Nammu browser shell to the real embedded Gecko runtime.
  useEffect(() => {
    const handleRuntimeReady = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'NAMMU_GECKO_READY') {
        return;
      }

      const readyEntry = Object.entries(iframeRefs.current).find(
        ([, iframe]) => iframe?.contentWindow === event.source,
      );
      if (!readyEntry) return;

      const tabId = readyEntry[0];
      setReadyTabIds((current) => (current.includes(tabId) ? current : [...current, tabId]));
      setTabs((current) =>
        current.map((tab) => (tab.id === tabId ? { ...tab, isLoading: false } : tab)),
      );
      setDevLogs((current) => [
        {
          type: 'log',
          msg: `Gecko runtime ready for ${tabId}`,
          time: new Date().toLocaleTimeString(),
        },
        ...current.slice(0, 50),
      ]);
    };

    window.addEventListener('message', handleRuntimeReady);
    return () => window.removeEventListener('message', handleRuntimeReady);
  }, []);

  // Mirror real page state back into Nammu's tabs and omnibox.
  useEffect(() => {
    if (!activeTab || activeTab.url === 'about:home' || !readyTabIds.includes(activeTabId)) {
      return;
    }

    let cancelled = false;
    const syncPageState = async () => {
      try {
        const raw = await evaluateInRuntime(
          activeTabId,
          `JSON.stringify({
            url: gBrowser.currentURI?.spec || '',
            title: gBrowser.selectedBrowser?.contentTitle || gBrowser.currentURI?.spec || '',
            canGoBack: Boolean(gBrowser.canGoBack),
            canGoForward: Boolean(gBrowser.canGoForward),
            isLoading: Boolean(gBrowser.selectedBrowser?.webProgress?.isLoadingDocument)
          })`,
        );
        if (cancelled || typeof raw !== 'string') return;

        const page = JSON.parse(raw) as GeckoPageState;
        if (!page.url || page.url.startsWith('about:')) return;

        const previousObservedUrl = lastObservedUrls.current[activeTabId];
        lastObservedUrls.current[activeTabId] = page.url;
        const favicon = getDomainFavicon(page.url);

        setTabs((current) => {
          let changed = false;
          const updated = current.map((tab) => {
            if (tab.id !== activeTabId) return tab;
            const urlChanged = tab.url !== page.url;
            const nextHistory = urlChanged
              ? [...tab.history.slice(0, tab.historyIndex + 1), page.url]
              : tab.history;
            if (
              !urlChanged &&
              tab.title === (page.title || page.url) &&
              tab.favicon === favicon &&
              tab.isLoading === page.isLoading &&
              tab.canGoBack === page.canGoBack &&
              tab.canGoForward === page.canGoForward
            ) {
              return tab;
            }
            changed = true;
            return {
              ...tab,
              url: page.url,
              title: page.title || page.url,
              favicon,
              isLoading: page.isLoading,
              canGoBack: page.canGoBack,
              canGoForward: page.canGoForward,
              history: nextHistory,
              historyIndex: urlChanged ? nextHistory.length - 1 : tab.historyIndex,
            };
          });
          return changed ? updated : current;
        });

        if (page.url !== previousObservedUrl) {
          const entry: HistoryEntry = {
            id: `${Date.now()}-${activeTabId}`,
            title: page.title || page.url,
            url: page.url,
            timestamp: Date.now(),
            favicon,
          };
          setHistory((current) => {
            const updated = [entry, ...current.filter((item) => item.url !== page.url)].slice(
              0,
              100,
            );
            saveStoredHistory(updated);
            return updated;
          });
          setNetworkLogs((current) => [
            {
              url: page.url,
              method: 'GET',
              status: 200,
              time: new Date().toLocaleTimeString(),
            },
            ...current.slice(0, 50),
          ]);
        }
      } catch (error) {
        if (!cancelled) {
          setDevLogs((current) => [
            {
              type: 'error',
              msg: error instanceof Error ? error.message : String(error),
              time: new Date().toLocaleTimeString(),
            },
            ...current.slice(0, 50),
          ]);
        }
      }
    };

    void syncPageState();
    const timer = window.setInterval(syncPageState, 750);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeTab, activeTabId, evaluateInRuntime, readyTabIds]);

  useEffect(() => {
    if (!readyTabIds.includes(activeTabId) || activeTab?.url === 'about:home') return;
    void evaluateInRuntime(activeTabId, `ZoomManager.zoom = ${zoomLevel / 100}; 'ok'`);
  }, [activeTab?.url, activeTabId, evaluateInRuntime, readyTabIds, zoomLevel]);

  // Fetch search suggestions
  useEffect(() => {
    if (
      !isFocused ||
      !omniboxInput.trim() ||
      omniboxInput.startsWith('http') ||
      omniboxInput.includes('.')
    ) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(() => {
      fetch(`/api/browser/search?q=${encodeURIComponent(omniboxInput.trim())}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            setSuggestions(data.slice(0, 5));
            setShowSuggestions(true);
          } else {
            setSuggestions([]);
            setShowSuggestions(false);
          }
        })
        .catch(() => {
          setSuggestions([]);
          setShowSuggestions(false);
        });
    }, 200);

    return () => clearTimeout(timer);
  }, [omniboxInput, isFocused]);

  // Navigate to target URL
  const handleNavigate = useCallback(
    (targetUrl: string) => {
      const normalized = normalizeBrowserUrl(targetUrl, searchEngine);
      const favicon = getDomainFavicon(normalized);

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id === activeTabId) {
            const newHistory = [...tab.history.slice(0, tab.historyIndex + 1), normalized];
            const newIndex = newHistory.length - 1;
            return {
              ...tab,
              url: normalized,
              title: normalized === 'about:home' ? 'Nammu OS · Web Home' : normalized,
              favicon,
              isLoading: normalized !== 'about:home',
              canGoBack: newIndex > 0,
              canGoForward: false,
              history: newHistory,
              historyIndex: newIndex,
            };
          }
          return tab;
        }),
      );

      setOmniboxInput(normalized === 'about:home' ? '' : normalized);
      setShowSuggestions(false);

      if (normalized !== 'about:home') {
        if (readyTabIds.includes(activeTabId)) {
          void evaluateInRuntime(
            activeTabId,
            `openTrustedLinkIn(${JSON.stringify(normalized)}, 'current'); 'ok'`,
          );
        } else {
          runtimeInitialUrls.current[activeTabId] = normalized;
          mountRuntime(activeTabId, normalized);
        }
      }

      setDevLogs((prev) => [
        {
          type: 'log',
          msg: `Navigating to: ${normalized}`,
          time: new Date().toLocaleTimeString(),
        },
        ...prev.slice(0, 50),
      ]);
    },
    [activeTabId, evaluateInRuntime, mountRuntime, readyTabIds, searchEngine],
  );

  // Tab management
  const handleNewTab = (url = 'about:home') => {
    const newId = `tab-${Date.now()}`;
    const newTab: BrowserTab = {
      id: newId,
      title: url === 'about:home' ? 'Nammu OS · Web Home' : url,
      url,
      favicon: getDomainFavicon(url),
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      history: [url],
      historyIndex: 0,
      engineMode: 'wasm',
      isPinned: false,
      isMuted: false,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
    if (url !== 'about:home') {
      runtimeInitialUrls.current[newId] = url;
      mountRuntime(newId, url);
    }
  };

  const handleDuplicateTab = (tabId: string) => {
    const target = tabs.find((t) => t.id === tabId);
    if (!target) return;
    const newId = `tab-${Date.now()}`;
    const cloned: BrowserTab = {
      ...target,
      id: newId,
      history: [...target.history],
    };
    const targetIdx = tabs.findIndex((t) => t.id === tabId);
    const updated = [...tabs.slice(0, targetIdx + 1), cloned, ...tabs.slice(targetIdx + 1)];
    setTabs(updated);
    setActiveTabId(newId);
    if (cloned.url !== 'about:home') {
      runtimeInitialUrls.current[newId] = cloned.url;
      mountRuntime(newId, cloned.url);
    }
  };

  const handleTogglePinTab = (tabId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isPinned: !t.isPinned } : t)));
  };

  const handleToggleMuteTab = (tabId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isMuted: !t.isMuted } : t)));
    void evaluateInRuntime(tabId, "gBrowser.selectedTab.toggleMuteAudio('nammu'); 'ok'");
  };

  const handleCloseTab = (tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (tabs.length === 1) {
      setTabs([
        {
          id: `tab-${Date.now()}`,
          title: 'Nammu OS · Web Home',
          url: 'about:home',
          favicon: '',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          history: ['about:home'],
          historyIndex: 0,
          engineMode: 'wasm',
          isPinned: false,
          isMuted: false,
        },
      ]);
      setMountedTabIds((current) => current.filter((id) => id !== tabId));
      setReadyTabIds((current) => current.filter((id) => id !== tabId));
      delete iframeRefs.current[tabId];
      delete runtimeInitialUrls.current[tabId];
      delete lastObservedUrls.current[tabId];
      return;
    }

    const nextTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(nextTabs);
    setMountedTabIds((current) => current.filter((id) => id !== tabId));
    setReadyTabIds((current) => current.filter((id) => id !== tabId));
    delete iframeRefs.current[tabId];
    delete runtimeInitialUrls.current[tabId];
    delete lastObservedUrls.current[tabId];
    if (activeTabId === tabId) {
      setActiveTabId(nextTabs[nextTabs.length - 1].id);
    }
  };

  const handleCloseOtherTabs = (tabId: string) => {
    const keptIds = tabs.filter((tab) => tab.id === tabId || tab.isPinned).map((tab) => tab.id);
    setTabs((prev) => prev.filter((t) => keptIds.includes(t.id)));
    setMountedTabIds((current) => current.filter((id) => keptIds.includes(id)));
    setReadyTabIds((current) => current.filter((id) => keptIds.includes(id)));
    setActiveTabId(tabId);
  };

  const handleCloseTabsToRight = (tabId: string) => {
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const keptIds = tabs.filter((tab, index) => index <= idx || tab.isPinned).map((tab) => tab.id);
    setTabs((prev) => prev.filter((t) => keptIds.includes(t.id)));
    setMountedTabIds((current) => current.filter((id) => keptIds.includes(id)));
    setReadyTabIds((current) => current.filter((id) => keptIds.includes(id)));
  };

  // History navigation (Back / Forward)
  const handleGoBack = () => {
    if (!activeTab || !activeTab.canGoBack) return;
    void evaluateInRuntime(activeTabId, "gBrowser.goBack(); 'ok'");
  };

  const handleGoForward = () => {
    if (!activeTab || !activeTab.canGoForward) return;
    void evaluateInRuntime(activeTabId, "gBrowser.goForward(); 'ok'");
  };

  const handleReload = () => {
    if (activeTab && activeTab.url !== 'about:home') {
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: true } : t)));
      void evaluateInRuntime(activeTabId, "gBrowser.reload(); 'ok'");
    }
  };

  // Toggle bookmark for active URL
  const isCurrentBookmarked = bookmarks.some((b) => b.url === activeTab?.url);
  const handleToggleBookmark = () => {
    if (!activeTab || activeTab.url.startsWith('about:')) return;
    if (isCurrentBookmarked) {
      const updated = bookmarks.filter((b) => b.url !== activeTab.url);
      setBookmarks(updated);
      saveStoredBookmarks(updated);
    } else {
      const newBm: Bookmark = {
        id: Date.now().toString(),
        title: activeTab.title || activeTab.url,
        url: activeTab.url,
        favicon: activeTab.favicon,
      };
      const updated = [...bookmarks, newBm];
      setBookmarks(updated);
      saveStoredBookmarks(updated);
    }
  };

  // Trigger custom in-browser context menus with smart position bounding
  const handleOpenContextMenu = (
    e: React.MouseEvent,
    type: 'tab' | 'omnibox' | 'page' | 'bookmark',
    targetTabId?: string,
    targetBookmarkId?: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = browserRootRef.current?.getBoundingClientRect() || {
      left: 0,
      top: 0,
      width: 800,
      height: 600,
    };
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Menu width & estimated height for clamp calculation
    const menuWidth = 210;
    const menuHeight = 260;

    const clampedX =
      clickX + menuWidth > rect.width ? Math.max(10, rect.width - menuWidth - 10) : clickX;
    const clampedY =
      clickY + menuHeight > rect.height ? Math.max(10, rect.height - menuHeight - 10) : clickY;

    setContextMenu({
      isOpen: true,
      x: clampedX,
      y: clampedY,
      type,
      targetTabId,
      targetBookmarkId,
    });
  };

  const isSecure = activeTab?.url.startsWith('https://');

  return (
    <div
      ref={browserRootRef}
      onContextMenu={(e) => handleOpenContextMenu(e, 'page')}
      className="flex h-full w-full min-h-0 flex-col bg-[#05080d] text-[11px] text-[#c9d7e2] select-none font-sans overflow-hidden relative"
    >
      {/* 1. Multi-Tab Header Bar */}
      <div
        onContextMenu={(e) => handleOpenContextMenu(e, 'page')}
        className="flex h-8 shrink-0 items-center bg-[#070c14] px-1.5 pt-1 border-b border-white/[0.06] gap-1 overflow-x-auto os-scrollbar"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              onContextMenu={(e) => handleOpenContextMenu(e, 'tab', tab.id)}
              className={`group flex h-7 max-w-[200px] min-w-[120px] flex-1 items-center justify-between border-t border-x px-2 text-[10.5px] cursor-pointer transition-colors ${
                isActive
                  ? 'border-white/[0.12] bg-[#0b121c] text-[#e0ecf7] font-medium'
                  : 'border-transparent bg-white/[0.015] text-[#71889d] hover:bg-white/[0.04] hover:text-[#bcd0df]'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {tab.isPinned && <Pin size={10} className="text-[#4aa3ff] shrink-0 rotate-45" />}
                {tab.isLoading ? (
                  <RotateCw size={11} className="animate-spin text-[#4aa3ff] shrink-0" />
                ) : tab.favicon ? (
                  <img
                    src={tab.favicon}
                    alt=""
                    className="h-3.5 w-3.5 shrink-0 object-contain"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Globe size={11} className={isActive ? 'text-[#4aa3ff]' : 'text-[#61788c]'} />
                )}
                <span className="truncate">{tab.title || 'New Tab'}</span>
                {tab.isMuted && <VolumeX size={10} className="text-[#f43f5e] shrink-0 ml-1" />}
              </div>

              {!tab.isPinned && (
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="ml-1 grid h-4 w-4 place-items-center opacity-40 hover:opacity-100 hover:bg-white/[0.1] transition-opacity"
                  title="Close Tab (Ctrl+W)"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}

        {/* New Tab Button */}
        <button
          onClick={() => handleNewTab()}
          className="grid h-6 w-6 shrink-0 place-items-center border border-white/[0.06] text-[#71889d] hover:bg-white/[0.04] hover:text-[#bcd0df] transition-colors"
          title="New Tab (Ctrl+T)"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* 2. Navigation & Smart Omnibox Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-white/[0.06] bg-[#080e18] px-2">
        {/* History Nav Buttons */}
        <button
          onClick={handleGoBack}
          disabled={!activeTab?.canGoBack}
          className="grid h-6 w-6 place-items-center border border-white/[0.06] text-[#8fa5b8] hover:bg-white/[0.04] hover:text-[#d6e5f0] disabled:opacity-30 transition-colors"
          title="Back (Alt+Left)"
        >
          <ArrowLeft size={11} />
        </button>

        <button
          onClick={handleGoForward}
          disabled={!activeTab?.canGoForward}
          className="grid h-6 w-6 place-items-center border border-white/[0.06] text-[#8fa5b8] hover:bg-white/[0.04] hover:text-[#d6e5f0] disabled:opacity-30 transition-colors"
          title="Forward (Alt+Right)"
        >
          <ArrowRight size={11} />
        </button>

        <button
          onClick={handleReload}
          className="grid h-6 w-6 place-items-center border border-white/[0.06] text-[#8fa5b8] hover:bg-white/[0.04] hover:text-[#d6e5f0] transition-colors"
          title="Reload (Ctrl+R)"
        >
          <RotateCw
            size={11}
            className={activeTab?.isLoading ? 'animate-spin text-[#4aa3ff]' : ''}
          />
        </button>

        <button
          onClick={() => handleNavigate('about:home')}
          className="grid h-6 w-6 place-items-center border border-white/[0.06] text-[#8fa5b8] hover:bg-white/[0.04] hover:text-[#d6e5f0] transition-colors"
          title="Home"
        >
          <Home size={11} />
        </button>

        {/* Smart Omnibox (Address Bar) */}
        <div
          onContextMenu={(e) => handleOpenContextMenu(e, 'omnibox')}
          className="relative flex min-w-0 flex-1 items-center border border-white/[0.08] bg-black/50 px-2 py-1 focus-within:border-[#4aa3ff]/50 transition-colors"
        >
          {/* SSL / Protocol Badge */}
          <div className="mr-2 flex items-center gap-1 shrink-0 font-mono text-[8px]">
            {activeTab?.url === 'about:home' || activeTab?.url.startsWith('about:') ? (
              <Sparkles size={10} className="text-[#4aa3ff]" />
            ) : isSecure ? (
              <Lock size={10} className="text-[#2ee6a6]" />
            ) : (
              <AlertTriangle size={10} className="text-[#f59e0b]" />
            )}
          </div>

          <input
            ref={omniboxRef}
            type="text"
            value={omniboxInput}
            onChange={(e) => setOmniboxInput(e.target.value)}
            onFocus={() => {
              setIsFocused(true);
              omniboxRef.current?.select();
            }}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleNavigate(omniboxInput);
              }
            }}
            placeholder="Search Google, YouTube, ChatGPT, or enter any web address (Ctrl+L)"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-[#e0ecf7] outline-none placeholder:text-[#3d5568]"
          />

          {/* Bookmark Action in Omnibox */}
          <button
            onClick={handleToggleBookmark}
            className={`grid h-5 w-5 place-items-center transition-colors ${
              isCurrentBookmarked ? 'text-[#f59e0b]' : 'text-[#5a7184] hover:text-[#bcd0df]'
            }`}
            title={isCurrentBookmarked ? 'Remove Bookmark (Ctrl+D)' : 'Bookmark this Tab (Ctrl+D)'}
          >
            <Star size={11} fill={isCurrentBookmarked ? '#f59e0b' : 'none'} />
          </button>

          {/* Autocomplete / Search Suggestions Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 border border-white/[0.1] bg-[#070d16] shadow-2xl">
              {suggestions.map((sug, i) => (
                <button
                  key={i}
                  onMouseDown={() => handleNavigate(sug)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[#c0d2e2] hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
                >
                  <Search size={11} className="text-[#4aa3ff]" />
                  <span>{sug}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action Toggles */}
        <button
          onClick={() => setSidePanel((prev) => (prev === 'devtools' ? 'none' : 'devtools'))}
          className={`grid h-6 w-6 place-items-center border border-white/[0.06] transition-colors ${
            sidePanel === 'devtools'
              ? 'bg-[#4aa3ff]/15 text-[#a0d2ff] border-[#4aa3ff]/50'
              : 'text-[#8fa5b8] hover:bg-white/[0.04] hover:text-[#d6e5f0]'
          }`}
          title="Toggle DevTools & Inspector"
        >
          <Terminal size={11} />
        </button>

        <button
          onClick={() => setSidePanel((prev) => (prev === 'history' ? 'none' : 'history'))}
          className={`grid h-6 w-6 place-items-center border border-white/[0.06] transition-colors ${
            sidePanel === 'history'
              ? 'bg-[#4aa3ff]/15 text-[#a0d2ff] border-[#4aa3ff]/50'
              : 'text-[#8fa5b8] hover:bg-white/[0.04] hover:text-[#d6e5f0]'
          }`}
          title="Browsing History"
        >
          <HistoryIcon size={11} />
        </button>
      </div>

      {/* 3. Bookmarks Quick Access Bar */}
      {showBookmarksBar && bookmarks.length > 0 && (
        <div className="flex h-6 shrink-0 items-center gap-1 border-b border-white/[0.04] bg-[#060a12] px-2 overflow-x-auto os-scrollbar">
          {bookmarks.map((bm) => (
            <button
              key={bm.id}
              onClick={() => handleNavigate(bm.url)}
              onContextMenu={(e) => handleOpenContextMenu(e, 'bookmark', undefined, bm.id)}
              className="flex items-center gap-1.5 border border-transparent px-2 py-0.5 font-mono text-[8.5px] text-[#7a92a6] hover:border-white/[0.06] hover:bg-white/[0.03] hover:text-[#d0e0ed] transition-colors"
            >
              {bm.favicon ? (
                <img
                  src={bm.favicon}
                  alt=""
                  className="h-2.5 w-2.5 object-contain"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <Globe size={9} className="text-[#4aa3ff]" />
              )}
              <span className="truncate max-w-[120px]">{bm.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* 4. Main Browser Stage & Side Inspector */}
      <div className="flex min-h-0 flex-1 overflow-hidden relative">
        {/* Web Viewport */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#05080d]">
          {activeTab?.url === 'about:home' && (
            /* Home / Speed Dial Launchpad */
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 overflow-y-auto os-scrollbar bg-[#05080d]">
              <div className="w-full max-w-2xl space-y-6 text-center">
                {/* Logo & Branding */}
                <div className="space-y-1">
                  <div className="mx-auto grid h-12 w-12 place-items-center border border-[#4aa3ff]/40 bg-[#4aa3ff]/10 text-[#4aa3ff]">
                    <Globe size={24} />
                  </div>
                  <h1 className="text-xl font-bold text-white tracking-tight">Nammu Browser</h1>
                  <p className="font-mono text-[9.5px] text-[#69849b]">
                    Full Gecko WebAssembly Engine
                  </p>
                </div>

                {/* Central Search Bar */}
                <div className="relative mx-auto max-w-lg">
                  <div className="flex items-center border border-white/[0.1] bg-black/60 px-3 py-2.5 shadow-2xl focus-within:border-[#4aa3ff]">
                    <Search size={14} className="mr-2.5 text-[#4aa3ff] shrink-0" />
                    <input
                      type="text"
                      placeholder="Search Google, YouTube, ChatGPT, or enter any web URL..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleNavigate((e.target as HTMLInputElement).value);
                        }
                      }}
                      className="min-w-0 flex-1 bg-transparent text-[12px] text-[#e0ecf7] outline-none placeholder:text-[#415a6e]"
                      autoFocus
                    />
                  </div>
                </div>

                {/* Quick Dial Grid */}
                <div className="space-y-2 pt-2">
                  <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#476077]">
                    Speed Dial Shortcuts
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-left">
                    {DEFAULT_QUICK_DIALS.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleNavigate(item.url)}
                        className="group flex flex-col p-3 border border-white/[0.06] bg-white/[0.015] hover:border-[#4aa3ff]/50 hover:bg-white/[0.04] transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-lg">{item.icon}</span>
                          <ExternalLink
                            size={10}
                            className="text-[#415a6e] group-hover:text-[#4aa3ff] transition-colors"
                          />
                        </div>
                        <div className="mt-2 font-medium text-[11.5px] text-[#e0ecf7] group-hover:text-white">
                          {item.title}
                        </div>
                        <div className="text-[9.5px] text-[#69849b] truncate">{item.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tabs
            .filter((tab) => mountedTabIds.includes(tab.id))
            .map((tab) => {
              const isActive = tab.id === activeTabId && activeTab?.url !== 'about:home';
              const isReady = readyTabIds.includes(tab.id);
              return (
                <div
                  key={tab.id}
                  className={`${isActive ? 'flex' : 'hidden'} absolute inset-0 items-start justify-center overflow-hidden bg-black`}
                >
                  {!isReady && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#05080d]">
                      <div className="flex items-center gap-2 text-[#a855f7]">
                        <Cpu size={24} className="animate-pulse" />
                        <RotateCw size={14} className="animate-spin text-[#4aa3ff]" />
                      </div>
                      <div className="text-center">
                        <div className="text-[12px] font-medium text-white">
                          Starting Nammu Browser
                        </div>
                        <div className="mt-1 font-mono text-[9px] text-[#69849b]">
                          Preparing the full Gecko web engine
                        </div>
                      </div>
                    </div>
                  )}
                  <iframe
                    ref={(element) => {
                      iframeRefs.current[tab.id] = element;
                    }}
                    src={getBrowserRuntimeUrl(runtimeInitialUrls.current[tab.id] || tab.url)}
                    className="border-0 bg-white"
                    style={{
                      width:
                        viewportMode === 'mobile'
                          ? '390px'
                          : viewportMode === 'tablet'
                            ? '768px'
                            : viewportMode === 'desktop'
                              ? '1280px'
                              : '100%',
                      height:
                        viewportMode === 'mobile'
                          ? '844px'
                          : viewportMode === 'tablet'
                            ? '1024px'
                            : '100%',
                    }}
                    title={tab.title}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-orientation-lock"
                    allow="cross-origin-isolated; camera; microphone; clipboard-read; clipboard-write; autoplay; display-capture; fullscreen"
                  />
                </div>
              );
            })}
        </div>

        {/* 5. Side Panels (DevTools, History, Bookmarks) */}
        {sidePanel !== 'none' && (
          <aside className="w-80 shrink-0 border-l border-white/[0.08] bg-[#070b14] p-3 flex flex-col justify-between overflow-y-auto os-scrollbar">
            {/* DevTools Inspector Panel */}
            {sidePanel === 'devtools' && (
              <div className="space-y-3 flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                  <span className="font-mono text-[8.5px] uppercase tracking-wider text-[#4aa3ff]">
                    Page DevTools & Inspector
                  </span>
                  <button
                    onClick={() => setSidePanel('none')}
                    className="text-[#69849b] hover:text-white"
                  >
                    <X size={12} />
                  </button>
                </div>

                {/* Viewport Controls */}
                <div className="space-y-1">
                  <div className="font-mono text-[8px] text-[#557087]">VIEWPORT SIMULATOR</div>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { id: 'responsive', label: 'Fluid', icon: Monitor },
                      { id: 'desktop', label: '1080p', icon: Laptop },
                      { id: 'tablet', label: 'iPad', icon: Tablet },
                      { id: 'mobile', label: 'iPhone', icon: Smartphone },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => setViewportMode(mode.id as any)}
                        className={`flex items-center justify-center gap-1 border py-1 font-mono text-[8px] transition-colors ${
                          viewportMode === mode.id
                            ? 'border-[#4aa3ff]/60 bg-[#4aa3ff]/15 text-[#a0d2ff]'
                            : 'border-white/[0.06] text-[#69849b] hover:bg-white/[0.03]'
                        }`}
                      >
                        <mode.icon size={10} />
                        <span>{mode.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center justify-between border border-white/[0.06] bg-black/30 px-2 py-1 font-mono text-[8.5px]">
                  <span>Zoom: {zoomLevel}%</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setZoomLevel((z) => Math.max(50, z - 10))}
                      className="border border-white/[0.06] px-1.5 py-0.5 hover:bg-white/[0.04]"
                    >
                      <ZoomOut size={10} />
                    </button>
                    <button
                      onClick={() => setZoomLevel(100)}
                      className="border border-white/[0.06] px-1.5 py-0.5 hover:bg-white/[0.04]"
                    >
                      100%
                    </button>
                    <button
                      onClick={() => setZoomLevel((z) => Math.min(200, z + 10))}
                      className="border border-white/[0.06] px-1.5 py-0.5 hover:bg-white/[0.04]"
                    >
                      <ZoomIn size={10} />
                    </button>
                  </div>
                </div>

                {/* Network Logs */}
                <div className="flex-1 space-y-1 min-h-[140px] flex flex-col">
                  <div className="font-mono text-[8px] text-[#557087]">NETWORK TRAFFIC</div>
                  <div className="flex-1 overflow-auto os-scrollbar border border-white/[0.06] bg-black/50 p-2 font-mono text-[8.5px] space-y-1">
                    {networkLogs.map((n, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between border-b border-white/[0.03] pb-0.5"
                      >
                        <span className="text-[#2ee6a6]">{n.method}</span>
                        <span className="truncate max-w-[140px] text-[#90a8bd]">{n.url}</span>
                        <span className="text-[#69849b]">{n.status}</span>
                      </div>
                    ))}
                    {networkLogs.length === 0 && (
                      <div className="text-center text-[#415a6e] py-4">
                        No network activity captured
                      </div>
                    )}
                  </div>
                </div>

                {/* Console Output */}
                <div className="flex-1 space-y-1 min-h-[140px] flex flex-col">
                  <div className="font-mono text-[8px] text-[#557087]">BROWSER CONSOLE</div>
                  <div className="flex-1 overflow-auto os-scrollbar border border-white/[0.06] bg-black/50 p-2 font-mono text-[8.5px] space-y-1">
                    {devLogs.map((log, i) => (
                      <div key={i} className="text-[#a0d2ff]">
                        <span className="text-[#415a6e]">[{log.time}]</span> {log.msg}
                      </div>
                    ))}
                    {devLogs.length === 0 && (
                      <div className="text-center text-[#415a6e] py-4">
                        Console ready · clean state
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Browsing History Panel */}
            {sidePanel === 'history' && (
              <div className="space-y-3 flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                  <span className="font-mono text-[8.5px] uppercase tracking-wider text-[#4aa3ff]">
                    Browsing History
                  </span>
                  <button
                    onClick={() => {
                      setHistory([]);
                      saveStoredHistory([]);
                    }}
                    className="font-mono text-[8px] text-[#f43f5e] hover:underline"
                  >
                    Clear All
                  </button>
                </div>

                <div className="flex-1 overflow-auto os-scrollbar space-y-1">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleNavigate(item.url)}
                      className="flex w-full items-center gap-2 border border-transparent p-1.5 text-left hover:border-white/[0.06] hover:bg-white/[0.025] transition-colors"
                    >
                      {item.favicon ? (
                        <img
                          src={item.favicon}
                          alt=""
                          className="h-3.5 w-3.5 object-contain shrink-0"
                        />
                      ) : (
                        <Globe size={11} className="text-[#4aa3ff] shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[10.5px] text-[#e0ecf7]">{item.title}</div>
                        <div className="truncate font-mono text-[8px] text-[#557087]">
                          {item.url}
                        </div>
                      </div>
                    </button>
                  ))}
                  {history.length === 0 && (
                    <div className="text-center text-[#415a6e] py-8">No browsing history yet</div>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* 6. Browser Status Footer Bar */}
      <footer className="flex h-5 shrink-0 items-center justify-between border-t border-white/[0.05] bg-[#05080d] px-2.5 font-mono text-[8px] text-[#4d687f]">
        <div className="flex items-center gap-3">
          <span className="text-[#2ee6a6]">● Engine Online</span>
          <span>·</span>
          <span>Core: Gecko WebAssembly</span>
          <span>·</span>
          <span>
            {tabs.length} Active {tabs.length === 1 ? 'Tab' : 'Tabs'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span>{isSecure ? 'SSL 256-bit Encrypted' : 'Non-SSL / Local'}</span>
          <span>·</span>
          <span>Zoom: {zoomLevel}%</span>
        </div>
      </footer>

      {/* 7. Optimized In-Browser Context Menu */}
      {contextMenu.isOpen && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="absolute z-50 min-w-[210px] border border-white/[0.14] bg-[#0a1018]/95 backdrop-blur-xl p-1 shadow-2xl font-mono text-[10px] text-[#c9d7e2] animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {/* TAB CONTEXT MENU */}
          {contextMenu.type === 'tab' && contextMenu.targetTabId && (
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  handleNewTab();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Plus size={11} className="text-[#4aa3ff]" />
                  <span>New Tab</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+T</span>
              </button>

              <button
                onClick={() => {
                  handleDuplicateTab(contextMenu.targetTabId!);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Copy size={11} className="text-[#4aa3ff]" />
                  <span>Duplicate Tab</span>
                </div>
              </button>

              <button
                onClick={() => {
                  handleReload();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <RotateCw size={11} className="text-[#4aa3ff]" />
                  <span>Reload Tab</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+R</span>
              </button>

              <div className="my-1 border-t border-white/[0.08]" />

              <button
                onClick={() => {
                  handleTogglePinTab(contextMenu.targetTabId!);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Pin size={11} className="text-[#a0d2ff]" />
                  <span>
                    {tabs.find((t) => t.id === contextMenu.targetTabId)?.isPinned
                      ? 'Unpin Tab'
                      : 'Pin Tab'}
                  </span>
                </div>
              </button>

              <button
                onClick={() => {
                  handleToggleMuteTab(contextMenu.targetTabId!);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  {tabs.find((t) => t.id === contextMenu.targetTabId)?.isMuted ? (
                    <Volume2 size={11} className="text-[#2ee6a6]" />
                  ) : (
                    <VolumeX size={11} className="text-[#f43f5e]" />
                  )}
                  <span>
                    {tabs.find((t) => t.id === contextMenu.targetTabId)?.isMuted
                      ? 'Unmute Tab'
                      : 'Mute Tab'}
                  </span>
                </div>
              </button>

              <button
                onClick={() => {
                  const target = tabs.find((t) => t.id === contextMenu.targetTabId);
                  if (target?.url) navigator.clipboard?.writeText(target.url);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Share2 size={11} className="text-[#4aa3ff]" />
                  <span>Copy Page URL</span>
                </div>
              </button>

              <div className="my-1 border-t border-white/[0.08]" />

              <button
                onClick={() => {
                  handleCloseTab(contextMenu.targetTabId!);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#f43f5e]/20 hover:text-[#fca5a5] text-[#f43f5e] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <X size={11} />
                  <span>Close Tab</span>
                </div>
                <span className="text-[8.5px] text-[#fca5a5]/60">Ctrl+W</span>
              </button>

              <button
                onClick={() => {
                  handleCloseOtherTabs(contextMenu.targetTabId!);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-white/[0.05] transition-colors"
              >
                <span>Close Other Tabs</span>
              </button>

              <button
                onClick={() => {
                  handleCloseTabsToRight(contextMenu.targetTabId!);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-white/[0.05] transition-colors"
              >
                <span>Close Tabs to the Right</span>
              </button>
            </div>
          )}

          {/* OMNIBOX CONTEXT MENU */}
          {contextMenu.type === 'omnibox' && (
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  if (omniboxRef.current) {
                    navigator.clipboard?.writeText(omniboxInput);
                    setOmniboxInput('');
                  }
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Scissors size={11} className="text-[#4aa3ff]" />
                  <span>Cut</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+X</span>
              </button>

              <button
                onClick={() => {
                  navigator.clipboard?.writeText(omniboxInput);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Copy size={11} className="text-[#4aa3ff]" />
                  <span>Copy</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+C</span>
              </button>

              <button
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard?.readText();
                    if (text) setOmniboxInput(text);
                  } catch {}
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Clipboard size={11} className="text-[#4aa3ff]" />
                  <span>Paste</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+V</span>
              </button>

              <button
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard?.readText();
                    if (text) {
                      setOmniboxInput(text);
                      handleNavigate(text);
                    }
                  } catch {}
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <CornerDownLeft size={11} className="text-[#2ee6a6]" />
                  <span>Paste and Go</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Enter</span>
              </button>

              <div className="my-1 border-t border-white/[0.08]" />

              <button
                onClick={() => {
                  omniboxRef.current?.select();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <span>Select All</span>
                <span className="text-[8.5px] text-[#567289]">Ctrl+A</span>
              </button>

              <button
                onClick={() => {
                  setOmniboxInput('');
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-white/[0.05] transition-colors"
              >
                <span>Clear Address</span>
              </button>
            </div>
          )}

          {/* PAGE & VIEWPORT CONTEXT MENU */}
          {contextMenu.type === 'page' && (
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  handleGoBack();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                disabled={!activeTab?.canGoBack}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white disabled:opacity-30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ArrowLeft size={11} className="text-[#4aa3ff]" />
                  <span>Back</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Alt+←</span>
              </button>

              <button
                onClick={() => {
                  handleGoForward();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                disabled={!activeTab?.canGoForward}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white disabled:opacity-30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ArrowRight size={11} className="text-[#4aa3ff]" />
                  <span>Forward</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Alt+→</span>
              </button>

              <button
                onClick={() => {
                  handleReload();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <RotateCw size={11} className="text-[#4aa3ff]" />
                  <span>Reload</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+R</span>
              </button>

              <div className="my-1 border-t border-white/[0.08]" />

              <button
                onClick={() => {
                  handleToggleBookmark();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Star
                    size={11}
                    fill={isCurrentBookmarked ? '#f59e0b' : 'none'}
                    className="text-[#f59e0b]"
                  />
                  <span>{isCurrentBookmarked ? 'Remove Bookmark' : 'Bookmark Page'}</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+D</span>
              </button>

              <button
                onClick={() => {
                  if (activeTab?.url) navigator.clipboard?.writeText(activeTab.url);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Copy size={11} className="text-[#4aa3ff]" />
                  <span>Copy Page URL</span>
                </div>
              </button>

              <div className="my-1 border-t border-white/[0.08]" />

              <button
                onClick={() => {
                  setSidePanel((p) => (p === 'devtools' ? 'none' : 'devtools'));
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileCode size={11} className="text-[#4aa3ff]" />
                  <span>Inspect DevTools</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+Shift+I</span>
              </button>

              <button
                onClick={() => {
                  setZoomLevel(100);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-white/[0.05] transition-colors"
              >
                <span>Reset Zoom (100%)</span>
              </button>
            </div>
          )}

          {/* BOOKMARK CONTEXT MENU */}
          {contextMenu.type === 'bookmark' && contextMenu.targetBookmarkId && (
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  const bm = bookmarks.find((b) => b.id === contextMenu.targetBookmarkId);
                  if (bm) handleNewTab(bm.url);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ExternalLink size={11} className="text-[#4aa3ff]" />
                  <span>Open in New Tab</span>
                </div>
              </button>

              <button
                onClick={() => {
                  const bm = bookmarks.find((b) => b.id === contextMenu.targetBookmarkId);
                  if (bm?.url) navigator.clipboard?.writeText(bm.url);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Copy size={11} className="text-[#4aa3ff]" />
                  <span>Copy Link Address</span>
                </div>
              </button>

              <div className="my-1 border-t border-white/[0.08]" />

              <button
                onClick={() => {
                  const updated = bookmarks.filter((b) => b.id !== contextMenu.targetBookmarkId);
                  setBookmarks(updated);
                  saveStoredBookmarks(updated);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#f43f5e]/20 hover:text-[#fca5a5] text-[#f43f5e] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Trash2 size={11} />
                  <span>Delete Bookmark</span>
                </div>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
