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
  Menu,
  ChevronUp,
  ChevronDown,
  ShieldCheck,
  Settings2,
  BookOpen,
  Printer,
  FileDown,
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
  getStoredBrowserPreferences,
  saveStoredBrowserPreferences,
  reconcileBrowserHistoryPosition,
  type BrowserPreferences,
} from './services/browserEngine';
import BrowserMenu from './BrowserMenu';

const FIREFOX_RUNTIME_URL = '/firefox-wasm/index.html';
const RUNTIME_HOME_URL = 'about:blank';
const INTERNAL_PAGE_TITLES: Record<string, string> = {
  'about:addons': 'Extensions & Themes',
  'about:config': 'Advanced Configuration',
  'about:downloads': 'Downloads',
  'about:logins': 'Saved Passwords',
  'about:preferences': 'Browser Settings',
  'about:privatebrowsing': 'Private Browsing',
  'about:protections': 'Privacy Protections',
  'about:support': 'Troubleshooting Information',
};

type GeckoEngineState = 'starting' | 'ready' | 'error';

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

interface GeckoTabDescriptor {
  id: string;
  url: string;
  isPrivate: boolean;
  isPinned: boolean;
}

function getBrowserRuntimeUrl(attempt: number) {
  const params = new URLSearchParams({
    app: '1',
    autostart: '1',
    url: RUNTIME_HOME_URL,
    session: String(attempt),
  });
  return `${FIREFOX_RUNTIME_URL}?${params.toString()}`;
}

function getGeckoTabDescriptors(tabs: BrowserTab[]): GeckoTabDescriptor[] {
  return tabs.map((tab) => ({
    id: tab.id,
    url: tab.url === 'about:home' ? RUNTIME_HOME_URL : tab.url,
    isPrivate: tab.isPrivate === true,
    isPinned: tab.isPinned === true,
  }));
}

function buildInitializeGeckoSessionScript(tabs: BrowserTab[], activeTabId: string) {
  const descriptors = getGeckoTabDescriptors(tabs);
  return `(()=>{
    const descriptors = ${JSON.stringify(descriptors)};
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    const existingTabs = Array.from(gBrowser.tabs);
    const firstTab = existingTabs[0] || gBrowser.addTab(${JSON.stringify(RUNTIME_HOME_URL)}, { triggeringPrincipal: principal });
    for (const extraTab of existingTabs.slice(1)) gBrowser.removeTab(extraTab, { animate: false });
    const registry = Object.create(null);
    globalThis.__nammuBrowserTabs = registry;
    descriptors.forEach((descriptor, index) => {
      const tab = index === 0
        ? firstTab
        : gBrowser.addTab(${JSON.stringify(RUNTIME_HOME_URL)}, { triggeringPrincipal: principal });
      registry[descriptor.id] = tab;
      gBrowser.selectedTab = tab;
      if (descriptor.isPrivate) tab.linkedBrowser.docShell.usePrivateBrowsing = true;
      openTrustedLinkIn(descriptor.url, 'current');
      if (descriptor.isPinned) gBrowser.pinTab(tab);
    });
    const activeTab = registry[${JSON.stringify(activeTabId)}] || registry[descriptors[0]?.id];
    if (activeTab) gBrowser.selectedTab = activeTab;
    return descriptors.length;
  })()`;
}

function buildCreateGeckoTabScript(tab: BrowserTab) {
  const descriptor = getGeckoTabDescriptors([tab])[0];
  return `(()=>{
    const registry = globalThis.__nammuBrowserTabs || (globalThis.__nammuBrowserTabs = Object.create(null));
    const descriptor = ${JSON.stringify(descriptor)};
    if (registry[descriptor.id] && !registry[descriptor.id].closing) {
      gBrowser.selectedTab = registry[descriptor.id];
      return 'existing-tab-selected';
    }
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    const tab = gBrowser.addTab(${JSON.stringify(RUNTIME_HOME_URL)}, { triggeringPrincipal: principal });
    registry[descriptor.id] = tab;
    gBrowser.selectedTab = tab;
    if (descriptor.isPrivate) tab.linkedBrowser.docShell.usePrivateBrowsing = true;
    openTrustedLinkIn(descriptor.url, 'current');
    if (descriptor.isPinned) gBrowser.pinTab(tab);
    return 'tab-created';
  })()`;
}

function buildToggleGeckoPinnedTabScript(tabId: string, isPinned: boolean) {
  return `(()=>{
    const tab = globalThis.__nammuBrowserTabs?.[${JSON.stringify(tabId)}];
    if (!tab || tab.closing) return 'tab-unavailable';
    ${isPinned ? 'gBrowser.pinTab(tab);' : 'gBrowser.unpinTab(tab);'}
    return ${JSON.stringify(isPinned ? 'tab-pinned' : 'tab-unpinned')};
  })()`;
}

function buildSelectGeckoTabScript(tabId: string) {
  return `(()=>{
    const tab = globalThis.__nammuBrowserTabs?.[${JSON.stringify(tabId)}];
    if (!tab || tab.closing) return 'tab-unavailable';
    gBrowser.selectedTab = tab;
    return 'tab-selected';
  })()`;
}

function buildRemoveGeckoTabsScript(tabIds: string[], nextActiveTabId: string) {
  return `(()=>{
    const registry = globalThis.__nammuBrowserTabs || Object.create(null);
    for (const tabId of ${JSON.stringify(tabIds)}) {
      const tab = registry[tabId];
      if (tab && !tab.closing) gBrowser.removeTab(tab, { animate: false });
      delete registry[tabId];
    }
    const nextTab = registry[${JSON.stringify(nextActiveTabId)}];
    if (nextTab && !nextTab.closing) gBrowser.selectedTab = nextTab;
    return 'tabs-removed';
  })()`;
}

function buildReplaceLastGeckoTabScript(previousTabId: string, replacementTabId: string) {
  return `(()=>{
    const registry = globalThis.__nammuBrowserTabs || (globalThis.__nammuBrowserTabs = Object.create(null));
    const tab = registry[${JSON.stringify(previousTabId)}] || gBrowser.selectedTab;
    delete registry[${JSON.stringify(previousTabId)}];
    registry[${JSON.stringify(replacementTabId)}] = tab;
    gBrowser.selectedTab = tab;
    openTrustedLinkIn(${JSON.stringify(RUNTIME_HOME_URL)}, 'current');
    return 'last-tab-replaced';
  })()`;
}

function buildRunOnGeckoTabScript(tabId: string, command: string) {
  return `(()=>{
    const tab = globalThis.__nammuBrowserTabs?.[${JSON.stringify(tabId)}];
    if (!tab || tab.closing) return 'tab-unavailable';
    gBrowser.selectedTab = tab;
    ${command}
  })()`;
}

function createBrowserTabId() {
  const id =
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `tab-${id}`;
}

function getBrowserTabTitle(url: string, isPrivate = false) {
  if (isPrivate) return 'Private Browsing';
  if (url === 'about:home') return 'Nammu OS · Web Home';
  return INTERNAL_PAGE_TITLES[url] || url;
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
  const [preferences, setPreferences] = useState<BrowserPreferences>(getStoredBrowserPreferences);
  const searchEngine: SearchEngine = preferences.searchEngine;
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);

  // Bookmarks & History State
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(getStoredBookmarks);
  const [history, setHistory] = useState<HistoryEntry[]>(getStoredHistory);
  const showBookmarksBar = preferences.showBookmarksBar;
  const [sidePanel, setSidePanel] = useState<
    'none' | 'history' | 'bookmarks' | 'devtools' | 'settings'
  >('none');

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
  const [zoomLevel, setZoomLevel] = useState<number>(preferences.defaultZoom);
  const [menuOpen, setMenuOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findStatus, setFindStatus] = useState('');
  const [closedTabs, setClosedTabs] = useState<BrowserTab[]>([]);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Optimized In-Browser Context Menu State
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    type: 'page',
  });

  const browserRootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const engineReadyRef = useRef(false);
  const runtimeCommandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastObservedUrls = useRef<Record<string, string>>({});
  const omniboxRef = useRef<HTMLInputElement>(null);
  const [engineState, setEngineState] = useState<GeckoEngineState>('starting');
  const [engineError, setEngineError] = useState('');
  const [engineAttempt, setEngineAttempt] = useState(1);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // Sync address bar input when active tab changes
  useEffect(() => {
    if (activeTab) {
      setOmniboxInput(activeTab.url === 'about:home' ? '' : activeTab.url);
    }
  }, [activeTab]);

  useEffect(() => {
    saveStoredBrowserPreferences(preferences);
  }, [preferences]);

  const updatePreference = <Key extends keyof BrowserPreferences>(
    key: Key,
    value: BrowserPreferences[Key],
  ) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const evaluateInRuntime = useCallback((script: string): Promise<unknown> => {
    const execute = async () => {
      const runtimeWindow = iframeRef.current?.contentWindow as GeckoRuntimeWindow | null;
      if (!runtimeWindow?.geckoEvalChrome) return null;

      let timeoutId = 0;
      try {
        return await Promise.race([
          runtimeWindow.geckoEvalChrome(script),
          new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(
              () => reject(new Error('Gecko did not answer the browser command in time.')),
              15_000,
            );
          }),
        ]);
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    const result = runtimeCommandQueueRef.current.then(execute, execute);
    runtimeCommandQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const runOnGeckoTab = useCallback(
    (tabId: string, command: string) => {
      if (!engineReadyRef.current) return Promise.resolve(null);
      return evaluateInRuntime(buildRunOnGeckoTabScript(tabId, command));
    },
    [evaluateInRuntime],
  );

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

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.browser-main-menu, .browser-menu-trigger')) return;
      setMenuOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, [menuOpen]);

  // Global browser keyboard shortcuts
  useEffect(() => {
    const handleBrowserShortcuts = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.shiftKey && (e.key === 't' || e.key === 'T')) {
          e.preventDefault();
          handleReopenClosedTab();
        } else if (e.key === 't' || e.key === 'T') {
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
        } else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          openFindBar();
        } else if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          if (e.shiftKey) handleNewPrivateTab();
          else handlePrintPage();
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          handleSavePage();
        } else if (e.key === '0') {
          e.preventDefault();
          setZoomLevel(100);
        } else if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setZoomLevel((level) => Math.min(200, level + 10));
        } else if (e.key === '-') {
          e.preventDefault();
          setZoomLevel((level) => Math.max(50, level - 10));
        } else if (e.shiftKey && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          setSidePanel((panel) => (panel === 'bookmarks' ? 'none' : 'bookmarks'));
        } else if (e.key === 'h' || e.key === 'H') {
          e.preventDefault();
          setSidePanel((panel) => (panel === 'history' ? 'none' : 'history'));
        }
      } else if (e.key === 'F11') {
        e.preventDefault();
        handleToggleFullscreen();
      } else if (e.key === 'Escape' && findOpen) {
        closeFindBar();
      } else if (e.key === 'Escape' && activeTab?.isLoading) {
        handleStopLoading();
      }
    };
    window.addEventListener('keydown', handleBrowserShortcuts);
    return () => window.removeEventListener('keydown', handleBrowserShortcuts);
    // Handlers are declared below and intentionally rebound with the current browser state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeTab, findOpen]);

  // Start one Gecko session for the Browser window, then map every Nammu tab to
  // a native tab inside that session. The WASM engine is never duplicated per tab.
  useEffect(() => {
    const handleRuntimeMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        iframeRef.current?.contentWindow !== event.source
      ) {
        return;
      }

      if (event.data?.type === 'NAMMU_GECKO_ERROR') {
        engineReadyRef.current = false;
        setEngineState('error');
        setEngineError(
          typeof event.data.message === 'string'
            ? event.data.message
            : 'The Gecko engine could not finish starting.',
        );
        return;
      }

      if (event.data?.type !== 'NAMMU_GECKO_READY') return;

      const initializeSession = async () => {
        try {
          // Re-read the model after initialization in case the user opened or
          // closed a tab while the engine was still starting.
          let signature = '';
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const currentTabs = tabsRef.current;
            const currentActiveTabId = activeTabIdRef.current;
            const nextSignature = JSON.stringify({
              tabs: getGeckoTabDescriptors(currentTabs),
              activeTabId: currentActiveTabId,
            });
            if (nextSignature === signature) break;
            signature = nextSignature;
            await evaluateInRuntime(
              buildInitializeGeckoSessionScript(currentTabs, currentActiveTabId),
            );
          }

          await evaluateInRuntime(`(()=>{
            Services.prefs.setBoolPref('privacy.trackingprotection.enabled', ${preferences.trackingProtection});
            Services.prefs.setIntPref('media.autoplay.default', ${preferences.blockAutoplay ? 1 : 0});
            return 'preferences-applied';
          })()`);

          engineReadyRef.current = true;
          setEngineState('ready');
          setEngineError('');
          setDevLogs((current) => [
            {
              type: 'log',
              msg: 'Shared Gecko browser session ready',
              time: new Date().toLocaleTimeString(),
            },
            ...current.slice(0, 50),
          ]);
        } catch (error) {
          engineReadyRef.current = false;
          setEngineState('error');
          setEngineError(error instanceof Error ? error.message : String(error));
        }
      };

      void initializeSession();
    };

    window.addEventListener('message', handleRuntimeMessage);
    return () => window.removeEventListener('message', handleRuntimeMessage);
  }, [evaluateInRuntime, preferences.blockAutoplay, preferences.trackingProtection]);

  useEffect(() => {
    if (engineState !== 'ready') return;
    void evaluateInRuntime(`(()=>{
      Services.prefs.setBoolPref('privacy.trackingprotection.enabled', ${preferences.trackingProtection});
      Services.prefs.setIntPref('media.autoplay.default', ${preferences.blockAutoplay ? 1 : 0});
      return 'preferences-applied';
    })()`);
  }, [engineState, evaluateInRuntime, preferences.blockAutoplay, preferences.trackingProtection]);

  useEffect(() => {
    if (engineState !== 'starting') return;
    const timeout = window.setTimeout(() => {
      if (engineReadyRef.current) return;
      setEngineState('error');
      setEngineError('The Gecko engine did not become ready within two minutes.');
    }, 120_000);
    return () => window.clearTimeout(timeout);
  }, [engineAttempt, engineState]);

  // Mirror real page state back into Nammu's tabs and omnibox.
  useEffect(() => {
    if (!activeTab || activeTab.url === 'about:home' || engineState !== 'ready') {
      return;
    }

    let cancelled = false;
    const syncPageState = async () => {
      try {
        const raw = await runOnGeckoTab(
          activeTabId,
          `const browser = tab.linkedBrowser;
          return JSON.stringify({
            url: browser.currentURI?.spec || '',
            title: browser.contentTitle || browser.currentURI?.spec || '',
            canGoBack: Boolean(browser.canGoBack),
            canGoForward: Boolean(browser.canGoForward),
            isLoading: Boolean(browser.webProgress?.isLoadingDocument)
          });`,
        );
        if (cancelled || typeof raw !== 'string') return;

        const page = JSON.parse(raw) as GeckoPageState;
        if (!page.url) return;

        const observedUrl = page.url === RUNTIME_HOME_URL ? 'about:home' : page.url;

        const previousObservedUrl = lastObservedUrls.current[activeTabId];
        lastObservedUrls.current[activeTabId] = observedUrl;
        const favicon = observedUrl.startsWith('about:') ? '' : getDomainFavicon(observedUrl);

        setTabs((current) => {
          let changed = false;
          const updated = current.map((tab) => {
            if (tab.id !== activeTabId) return tab;
            const urlChanged = tab.url !== observedUrl;
            const historyPosition = urlChanged
              ? reconcileBrowserHistoryPosition(tab.history, tab.historyIndex, observedUrl)
              : { history: tab.history, historyIndex: tab.historyIndex };
            const title =
              observedUrl === 'about:home'
                ? getBrowserTabTitle(observedUrl, tab.isPrivate)
                : page.title || getBrowserTabTitle(observedUrl, tab.isPrivate);
            if (
              !urlChanged &&
              tab.title === title &&
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
              url: observedUrl,
              title,
              favicon,
              isLoading: page.isLoading,
              canGoBack: page.canGoBack,
              canGoForward: page.canGoForward,
              history: historyPosition.history,
              historyIndex: historyPosition.historyIndex,
            };
          });
          return changed ? updated : current;
        });

        if (
          observedUrl !== previousObservedUrl &&
          !observedUrl.startsWith('about:') &&
          !activeTab.isPrivate
        ) {
          const entry: HistoryEntry = {
            id: `${Date.now()}-${activeTabId}`,
            title: page.title || observedUrl,
            url: observedUrl,
            timestamp: Date.now(),
            favicon,
          };
          setHistory((current) => {
            const updated = [entry, ...current.filter((item) => item.url !== observedUrl)].slice(
              0,
              100,
            );
            saveStoredHistory(updated);
            return updated;
          });
          setNetworkLogs((current) => [
            {
              url: observedUrl,
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
  }, [activeTab, activeTabId, engineState, runOnGeckoTab]);

  useEffect(() => {
    if (engineState !== 'ready' || activeTab?.url === 'about:home') return;
    void runOnGeckoTab(activeTabId, `ZoomManager.zoom = ${zoomLevel / 100}; return 'ok';`);
  }, [activeTab?.url, activeTabId, engineState, runOnGeckoTab, zoomLevel]);

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

      setTabs((prev) => {
        const nextTabs = prev.map((tab) => {
          if (tab.id === activeTabId) {
            const newHistory = [...tab.history.slice(0, tab.historyIndex + 1), normalized];
            const newIndex = newHistory.length - 1;
            return {
              ...tab,
              url: normalized,
              title: getBrowserTabTitle(normalized, tab.isPrivate),
              favicon,
              isLoading: normalized !== 'about:home' && !normalized.startsWith('about:'),
              canGoBack: newIndex > 0,
              canGoForward: false,
              history: newHistory,
              historyIndex: newIndex,
            };
          }
          return tab;
        });
        tabsRef.current = nextTabs;
        return nextTabs;
      });

      setOmniboxInput(normalized === 'about:home' ? '' : normalized);
      setShowSuggestions(false);

      if (engineReadyRef.current) {
        const runtimeUrl = normalized === 'about:home' ? RUNTIME_HOME_URL : normalized;
        void runOnGeckoTab(
          activeTabId,
          `openTrustedLinkIn(${JSON.stringify(runtimeUrl)}, 'current'); return 'ok';`,
        );
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
    [activeTabId, runOnGeckoTab, searchEngine],
  );

  const openFindBar = () => {
    setFindOpen(true);
    setMenuOpen(false);
    window.setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }, 0);
  };

  const closeFindBar = () => {
    setFindOpen(false);
    setFindStatus('');
    if (engineReadyRef.current) {
      void runOnGeckoTab(
        activeTabId,
        "tab.linkedBrowser.finder.removeSelection(); return 'selection-cleared';",
      );
    }
  };

  const handleFindInPage = async (direction: 'current' | 'next' | 'previous' = 'current') => {
    if (!findQuery.trim() || !engineReadyRef.current) {
      setFindStatus(findQuery.trim() ? 'Page not ready' : 'Enter text');
      return;
    }

    const script =
      direction === 'current'
        ? `return tab.linkedBrowser.finder.fastFind(${JSON.stringify(findQuery)}, false, false);`
        : `return tab.linkedBrowser.finder.findAgain(${direction === 'previous'}, false, false);`;
    const result = await runOnGeckoTab(activeTabId, script);
    setFindStatus(result === 1 ? 'No matches' : result === 2 ? 'Wrapped' : 'Match found');
  };

  const handlePrintPage = () => {
    if (!activeTab || activeTab.url === 'about:home') return;
    void runOnGeckoTab(
      activeTabId,
      "PrintUtils.startPrintWindow(tab.linkedBrowser.browsingContext); return 'print-opened';",
    );
  };

  const handleSavePage = () => {
    if (!activeTab || activeTab.url.startsWith('about:')) return;
    void runOnGeckoTab(activeTabId, "saveBrowser(tab.linkedBrowser); return 'save-opened';");
  };

  const handleToggleFullscreen = () => {
    const root = browserRootRef.current;
    if (!root) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.requestFullscreen();
  };

  // Tab management
  const handleNewTab = (url = 'about:home', options: { isPrivate?: boolean } = {}) => {
    const newId = createBrowserTabId();
    const newTab: BrowserTab = {
      id: newId,
      title: getBrowserTabTitle(url, options.isPrivate),
      url,
      favicon: getDomainFavicon(url),
      isLoading: url !== 'about:home' && !url.startsWith('about:'),
      canGoBack: false,
      canGoForward: false,
      history: [url],
      historyIndex: 0,
      engineMode: 'wasm',
      isPinned: false,
      isMuted: false,
      isPrivate: options.isPrivate === true,
    };
    setTabs((prev) => {
      const nextTabs = [...prev, newTab];
      tabsRef.current = nextTabs;
      return nextTabs;
    });
    activeTabIdRef.current = newId;
    setActiveTabId(newId);
    if (engineReadyRef.current) void evaluateInRuntime(buildCreateGeckoTabScript(newTab));
  };

  const handleNewPrivateTab = () => {
    handleNewTab('about:privatebrowsing', { isPrivate: true });
  };

  const handleReopenClosedTab = () => {
    const [lastClosed, ...remaining] = closedTabs;
    if (!lastClosed) return;
    const restoredId = createBrowserTabId();
    const restored = { ...lastClosed, id: restoredId, isLoading: false };
    setClosedTabs(remaining);
    setTabs((current) => {
      const nextTabs = [...current, restored];
      tabsRef.current = nextTabs;
      return nextTabs;
    });
    activeTabIdRef.current = restoredId;
    setActiveTabId(restoredId);
    if (engineReadyRef.current) void evaluateInRuntime(buildCreateGeckoTabScript(restored));
  };

  const handleDuplicateTab = (tabId: string) => {
    const target = tabs.find((t) => t.id === tabId);
    if (!target) return;
    const newId = createBrowserTabId();
    const cloned: BrowserTab = {
      ...target,
      id: newId,
      history: [...target.history],
    };
    const targetIdx = tabs.findIndex((t) => t.id === tabId);
    const updated = [...tabs.slice(0, targetIdx + 1), cloned, ...tabs.slice(targetIdx + 1)];
    tabsRef.current = updated;
    setTabs(updated);
    activeTabIdRef.current = newId;
    setActiveTabId(newId);
    if (engineReadyRef.current) void evaluateInRuntime(buildCreateGeckoTabScript(cloned));
  };

  const handleTogglePinTab = (tabId: string) => {
    const target = tabs.find((tab) => tab.id === tabId);
    if (!target) return;

    const isPinned = !target.isPinned;
    const updatedTarget = { ...target, isPinned };
    const remainingTabs = tabs.filter((tab) => tab.id !== tabId);
    const pinnedTabs = remainingTabs.filter((tab) => tab.isPinned);
    const regularTabs = remainingTabs.filter((tab) => !tab.isPinned);
    const reorderedTabs = [...pinnedTabs, updatedTarget, ...regularTabs];

    tabsRef.current = reorderedTabs;
    setTabs(reorderedTabs);
    if (engineReadyRef.current) {
      void evaluateInRuntime(buildToggleGeckoPinnedTabScript(tabId, isPinned));
    }
  };

  const handleToggleMuteTab = (tabId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isMuted: !t.isMuted } : t)));
    void runOnGeckoTab(tabId, "tab.toggleMuteAudio('nammu'); return 'ok';");
  };

  const handleActivateTab = (tabId: string) => {
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
    if (engineReadyRef.current) void evaluateInRuntime(buildSelectGeckoTabScript(tabId));
  };

  const handleCloseTab = (tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const closingTab = tabs.find((tab) => tab.id === tabId);
    if (closingTab) {
      setClosedTabs((current) => [closingTab, ...current].slice(0, 10));
    }
    if (tabs.length === 1) {
      const replacementTabId = createBrowserTabId();
      const replacementTabs: BrowserTab[] = [
        {
          id: replacementTabId,
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
      ];
      tabsRef.current = replacementTabs;
      setTabs(replacementTabs);
      activeTabIdRef.current = replacementTabId;
      setActiveTabId(replacementTabId);
      if (engineReadyRef.current) {
        void evaluateInRuntime(buildReplaceLastGeckoTabScript(tabId, replacementTabId));
      }
      delete lastObservedUrls.current[tabId];
      return;
    }

    const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = tabs.filter((t) => t.id !== tabId);
    const nextActiveTabId =
      activeTabId === tabId
        ? nextTabs[Math.min(closingIndex, nextTabs.length - 1)].id
        : activeTabId;
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    delete lastObservedUrls.current[tabId];
    if (activeTabId === tabId) {
      activeTabIdRef.current = nextActiveTabId;
      setActiveTabId(nextActiveTabId);
    }
    if (engineReadyRef.current) {
      void evaluateInRuntime(buildRemoveGeckoTabsScript([tabId], nextActiveTabId));
    }
  };

  const handleCloseOtherTabs = (tabId: string) => {
    const keptIds = tabs.filter((tab) => tab.id === tabId || tab.isPinned).map((tab) => tab.id);
    const removedIds = tabs.filter((tab) => !keptIds.includes(tab.id)).map((tab) => tab.id);
    tabsRef.current = tabs.filter((tab) => keptIds.includes(tab.id));
    setTabs((prev) => prev.filter((t) => keptIds.includes(t.id)));
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
    if (engineReadyRef.current) {
      void evaluateInRuntime(buildRemoveGeckoTabsScript(removedIds, tabId));
    }
  };

  const handleCloseTabsToRight = (tabId: string) => {
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const keptIds = tabs.filter((tab, index) => index <= idx || tab.isPinned).map((tab) => tab.id);
    const removedIds = tabs.filter((tab) => !keptIds.includes(tab.id)).map((tab) => tab.id);
    const nextActiveTabId = keptIds.includes(activeTabId) ? activeTabId : tabId;
    tabsRef.current = tabs.filter((tab) => keptIds.includes(tab.id));
    setTabs((prev) => prev.filter((t) => keptIds.includes(t.id)));
    if (nextActiveTabId !== activeTabId) {
      activeTabIdRef.current = nextActiveTabId;
      setActiveTabId(nextActiveTabId);
    }
    if (engineReadyRef.current) {
      void evaluateInRuntime(buildRemoveGeckoTabsScript(removedIds, nextActiveTabId));
    }
  };

  // History navigation (Back / Forward)
  const handleGoBack = () => {
    if (!activeTab || !activeTab.canGoBack) return;
    void runOnGeckoTab(activeTabId, "tab.linkedBrowser.goBack(); return 'history-back-requested';");
  };

  const handleGoForward = () => {
    if (!activeTab || !activeTab.canGoForward) return;
    void runOnGeckoTab(
      activeTabId,
      "tab.linkedBrowser.goForward(); return 'history-forward-requested';",
    );
  };

  const handleReload = () => {
    if (activeTab && activeTab.url !== 'about:home') {
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: true } : t)));
      void runOnGeckoTab(activeTabId, "gBrowser.reload(); return 'ok';");
    }
  };

  const handleStopLoading = () => {
    if (!activeTab || activeTab.url === 'about:home') return;
    void runOnGeckoTab(activeTabId, "gBrowser.stop(); return 'stopped';");
    setTabs((current) =>
      current.map((tab) => (tab.id === activeTabId ? { ...tab, isLoading: false } : tab)),
    );
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
    const menuHeight = type === 'page' || type === 'tab' ? 430 : 280;

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

  const handleRetryEngine = () => {
    engineReadyRef.current = false;
    runtimeCommandQueueRef.current = Promise.resolve();
    setEngineError('');
    setEngineState('starting');
    setEngineAttempt((attempt) => attempt + 1);
  };

  const handleClearBrowsingData = () => {
    if (
      !window.confirm(
        'Clear browsing history, cookies, cache, site permissions, and active login data from the Gecko browser?',
      )
    ) {
      return;
    }

    if (engineReadyRef.current) {
      void evaluateInRuntime(
        "Services.clearData.deleteData(Services.clearData.CLEAR_ALL, () => {}); 'clear-started'",
      );
    }
    setHistory([]);
    setClosedTabs([]);
    saveStoredHistory([]);
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
        className="flex h-8 shrink-0 items-center bg-[#070c14] px-1.5 pt-1 border-b border-white/[0.06] gap-1 overflow-x-auto os-scrollbar overflow-hidden"
      >
        {tabs.map((tab, tabIndex) => {
          const isActive = tab.id === activeTabId;
          const isLastPinned = tab.isPinned && !tabs[tabIndex + 1]?.isPinned;
          return (
            <div
              key={tab.id}
              onClick={() => handleActivateTab(tab.id)}
              onContextMenu={(e) => handleOpenContextMenu(e, 'tab', tab.id)}
              title={tab.isPinned ? `${tab.title || 'New Tab'} — Pinned tab` : undefined}
              aria-label={tab.isPinned ? `${tab.title || 'New Tab'}, pinned tab` : undefined}
              className={`group relative flex h-7 items-center border-t border-x text-[10.5px] cursor-pointer transition-[width,background-color,border-color,color] ${
                tab.isPinned
                  ? `w-8 min-w-8 max-w-8 flex-none justify-center px-0 ${isLastPinned ? 'mr-1' : ''}`
                  : 'max-w-[200px] min-w-[120px] flex-1 justify-between px-2'
              } ${
                isActive
                  ? 'border-white/[0.12] bg-[#0b121c] text-[#e0ecf7] font-medium'
                  : 'border-transparent bg-white/[0.015] text-[#71889d] hover:bg-white/[0.04] hover:text-[#bcd0df]'
              }`}
            >
              <div
                className={`flex min-w-0 items-center ${
                  tab.isPinned ? 'justify-center' : 'flex-1 gap-1.5'
                }`}
              >
                {tab.isPrivate && !tab.isPinned && (
                  <ShieldCheck size={10} className="shrink-0 text-[#b589ff]" />
                )}
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
                {!tab.isPinned && <span className="truncate">{tab.title || 'New Tab'}</span>}
                {tab.isMuted && !tab.isPinned && (
                  <VolumeX size={10} className="text-[#f43f5e] shrink-0 ml-1" />
                )}
              </div>

              {tab.isMuted && tab.isPinned && (
                <VolumeX
                  size={7}
                  className="pointer-events-none absolute bottom-0.5 right-0.5 text-[#f43f5e]"
                />
              )}

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
          onClick={activeTab?.isLoading ? handleStopLoading : handleReload}
          className="grid h-6 w-6 place-items-center border border-white/[0.06] text-[#8fa5b8] hover:bg-white/[0.04] hover:text-[#d6e5f0] transition-colors"
          title={activeTab?.isLoading ? 'Stop Loading (Esc)' : 'Reload (Ctrl+R)'}
        >
          {activeTab?.isLoading ? <X size={11} /> : <RotateCw size={11} />}
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

        <button
          onClick={() => setSidePanel((prev) => (prev === 'bookmarks' ? 'none' : 'bookmarks'))}
          className={`grid h-6 w-6 place-items-center border border-white/[0.06] transition-colors ${
            sidePanel === 'bookmarks'
              ? 'bg-[#4aa3ff]/15 text-[#a0d2ff] border-[#4aa3ff]/50'
              : 'text-[#8fa5b8] hover:bg-white/[0.04] hover:text-[#d6e5f0]'
          }`}
          title="Bookmarks"
        >
          <BookOpen size={11} />
        </button>

        <button
          onClick={() => setMenuOpen((open) => !open)}
          className={`browser-menu-trigger grid h-6 w-6 place-items-center border border-white/[0.06] transition-colors ${
            menuOpen
              ? 'border-[#4aa3ff]/50 bg-[#4aa3ff]/15 text-[#a0d2ff]'
              : 'text-[#8fa5b8] hover:bg-white/[0.04] hover:text-[#d6e5f0]'
          }`}
          title="Browser Menu"
          aria-expanded={menuOpen}
        >
          <Menu size={12} />
        </button>
      </div>

      {menuOpen && (
        <BrowserMenu
          zoomLevel={zoomLevel}
          canReopenClosedTab={closedTabs.length > 0}
          onClose={() => setMenuOpen(false)}
          onNewTab={() => handleNewTab()}
          onNewPrivateTab={handleNewPrivateTab}
          onReopenClosedTab={handleReopenClosedTab}
          onFind={openFindBar}
          onPrint={handlePrintPage}
          onSavePage={handleSavePage}
          onToggleFullscreen={handleToggleFullscreen}
          onShowHistory={() => setSidePanel('history')}
          onShowBookmarks={() => setSidePanel('bookmarks')}
          onShowDownloads={() => handleNewTab('about:downloads')}
          onShowPasswords={() => handleNewTab('about:logins')}
          onShowExtensions={() => handleNewTab('about:addons')}
          onShowProtections={() => handleNewTab('about:protections')}
          onShowSettings={() => setSidePanel('settings')}
          onShowFirefoxSettings={() => handleNewTab('about:preferences')}
          onShowDevTools={() => setSidePanel('devtools')}
          onZoomOut={() => setZoomLevel((level) => Math.max(50, level - 10))}
          onResetZoom={() => setZoomLevel(100)}
          onZoomIn={() => setZoomLevel((level) => Math.min(200, level + 10))}
        />
      )}

      {findOpen && (
        <div className="flex h-8 shrink-0 items-center justify-end gap-1.5 border-b border-white/[0.06] bg-[#070c14] px-2">
          <div className="flex w-72 items-center border border-white/[0.08] bg-black/40 px-2 py-1 focus-within:border-[#4aa3ff]/50">
            <FileCode size={10} className="mr-1.5 shrink-0 text-[#4aa3ff]" />
            <input
              ref={findInputRef}
              value={findQuery}
              onChange={(event) => {
                setFindQuery(event.target.value);
                setFindStatus('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleFindInPage(event.shiftKey ? 'previous' : 'next');
                } else if (event.key === 'Escape') {
                  closeFindBar();
                }
              }}
              placeholder="Find in page"
              className="min-w-0 flex-1 bg-transparent text-[10px] text-[#dbe8f3] outline-none placeholder:text-[#496074]"
            />
          </div>
          <span className="min-w-16 font-mono text-[8px] text-[#61788c]">{findStatus}</span>
          <button
            type="button"
            onClick={() => void handleFindInPage('previous')}
            className="grid h-5 w-5 place-items-center border border-white/[0.07] text-[#7790a5] hover:bg-white/[0.04] hover:text-white"
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp size={10} />
          </button>
          <button
            type="button"
            onClick={() => void handleFindInPage('next')}
            className="grid h-5 w-5 place-items-center border border-white/[0.07] text-[#7790a5] hover:bg-white/[0.04] hover:text-white"
            title="Next match (Enter)"
          >
            <ChevronDown size={10} />
          </button>
          <button
            type="button"
            onClick={closeFindBar}
            className="grid h-5 w-5 place-items-center text-[#7790a5] hover:text-white"
            title="Close find bar"
          >
            <X size={10} />
          </button>
        </div>
      )}

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
            <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center p-6 overflow-y-auto os-scrollbar bg-[#05080d]">
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

          <div
            className={`absolute inset-0 flex items-start justify-center overflow-hidden bg-black ${
              activeTab?.url === 'about:home' ? 'invisible pointer-events-none' : 'visible'
            }`}
            aria-hidden={activeTab?.url === 'about:home'}
          >
            {engineState !== 'ready' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#05080d]">
                {engineState === 'starting' ? (
                  <>
                    <div className="flex items-center gap-2 text-[#a855f7]">
                      <Cpu size={24} className="animate-pulse" />
                      <RotateCw size={14} className="animate-spin text-[#4aa3ff]" />
                    </div>
                    <div className="max-w-sm text-center">
                      <div className="text-[12px] font-medium text-white">
                        Starting Nammu Browser
                      </div>
                      <div className="mt-1 font-mono text-[9px] leading-relaxed text-[#69849b]">
                        Loading one shared Gecko engine for this browser session. Your tab will open
                        automatically when it is ready.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={24} className="text-amber-400" />
                    <div className="max-w-sm text-center">
                      <div className="text-[12px] font-medium text-white">
                        Browser engine could not start
                      </div>
                      <div className="mt-1 font-mono text-[9px] leading-relaxed text-[#8fa5b8]">
                        {engineError}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRetryEngine}
                      className="border border-[#4aa3ff]/50 bg-[#4aa3ff]/10 px-3 py-1.5 font-mono text-[9px] text-[#a0d2ff] hover:bg-[#4aa3ff]/20"
                    >
                      Retry engine
                    </button>
                  </>
                )}
              </div>
            )}
            <iframe
              key={engineAttempt}
              ref={iframeRef}
              src={getBrowserRuntimeUrl(engineAttempt)}
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
              title="Nammu Browser Gecko engine"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-orientation-lock"
              allow="cross-origin-isolated; camera; microphone; clipboard-read; clipboard-write; autoplay; display-capture; fullscreen"
            />
          </div>
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

            {/* Bookmarks Library */}
            {sidePanel === 'bookmarks' && (
              <div className="flex min-h-0 flex-1 flex-col space-y-3">
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                  <span className="font-mono text-[8.5px] uppercase tracking-wider text-[#4aa3ff]">
                    Bookmarks Library
                  </span>
                  <button
                    onClick={() => setSidePanel('none')}
                    className="text-[#69849b] hover:text-white"
                    aria-label="Close bookmarks"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="flex-1 space-y-1 overflow-auto os-scrollbar">
                  {bookmarks.map((bookmark) => (
                    <div
                      key={bookmark.id}
                      className="group flex items-center gap-2 rounded border border-transparent p-1.5 hover:border-white/[0.06] hover:bg-white/[0.025]"
                    >
                      <button
                        type="button"
                        onClick={() => handleNavigate(bookmark.url)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        {bookmark.favicon ? (
                          <img
                            src={bookmark.favicon}
                            alt=""
                            className="h-3.5 w-3.5 shrink-0 object-contain"
                          />
                        ) : (
                          <Globe size={11} className="shrink-0 text-[#4aa3ff]" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[10.5px] text-[#e0ecf7]">
                            {bookmark.title}
                          </span>
                          <span className="block truncate font-mono text-[8px] text-[#557087]">
                            {bookmark.url}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = bookmarks.filter((item) => item.id !== bookmark.id);
                          setBookmarks(updated);
                          saveStoredBookmarks(updated);
                        }}
                        className="grid h-5 w-5 shrink-0 place-items-center rounded text-[#5b7184] opacity-0 hover:bg-[#f43f5e]/10 hover:text-[#f87171] group-hover:opacity-100"
                        aria-label={`Delete ${bookmark.title}`}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                  {bookmarks.length === 0 && (
                    <div className="py-8 text-center text-[#415a6e]">No bookmarks saved</div>
                  )}
                </div>
              </div>
            )}

            {/* Browser Preferences */}
            {sidePanel === 'settings' && (
              <div className="flex min-h-0 flex-1 flex-col space-y-3">
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                  <span className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-wider text-[#4aa3ff]">
                    <Settings2 size={11} /> Browser Settings
                  </span>
                  <button
                    onClick={() => setSidePanel('none')}
                    className="text-[#69849b] hover:text-white"
                    aria-label="Close browser settings"
                  >
                    <X size={12} />
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="block rounded border border-white/[0.06] bg-black/25 p-2.5">
                    <span className="mb-1.5 block text-[10px] font-medium text-[#d4e1ed]">
                      Default Search Engine
                    </span>
                    <select
                      value={preferences.searchEngine}
                      onChange={(event) =>
                        updatePreference('searchEngine', event.target.value as SearchEngine)
                      }
                      className="w-full rounded border border-white/[0.08] bg-[#080d15] px-2 py-1.5 text-[10px] text-[#bcd0df] outline-none focus:border-[#4aa3ff]/50"
                    >
                      <option value="google">Google</option>
                      <option value="duckduckgo">DuckDuckGo</option>
                      <option value="bing">Bing</option>
                      <option value="ecosia">Ecosia</option>
                    </select>
                  </label>

                  {[
                    {
                      key: 'showBookmarksBar' as const,
                      label: 'Bookmarks Toolbar',
                      description: 'Keep saved sites visible below the address bar',
                    },
                    {
                      key: 'trackingProtection' as const,
                      label: 'Enhanced Tracking Protection',
                      description: 'Ask Gecko to block known cross-site trackers',
                    },
                    {
                      key: 'blockAutoplay' as const,
                      label: 'Block Autoplay Audio',
                      description: 'Prevent new sites from starting audible media',
                    },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => updatePreference(option.key, !preferences[option.key])}
                      className="flex w-full items-center justify-between gap-3 rounded border border-white/[0.06] bg-black/25 p-2.5 text-left hover:bg-white/[0.025]"
                    >
                      <span>
                        <span className="block text-[10px] font-medium text-[#d4e1ed]">
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-[8.5px] leading-relaxed text-[#5c768c]">
                          {option.description}
                        </span>
                      </span>
                      <span
                        className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors ${
                          preferences[option.key]
                            ? 'border-[#4aa3ff]/60 bg-[#4aa3ff]/35'
                            : 'border-white/[0.1] bg-white/[0.04]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${
                            preferences[option.key]
                              ? 'left-3.5 bg-[#9dceff]'
                              : 'left-0.5 bg-[#71889d]'
                          }`}
                        />
                      </span>
                    </button>
                  ))}

                  <div className="rounded border border-white/[0.06] bg-black/25 p-2.5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] font-medium text-[#d4e1ed]">
                        Default Page Zoom
                      </span>
                      <span className="font-mono text-[9px] text-[#8fb8da]">
                        {preferences.defaultZoom}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="200"
                      step="10"
                      value={preferences.defaultZoom}
                      onChange={(event) => {
                        const level = Number(event.target.value);
                        updatePreference('defaultZoom', level);
                        setZoomLevel(level);
                      }}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full border border-white/10 bg-white/10 accent-[#4aa3ff]"
                    />
                  </div>
                </div>

                <div className="space-y-1 border-t border-white/[0.06] pt-3">
                  {[
                    { label: 'Downloads', url: 'about:downloads' },
                    { label: 'Saved Passwords', url: 'about:logins' },
                    { label: 'Extensions & Themes', url: 'about:addons' },
                    { label: 'Privacy Protections', url: 'about:protections' },
                    { label: 'Advanced Gecko Settings', url: 'about:preferences' },
                    { label: 'Advanced Configuration', url: 'about:config' },
                    { label: 'Troubleshooting Information', url: 'about:support' },
                  ].map((item) => (
                    <button
                      key={item.url}
                      type="button"
                      onClick={() => {
                        handleNewTab(item.url);
                        setSidePanel('none');
                      }}
                      className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-[9.5px] text-[#8fa7bb] hover:bg-white/[0.04] hover:text-white"
                    >
                      <span>{item.label}</span>
                      <ArrowRight size={10} />
                    </button>
                  ))}
                </div>

                <div className="mt-auto border-t border-white/[0.06] pt-3">
                  <button
                    type="button"
                    onClick={handleClearBrowsingData}
                    className="flex w-full items-center justify-center gap-1.5 rounded border border-[#f43f5e]/25 bg-[#f43f5e]/8 px-2.5 py-1.5 font-mono text-[9px] text-[#fb7185] hover:bg-[#f43f5e]/15"
                  >
                    <Trash2 size={10} /> Clear Browsing Data
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* 6. Optimized In-Browser Context Menu */}
      {contextMenu.isOpen && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="absolute z-50 max-h-[90%] min-w-[210px] overflow-y-auto border border-white/[0.14] bg-[#0a1018]/95 p-1 font-mono text-[10px] text-[#c9d7e2] shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 os-scrollbar"
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
                  openFindBar();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Search size={11} className="text-[#4aa3ff]" />
                  <span>Find in Page</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+F</span>
              </button>

              <button
                onClick={() => {
                  handleSavePage();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileDown size={11} className="text-[#4aa3ff]" />
                  <span>Save Page</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+S</span>
              </button>

              <button
                onClick={() => {
                  handlePrintPage();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Printer size={11} className="text-[#4aa3ff]" />
                  <span>Print</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+P</span>
              </button>

              <button
                onClick={() => {
                  if (activeTab && !activeTab.url.startsWith('about:')) {
                    handleNewTab(`view-source:${activeTab.url}`);
                  }
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#4aa3ff]/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileCode size={11} className="text-[#4aa3ff]" />
                  <span>View Page Source</span>
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
