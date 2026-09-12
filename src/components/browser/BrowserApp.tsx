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
  Bookmark as BookmarkIcon,
  Globe,
  Share2,
  Terminal,
  History as HistoryIcon,
  ExternalLink,
  Smartphone,
  Tablet,
  Laptop,
  Monitor,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
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
  Download,
  Upload,
  Pencil,
  Network,
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
  sanitizeBookmarks,
  type BrowserPreferences,
} from './services/browserEngine';
import BrowserMenu from './BrowserMenu';
import ProxyManagerPanel from './ProxyManagerPanel';
import {
  buildConfigureGeckoProxyScript,
  type PublicProxyConnection,
  type PublicProxyEndpoint,
  type PublicProxyHealth,
} from './services/publicProxy';
import { getPlatformCapabilities, type WebSurfaceSnapshot } from '../../platform';
import { getBrowserRuntimeUrl } from './services/geckoRuntimeUrl';
import { useWindowRuntime } from '../os/WindowRuntimeContext';
import NativeWebSurface, { type NativeWebSurfaceHandle } from '../web-surfaces/NativeWebSurface';
import NammuNewTab from './new-tab/NammuNewTab';

const RUNTIME_HOME_URL = 'about:blank';
const SEARCH_ENGINE_INFO: Record<SearchEngine, { label: string; home: string }> = {
  google: { label: 'Google', home: 'https://www.google.com' },
  duckduckgo: { label: 'DuckDuckGo', home: 'https://duckduckgo.com' },
  bing: { label: 'Bing', home: 'https://www.bing.com' },
  ecosia: { label: 'Ecosia', home: 'https://www.ecosia.org' },
};
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
  geckoDispose?: () => void;
  geckoEvalChrome?: (script: string) => Promise<unknown>;
};

interface GeckoPageState {
  url: string;
  documentUrl: string;
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
    ${command}
  })()`;
}

function dispatchRuntimeCommand(command: Promise<unknown>) {
  // Routine UI commands can legitimately time out while Gecko is busy with a
  // heavy page. They must never become unhandled browser/Next.js rejections.
  void command.catch(() => undefined);
}

function getGeckoProxyRouting(
  browserConnection: PublicProxyConnection | null,
  tabConnections: Record<string, PublicProxyConnection>,
) {
  const connectionRoute = (connection: PublicProxyConnection): PublicProxyEndpoint[] => [
    connection.primary,
    ...connection.failovers,
  ];

  return {
    browser: browserConnection ? connectionRoute(browserConnection) : null,
    tabs: Object.fromEntries(
      Object.entries(tabConnections).map(([tabId, connection]) => [
        tabId,
        connectionRoute(connection),
      ]),
    ),
  };
}

function createBrowserTabId() {
  const id =
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `tab-${id}`;
}

function getBrowserTabTitle(url: string, isPrivate = false) {
  if (isPrivate) return 'Private Browsing';
  if (url === 'about:home') return 'New Tab';
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

interface BookmarkDraft {
  id: string;
  title: string;
  url: string;
  group: string;
  error: string;
}

export default function BrowserApp() {
  const windowRuntime = useWindowRuntime();
  const platform = getPlatformCapabilities();
  const nativeSurfaceEnabled = platform.runtime === 'tauri';
  // Tabs State
  const [tabs, setTabs] = useState<BrowserTab[]>([
    {
      id: 'tab-1',
      title: 'New Tab',
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
  const [bookmarkQuery, setBookmarkQuery] = useState('');
  const [bookmarkDraft, setBookmarkDraft] = useState<BookmarkDraft | null>(null);
  const [bookmarkDeleteAllPending, setBookmarkDeleteAllPending] = useState(false);
  const [bookmarkTransferStatus, setBookmarkTransferStatus] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>(getStoredHistory);
  const showBookmarksBar = preferences.showBookmarksBar;
  const [sidePanel, setSidePanel] = useState<
    'none' | 'history' | 'bookmarks' | 'devtools' | 'settings' | 'proxy'
  >('none');
  const [browserProxyConnection, setBrowserProxyConnection] =
    useState<PublicProxyConnection | null>(null);
  const [tabProxyConnections, setTabProxyConnections] = useState<
    Record<string, PublicProxyConnection>
  >({});

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
  const filteredBookmarks = bookmarks.filter((bookmark) => {
    const query = bookmarkQuery.trim().toLocaleLowerCase();
    return !query || `${bookmark.title} ${bookmark.url}`.toLocaleLowerCase().includes(query);
  });

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
  const nativeSurfaceRefs = useRef(new Map<string, NativeWebSurfaceHandle>());
  const nativeSurfaceRefCallbacks = useRef(
    new Map<string, (surface: NativeWebSurfaceHandle | null) => void>(),
  );
  const nativeReadyTabsRef = useRef(new Set<string>());
  const geckoRuntimeRef = useRef<GeckoRuntimeWindow | null>(null);
  const engineReadyRef = useRef(false);
  const browserProxyConnectionRef = useRef<PublicProxyConnection | null>(null);
  const tabProxyConnectionsRef = useRef<Record<string, PublicProxyConnection>>({});
  const proxyRecoveryRef = useRef<
    Record<string, { targetUrl: string; attemptedProxyIds: string[]; lastAttemptAt: number }>
  >({});
  const proxyControlRevisionRef = useRef(0);
  const runtimeCommandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastObservedUrls = useRef<Record<string, string>>({});
  const omniboxRef = useRef<HTMLInputElement>(null);
  const [engineState, setEngineState] = useState<GeckoEngineState>('starting');
  const [engineError, setEngineError] = useState('');
  const [engineAttempt, setEngineAttempt] = useState(1);
  const [nativeSurfaceAttempt, setNativeSurfaceAttempt] = useState(1);
  const [runtimeWispUrl, setRuntimeWispUrl] = useState('');

  const getNativeSurfaceRef = useCallback((tabId: string) => {
    const existing = nativeSurfaceRefCallbacks.current.get(tabId);
    if (existing) return existing;
    const callback = (surface: NativeWebSurfaceHandle | null) => {
      if (surface) nativeSurfaceRefs.current.set(tabId, surface);
      else nativeSurfaceRefs.current.delete(tabId);
    };
    nativeSurfaceRefCallbacks.current.set(tabId, callback);
    return callback;
  }, []);

  const getActiveNativeSurface = useCallback(
    () => nativeSurfaceRefs.current.get(activeTabIdRef.current),
    [],
  );

  useEffect(() => {
    if (nativeSurfaceEnabled) {
      setRuntimeWispUrl('');
      return;
    }
    let cancelled = false;
    setRuntimeWispUrl('');
    void getPlatformCapabilities()
      .services.wispUrl()
      .then((url) => {
        if (!cancelled) setRuntimeWispUrl(url);
      })
      .catch((error) => {
        if (cancelled) return;
        engineReadyRef.current = false;
        setEngineState('error');
        setEngineError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [engineAttempt, nativeSurfaceEnabled]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    browserProxyConnectionRef.current = browserProxyConnection;
  }, [browserProxyConnection]);

  useEffect(() => {
    tabProxyConnectionsRef.current = tabProxyConnections;
  }, [tabProxyConnections]);

  // Sync address bar input when active tab changes
  useEffect(() => {
    if (activeTab) {
      setOmniboxInput(activeTab.url === 'about:home' ? '' : activeTab.url);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!nativeSurfaceEnabled || !activeTab) return;
    const isWebsite = /^https?:\/\//i.test(activeTab.url);
    const ready = isWebsite && nativeReadyTabsRef.current.has(activeTab.id);
    engineReadyRef.current = ready;
    if (!isWebsite) {
      setEngineError('');
      return;
    }
    setEngineState(ready ? 'ready' : 'starting');
    if (ready) setEngineError('');
  }, [activeTab, nativeSurfaceEnabled]);

  useEffect(() => {
    saveStoredBrowserPreferences(preferences);
  }, [preferences]);

  const updatePreference = <Key extends keyof BrowserPreferences>(
    key: Key,
    value: BrowserPreferences[Key],
  ) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const evaluateInRuntimeNow = useCallback(
    async (script: string, timeoutMs = 15_000): Promise<unknown> => {
      const runtimeWindow = iframeRef.current?.contentWindow as GeckoRuntimeWindow | null;
      if (!runtimeWindow?.geckoEvalChrome) return null;

      let timeoutId = 0;
      try {
        return await Promise.race([
          runtimeWindow.geckoEvalChrome(script),
          new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(
              () => reject(new Error('Gecko did not answer the browser command in time.')),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        window.clearTimeout(timeoutId);
      }
    },
    [],
  );

  const evaluateInRuntime = useCallback(
    (script: string): Promise<unknown> => {
      const execute = () => evaluateInRuntimeNow(script);
      const result = runtimeCommandQueueRef.current.then(execute, execute);
      runtimeCommandQueueRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [evaluateInRuntimeNow],
  );

  const runOnGeckoTab = useCallback(
    (tabId: string, command: string) => {
      if (nativeSurfaceEnabled || !engineReadyRef.current) return Promise.resolve(null);
      return evaluateInRuntimeNow(buildRunOnGeckoTabScript(tabId, command), 5_000).catch(
        () => null,
      );
    },
    [evaluateInRuntimeNow, nativeSurfaceEnabled],
  );

  const restartGeckoRuntime = useCallback(() => {
    if (nativeSurfaceEnabled) return;
    try {
      geckoRuntimeRef.current?.geckoDispose?.();
    } catch {}
    geckoRuntimeRef.current = null;
    engineReadyRef.current = false;
    runtimeCommandQueueRef.current = Promise.resolve();
    setEngineError('');
    setEngineState('starting');
    setRuntimeWispUrl('');
    setEngineAttempt((attempt) => attempt + 1);
  }, [nativeSurfaceEnabled]);

  const handleNativeSurfaceFailure = useCallback(
    (tabId: string, reason: string) => {
      if (!nativeSurfaceEnabled) return;
      nativeReadyTabsRef.current.delete(tabId);
      if (activeTabIdRef.current === tabId) engineReadyRef.current = false;
      setDevLogs((current) => [
        {
          type: 'error',
          msg: `Native website surface unavailable: ${reason}`,
          time: new Date().toLocaleTimeString(),
        },
        ...current.slice(0, 50),
      ]);
      if (activeTabIdRef.current === tabId) {
        setEngineState('error');
        setEngineError(reason || 'The Windows website surface could not be started.');
      }
    },
    [nativeSurfaceEnabled],
  );

  const handleNativeSurfaceDiagnostic = useCallback((reason: string) => {
    setDevLogs((current) => [
      {
        type: 'warn',
        msg: `Native website surface: ${reason}`,
        time: new Date().toLocaleTimeString(),
      },
      ...current.slice(0, 50),
    ]);
  }, []);

  const reloadProxyScope = useCallback(
    async (scope: 'browser' | 'tab', tabId: string) => {
      if (scope === 'tab') {
        await evaluateInRuntimeNow(
          buildRunOnGeckoTabScript(
            tabId,
            `tab.linkedBrowser.reload(); return 'proxied-tab-reloaded';`,
          ),
          5_000,
        );
        return;
      }

      await evaluateInRuntimeNow(
        `(()=>{
          const registry = globalThis.__nammuBrowserTabs || Object.create(null);
          for (const tab of Object.values(registry)) {
            if (tab && !tab.closing) tab.linkedBrowser.reload();
          }
          return 'proxied-browser-reloaded';
        })()`,
        5_000,
      );
    },
    [evaluateInRuntimeNow],
  );

  const handleProxyConnect = useCallback(
    async (
      scope: 'browser' | 'tab',
      primary: PublicProxyHealth,
      failovers: PublicProxyHealth[],
    ) => {
      if (nativeSurfaceEnabled) {
        throw new Error('Public proxy routing is unavailable in the native Windows browser.');
      }
      if (!engineReadyRef.current)
        throw new Error('Wait for the browser engine to finish loading.');

      const tabId = activeTabIdRef.current;
      const controlRevision = ++proxyControlRevisionRef.current;
      const connection: PublicProxyConnection = {
        scope,
        ...(scope === 'tab' ? { tabId } : {}),
        primary,
        failovers,
        connectedAt: new Date().toISOString(),
      };
      const nextBrowser = scope === 'browser' ? connection : browserProxyConnectionRef.current;
      const nextTabs =
        scope === 'tab'
          ? { ...tabProxyConnectionsRef.current, [tabId]: connection }
          : tabProxyConnectionsRef.current;

      await evaluateInRuntimeNow(
        buildConfigureGeckoProxyScript(getGeckoProxyRouting(nextBrowser, nextTabs)),
      );
      if (controlRevision !== proxyControlRevisionRef.current) {
        await evaluateInRuntimeNow(
          buildConfigureGeckoProxyScript(
            getGeckoProxyRouting(browserProxyConnectionRef.current, tabProxyConnectionsRef.current),
          ),
          4_000,
        );
        return;
      }
      browserProxyConnectionRef.current = nextBrowser;
      tabProxyConnectionsRef.current = nextTabs;
      if (scope === 'browser') proxyRecoveryRef.current = {};
      else delete proxyRecoveryRef.current[tabId];
      setBrowserProxyConnection(nextBrowser);
      setTabProxyConnections(nextTabs);
      await reloadProxyScope(scope, tabId);
    },
    [evaluateInRuntimeNow, nativeSurfaceEnabled, reloadProxyScope],
  );

  const handleProxyDisconnect = useCallback(
    async (scope: 'browser' | 'tab') => {
      proxyControlRevisionRef.current += 1;
      const tabId = activeTabIdRef.current;
      const nextBrowser = scope === 'browser' ? null : browserProxyConnectionRef.current;
      const nextTabs = { ...tabProxyConnectionsRef.current };
      if (scope === 'tab') delete nextTabs[tabId];

      // Clear UI state first. Disconnect must never wait behind a stalled page.
      browserProxyConnectionRef.current = nextBrowser;
      tabProxyConnectionsRef.current = nextTabs;
      if (scope === 'browser') proxyRecoveryRef.current = {};
      else delete proxyRecoveryRef.current[tabId];
      setBrowserProxyConnection(nextBrowser);
      setTabProxyConnections(nextTabs);

      if (nativeSurfaceEnabled) return;
      if (!engineReadyRef.current) return;
      try {
        await evaluateInRuntimeNow(
          buildConfigureGeckoProxyScript(getGeckoProxyRouting(nextBrowser, nextTabs)),
          4_000,
        );
        await reloadProxyScope(scope, tabId);
      } catch {
        // Recreating Gecko guarantees the in-memory channel filter and every
        // socket owned by the failed proxy are gone.
        restartGeckoRuntime();
      }
    },
    [evaluateInRuntimeNow, nativeSurfaceEnabled, reloadProxyScope, restartGeckoRuntime],
  );

  const handleProxyDisconnectAll = useCallback(async () => {
    proxyControlRevisionRef.current += 1;
    const tabId = activeTabIdRef.current;
    browserProxyConnectionRef.current = null;
    tabProxyConnectionsRef.current = {};
    proxyRecoveryRef.current = {};
    setBrowserProxyConnection(null);
    setTabProxyConnections({});

    if (nativeSurfaceEnabled) return;
    if (!engineReadyRef.current) return;
    try {
      await evaluateInRuntimeNow(
        buildConfigureGeckoProxyScript(getGeckoProxyRouting(null, {})),
        4_000,
      );
      await reloadProxyScope('browser', tabId);
    } catch {
      restartGeckoRuntime();
    }
  }, [evaluateInRuntimeNow, nativeSurfaceEnabled, reloadProxyScope, restartGeckoRuntime]);

  const recoverFromProxyError = useCallback(
    async (tabId: string, targetUrl: string) => {
      const controlRevision = proxyControlRevisionRef.current;
      const connection = tabProxyConnectionsRef.current[tabId] || browserProxyConnectionRef.current;
      if (!connection || connection.failovers.length === 0) return false;

      const now = Date.now();
      const previous = proxyRecoveryRef.current[tabId];
      const recovery =
        previous?.targetUrl === targetUrl
          ? previous
          : { targetUrl, attemptedProxyIds: [], lastAttemptAt: 0 };
      if (
        now - recovery.lastAttemptAt < 2_500 ||
        recovery.attemptedProxyIds.includes(connection.primary.id)
      ) {
        return false;
      }

      const [nextPrimary, ...remainingFailovers] = connection.failovers;
      const nextConnection: PublicProxyConnection = {
        ...connection,
        primary: nextPrimary,
        failovers: remainingFailovers,
        connectedAt: new Date().toISOString(),
      };
      const nextBrowser =
        connection.scope === 'browser' ? nextConnection : browserProxyConnectionRef.current;
      const nextTabs =
        connection.scope === 'tab'
          ? { ...tabProxyConnectionsRef.current, [tabId]: nextConnection }
          : tabProxyConnectionsRef.current;

      recovery.attemptedProxyIds = [...recovery.attemptedProxyIds, connection.primary.id];
      recovery.lastAttemptAt = now;
      proxyRecoveryRef.current[tabId] = recovery;

      await evaluateInRuntimeNow(
        buildConfigureGeckoProxyScript(getGeckoProxyRouting(nextBrowser, nextTabs)),
      );
      if (controlRevision !== proxyControlRevisionRef.current) return false;
      browserProxyConnectionRef.current = nextBrowser;
      tabProxyConnectionsRef.current = nextTabs;
      setBrowserProxyConnection(nextBrowser);
      setTabProxyConnections(nextTabs);
      await evaluateInRuntimeNow(
        buildRunOnGeckoTabScript(
          tabId,
          `tab.linkedBrowser.reload(); return 'proxy-failover-reloaded';`,
        ),
      );
      setDevLogs((current) => [
        {
          type: 'warn',
          msg: `Proxy route failed; switched to ${nextPrimary.host}:${nextPrimary.port}`,
          time: new Date().toLocaleTimeString(),
        },
        ...current.slice(0, 50),
      ]);
      return true;
    },
    [evaluateInRuntimeNow],
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
    if (nativeSurfaceEnabled) return;
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
      geckoRuntimeRef.current = event.source as GeckoRuntimeWindow;

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

          await evaluateInRuntime(
            buildConfigureGeckoProxyScript(
              getGeckoProxyRouting(
                browserProxyConnectionRef.current,
                tabProxyConnectionsRef.current,
              ),
            ),
          );

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
  }, [
    evaluateInRuntime,
    nativeSurfaceEnabled,
    preferences.blockAutoplay,
    preferences.trackingProtection,
  ]);

  useEffect(() => {
    if (nativeSurfaceEnabled || engineState !== 'ready') return;
    dispatchRuntimeCommand(
      evaluateInRuntime(`(()=>{
        Services.prefs.setBoolPref('privacy.trackingprotection.enabled', ${preferences.trackingProtection});
        Services.prefs.setIntPref('media.autoplay.default', ${preferences.blockAutoplay ? 1 : 0});
        return 'preferences-applied';
      })()`),
    );
  }, [
    engineState,
    evaluateInRuntime,
    nativeSurfaceEnabled,
    preferences.blockAutoplay,
    preferences.trackingProtection,
  ]);

  useEffect(() => {
    if (nativeSurfaceEnabled || engineState !== 'starting') return;
    const timeout = window.setTimeout(() => {
      if (engineReadyRef.current) return;
      setEngineState('error');
      setEngineError('The Gecko engine did not become ready within two minutes.');
    }, 120_000);
    return () => window.clearTimeout(timeout);
  }, [engineAttempt, engineState, nativeSurfaceEnabled]);

  // Mirror real page state back into Nammu's tabs and omnibox.
  useEffect(() => {
    if (
      !activeTab ||
      activeTab.url === 'about:home' ||
      nativeSurfaceEnabled ||
      engineState !== 'ready' ||
      windowRuntime.isMinimized
    ) {
      return;
    }

    let cancelled = false;
    let syncInFlight = false;
    const syncPageState = async () => {
      if (cancelled || syncInFlight) return;
      syncInFlight = true;
      try {
        const raw = await runOnGeckoTab(
          activeTabId,
          `const browser = tab.linkedBrowser;
          return JSON.stringify({
            url: browser.currentURI?.spec || '',
            documentUrl: browser.browsingContext?.currentWindowGlobal?.documentURI?.spec || '',
            title: browser.contentTitle || browser.currentURI?.spec || '',
            canGoBack: Boolean(browser.canGoBack),
            canGoForward: Boolean(browser.canGoForward),
            isLoading: Boolean(browser.webProgress?.isLoadingDocument)
          });`,
        );
        if (cancelled || typeof raw !== 'string') return;

        const page = JSON.parse(raw) as GeckoPageState;
        if (!page.url) return;

        const isProxyErrorDocument = /^about:(?:neterror|certerror)(?:\?|$)/i.test(
          page.documentUrl,
        );
        if (isProxyErrorDocument && !page.isLoading) {
          const recovered = await recoverFromProxyError(activeTabId, page.url);
          if (recovered) return;
        } else if (!page.isLoading) {
          delete proxyRecoveryRef.current[activeTabId];
        }

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
      } finally {
        syncInFlight = false;
      }
    };

    void syncPageState();
    const timer = window.setInterval(syncPageState, windowRuntime.isActive ? 750 : 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    activeTab,
    activeTabId,
    engineState,
    nativeSurfaceEnabled,
    recoverFromProxyError,
    runOnGeckoTab,
    windowRuntime.isActive,
    windowRuntime.isMinimized,
  ]);

  useEffect(() => {
    if (nativeSurfaceEnabled || engineState !== 'ready') return;
    dispatchRuntimeCommand(
      evaluateInRuntime(`(()=>{
        const tab = globalThis.__nammuBrowserTabs?.[${JSON.stringify(activeTabId)}];
        const browser = tab?.linkedBrowser;
        if (!browser) return 'tab-unavailable';
        try { browser.docShellIsActive = ${!windowRuntime.isMinimized}; } catch {}
        try { if (browser.docShell) browser.docShell.isActive = ${!windowRuntime.isMinimized}; } catch {}
        return ${JSON.stringify(windowRuntime.phase)};
      })()`),
    );
  }, [
    activeTabId,
    engineState,
    evaluateInRuntime,
    nativeSurfaceEnabled,
    windowRuntime.isMinimized,
    windowRuntime.phase,
  ]);

  useEffect(
    () => () => {
      engineReadyRef.current = false;
      const frame = iframeRef.current;
      try {
        geckoRuntimeRef.current?.geckoDispose?.();
      } catch {}
      geckoRuntimeRef.current = null;
      try {
        frame?.setAttribute('src', 'about:blank');
      } catch {}
    },
    [],
  );

  useEffect(() => {
    if (nativeSurfaceEnabled || engineState !== 'ready' || activeTab?.url === 'about:home') return;
    void runOnGeckoTab(activeTabId, `ZoomManager.zoom = ${zoomLevel / 100}; return 'ok';`);
  }, [activeTab?.url, activeTabId, engineState, nativeSurfaceEnabled, runOnGeckoTab, zoomLevel]);

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
      getPlatformCapabilities()
        .services.request(`/api/browser/search?q=${encodeURIComponent(omniboxInput.trim())}`)
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
          `gBrowser.selectedTab = tab;
          openTrustedLinkIn(${JSON.stringify(runtimeUrl)}, 'current'); return 'ok';`,
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
    if (engineReadyRef.current) {
      dispatchRuntimeCommand(evaluateInRuntimeNow(buildCreateGeckoTabScript(newTab), 5_000));
    }
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
    if (engineReadyRef.current) {
      dispatchRuntimeCommand(evaluateInRuntimeNow(buildCreateGeckoTabScript(restored), 5_000));
    }
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
    if (engineReadyRef.current) {
      dispatchRuntimeCommand(evaluateInRuntimeNow(buildCreateGeckoTabScript(cloned), 5_000));
    }
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
      dispatchRuntimeCommand(
        evaluateInRuntimeNow(buildToggleGeckoPinnedTabScript(tabId, isPinned), 5_000),
      );
    }
  };

  const handleToggleMuteTab = (tabId: string) => {
    const nextMuted = !tabs.find((tab) => tab.id === tabId)?.isMuted;
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, isMuted: nextMuted } : tab)));
    if (nativeSurfaceEnabled && tabId === activeTabId) {
      void nativeSurfaceRefs.current
        .get(tabId)
        ?.setMuted(nextMuted)
        .catch((error) => handleNativeSurfaceDiagnostic(String(error)));
      return;
    }
    void runOnGeckoTab(tabId, "tab.toggleMuteAudio('nammu'); return 'ok';");
  };

  const handleActivateTab = (tabId: string) => {
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
    if (engineReadyRef.current) {
      dispatchRuntimeCommand(evaluateInRuntimeNow(buildSelectGeckoTabScript(tabId), 5_000));
    }
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
          title: 'New Tab',
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
        dispatchRuntimeCommand(
          evaluateInRuntimeNow(buildReplaceLastGeckoTabScript(tabId, replacementTabId), 5_000),
        );
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
      dispatchRuntimeCommand(
        evaluateInRuntimeNow(buildRemoveGeckoTabsScript([tabId], nextActiveTabId), 5_000),
      );
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
      dispatchRuntimeCommand(
        evaluateInRuntimeNow(buildRemoveGeckoTabsScript(removedIds, tabId), 5_000),
      );
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
      dispatchRuntimeCommand(
        evaluateInRuntimeNow(buildRemoveGeckoTabsScript(removedIds, nextActiveTabId), 5_000),
      );
    }
  };

  // History navigation (Back / Forward)
  const handleGoBack = () => {
    if (!activeTab || !activeTab.canGoBack) return;
    if (nativeSurfaceEnabled) {
      void getActiveNativeSurface()
        ?.goBack()
        .catch((error) => handleNativeSurfaceDiagnostic(String(error)));
      return;
    }
    void runOnGeckoTab(activeTabId, "tab.linkedBrowser.goBack(); return 'history-back-requested';");
  };

  const handleGoForward = () => {
    if (!activeTab || !activeTab.canGoForward) return;
    if (nativeSurfaceEnabled) {
      void getActiveNativeSurface()
        ?.goForward()
        .catch((error) => handleNativeSurfaceDiagnostic(String(error)));
      return;
    }
    void runOnGeckoTab(
      activeTabId,
      "tab.linkedBrowser.goForward(); return 'history-forward-requested';",
    );
  };

  const handleReload = () => {
    if (activeTab && activeTab.url !== 'about:home') {
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: true } : t)));
      if (nativeSurfaceEnabled) {
        void getActiveNativeSurface()
          ?.reload()
          .catch((error) => handleNativeSurfaceDiagnostic(String(error)));
        return;
      }
      void runOnGeckoTab(activeTabId, "tab.linkedBrowser.reload(); return 'ok';");
    }
  };

  const handleStopLoading = () => {
    if (!activeTab || activeTab.url === 'about:home') return;
    if (nativeSurfaceEnabled) {
      void getActiveNativeSurface()
        ?.stop()
        .catch((error) => handleNativeSurfaceDiagnostic(String(error)));
    } else {
      void runOnGeckoTab(activeTabId, "tab.linkedBrowser.stop(); return 'stopped';");
    }
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

  const openBookmarkEditor = (bookmark: Bookmark) => {
    setBookmarkDraft({
      id: bookmark.id,
      title: bookmark.title,
      url: bookmark.url,
      group: bookmark.group || '',
      error: '',
    });
  };

  const saveBookmarkDraft = (event: React.FormEvent) => {
    event.preventDefault();
    if (!bookmarkDraft) return;
    let normalizedUrl = '';
    try {
      const parsed = new URL(bookmarkDraft.url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported URL');
      normalizedUrl = parsed.href;
    } catch {
      setBookmarkDraft((current) =>
        current ? { ...current, error: 'Enter a valid HTTP or HTTPS address.' } : current,
      );
      return;
    }

    const updated = bookmarks.map((bookmark) =>
      bookmark.id === bookmarkDraft.id
        ? {
            ...bookmark,
            title: bookmarkDraft.title.trim().slice(0, 240) || new URL(normalizedUrl).hostname,
            url: normalizedUrl,
            group: bookmarkDraft.group.trim().slice(0, 120) || undefined,
            favicon: getDomainFavicon(normalizedUrl),
          }
        : bookmark,
    );
    setBookmarks(updated);
    saveStoredBookmarks(updated);
    setBookmarkDraft(null);
  };

  const exportBookmarks = async () => {
    setBookmarkTransferStatus('Exporting…');
    const result = await platform.files.save({
      suggestedName: 'nammu-browser-bookmarks.json',
      contents: JSON.stringify(
        { version: 1, exportedAt: new Date().toISOString(), bookmarks },
        null,
        2,
      ),
      mimeType: 'application/json',
      filters: [{ name: 'JSON', extensions: ['json'], mimeTypes: ['application/json'] }],
    });
    setBookmarkTransferStatus(
      result.status === 'success'
        ? `Exported ${bookmarks.length} bookmarks`
        : result.status === 'cancelled'
          ? ''
          : 'Bookmarks could not be exported',
    );
  };

  const importBookmarks = async () => {
    setBookmarkTransferStatus('Importing…');
    const result = await platform.files.pick({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'], mimeTypes: ['application/json'] }],
    });
    if (result.status !== 'success') {
      setBookmarkTransferStatus(
        result.status === 'cancelled' ? '' : 'Bookmarks could not be imported',
      );
      return;
    }
    const file = result.value.files[0];
    if (!file || file.size > 2 * 1024 * 1024) {
      setBookmarkTransferStatus('Choose a bookmark JSON file smaller than 2 MB');
      return;
    }
    try {
      const parsed = JSON.parse(new TextDecoder().decode(file.bytes));
      const imported = sanitizeBookmarks(Array.isArray(parsed) ? parsed : parsed?.bookmarks);
      if (!imported.length) throw new Error('No valid bookmarks');
      const existingUrls = new Set(bookmarks.map((bookmark) => bookmark.url));
      const additions = imported.filter((bookmark) => !existingUrls.has(bookmark.url));
      const updated = [...bookmarks, ...additions];
      setBookmarks(updated);
      saveStoredBookmarks(updated);
      setBookmarkTransferStatus(
        additions.length ? `Imported ${additions.length} bookmarks` : 'No new bookmarks found',
      );
    } catch {
      setBookmarkTransferStatus('This file does not contain valid Nammu bookmarks');
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
    if (!nativeSurfaceEnabled) {
      restartGeckoRuntime();
      return;
    }
    engineReadyRef.current = false;
    nativeReadyTabsRef.current.clear();
    setEngineError('');
    setEngineState('starting');
    setNativeSurfaceAttempt((attempt) => attempt + 1);
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
      dispatchRuntimeCommand(
        evaluateInRuntime(
          "Services.clearData.deleteData(Services.clearData.CLEAR_ALL, () => {}); 'clear-started'",
        ),
      );
    }
    setHistory([]);
    setClosedTabs([]);
    saveStoredHistory([]);
  };

  const handleNativeSurfaceReady = useCallback((tabId: string) => {
    nativeReadyTabsRef.current.add(tabId);
    if (activeTabIdRef.current === tabId) {
      engineReadyRef.current = true;
      setEngineState('ready');
      setEngineError('');
    }
    setDevLogs((current) => [
      {
        type: 'log',
        msg: 'Desktop native website surface ready',
        time: new Date().toLocaleTimeString(),
      },
      ...current.slice(0, 50),
    ]);
  }, []);

  const handleNativeSurfaceState = useCallback((tabId: string, snapshot: WebSurfaceSnapshot) => {
    const observedUrl = snapshot.url;
    const previousObservedUrl = lastObservedUrls.current[tabId];
    lastObservedUrls.current[tabId] = observedUrl;
    const favicon = getDomainFavicon(observedUrl);

    setTabs((current) => {
      let changed = false;
      const updated = current.map((tab) => {
        if (tab.id !== tabId) return tab;
        const urlChanged = tab.url !== observedUrl;
        const historyPosition = urlChanged
          ? reconcileBrowserHistoryPosition(tab.history, tab.historyIndex, observedUrl)
          : { history: tab.history, historyIndex: tab.historyIndex };
        const title = snapshot.title || getBrowserTabTitle(observedUrl, tab.isPrivate);
        if (
          !urlChanged &&
          tab.title === title &&
          tab.favicon === favicon &&
          tab.isLoading === snapshot.isLoading &&
          tab.canGoBack === snapshot.canGoBack &&
          tab.canGoForward === snapshot.canGoForward &&
          Boolean(tab.isMuted) === snapshot.isMuted &&
          Boolean(tab.isAudioPlaying) === snapshot.isAudioPlaying
        ) {
          return tab;
        }
        changed = true;
        return {
          ...tab,
          url: observedUrl,
          title,
          favicon,
          isLoading: snapshot.isLoading,
          canGoBack: snapshot.canGoBack,
          canGoForward: snapshot.canGoForward,
          isMuted: snapshot.isMuted,
          isAudioPlaying: snapshot.isAudioPlaying,
          history: historyPosition.history,
          historyIndex: historyPosition.historyIndex,
        };
      });
      tabsRef.current = changed ? updated : current;
      return changed ? updated : current;
    });

    const activeModel = tabsRef.current.find((tab) => tab.id === tabId);
    if (
      observedUrl !== previousObservedUrl &&
      !observedUrl.startsWith('about:') &&
      !activeModel?.isPrivate
    ) {
      const entry: HistoryEntry = {
        id: `${Date.now()}-${tabId}`,
        title: snapshot.title || observedUrl,
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
    }
  }, []);

  const isSecure = activeTab?.url.startsWith('https://');
  const effectiveProxyConnection = tabProxyConnections[activeTabId] || browserProxyConnection;
  const nativeInternalPage =
    nativeSurfaceEnabled && activeTab?.url.startsWith('about:') && activeTab.url !== 'about:home';
  const browserOverlayActive =
    menuOpen ||
    findOpen ||
    showSuggestions ||
    contextMenu.isOpen ||
    Boolean(bookmarkDraft) ||
    bookmarkDeleteAllPending;

  return (
    <div
      ref={browserRootRef}
      onContextMenu={(e) => handleOpenContextMenu(e, 'page')}
      className="flex h-full w-full min-h-0 flex-col bg-[#05080d] text-[11px] text-[#c9d7e2] select-none font-sans overflow-hidden relative"
    >
      {/* 1. Multi-Tab Header Bar */}
      <div
        onContextMenu={(e) => handleOpenContextMenu(e, 'page')}
        className="browser-tab-strip flex shrink-0 basis-6 items-stretch gap-0 overflow-x-auto overflow-y-hidden border-b border-white/6 bg-[#070c14] p-0 os-scrollbar"
        style={{ height: 24, minHeight: 24, maxHeight: 24 }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => handleActivateTab(tab.id)}
              onContextMenu={(e) => handleOpenContextMenu(e, 'tab', tab.id)}
              title={tab.isPinned ? `${tab.title || 'New Tab'} — Pinned tab` : undefined}
              aria-label={tab.isPinned ? `${tab.title || 'New Tab'}, pinned tab` : undefined}
              className={`browser-tab group relative flex h-full min-h-0 items-center border-x text-[10.5px] cursor-pointer transition-[width,background-color,border-color,color] ${
                tab.isPinned
                  ? 'w-7 min-w-7 max-w-7 flex-none justify-center px-0'
                  : 'max-w-50 min-w-30 flex-1 justify-between px-2'
              } ${
                isActive
                  ? 'border-white/12 bg-[#0b121c] text-[#e0ecf7] font-medium'
                  : 'border-transparent bg-white/1.5 text-[#71889d] hover:bg-white/4 hover:text-[#bcd0df]'
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
                  <RotateCw size={11} className="animate-spin text-electric shrink-0" />
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
                  <Globe size={11} className={isActive ? 'text-electric' : 'text-[#61788c]'} />
                )}
                {!tab.isPinned && <span className="truncate">{tab.title || 'New Tab'}</span>}
                {tab.isMuted && !tab.isPinned && (
                  <VolumeX size={10} className="text-[#f43f5e] shrink-0 ml-1" />
                )}
                {!tab.isMuted && tab.isAudioPlaying && !tab.isPinned && (
                  <Volume2 size={10} className="ml-1 shrink-0 text-emerald" />
                )}
              </div>

              {tab.isMuted && tab.isPinned && (
                <VolumeX
                  size={7}
                  className="pointer-events-none absolute bottom-0.5 right-0.5 text-[#f43f5e]"
                />
              )}
              {!tab.isMuted && tab.isAudioPlaying && tab.isPinned && (
                <Volume2
                  size={7}
                  className="pointer-events-none absolute bottom-0.5 right-0.5 text-emerald"
                />
              )}

              {!tab.isPinned && (
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="ml-1 grid h-4 w-4 place-items-center opacity-40 hover:opacity-100 hover:bg-white/10 transition-opacity"
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
          className="ml-1 grid h-6 w-6 shrink-0 self-center place-items-center border border-white/6 text-[#8fa5b8] transition-colors hover:bg-white/4 hover:text-[#d6e5f0]"
          title="New Tab (Ctrl+T)"
          aria-label="New tab"
        >
          <Plus size={11} />
        </button>
      </div>

      {/* 2. Navigation & Smart Omnibox Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-white/6 bg-[#080e18] px-2">
        {/* History Nav Buttons */}
        <button
          onClick={handleGoBack}
          disabled={!activeTab?.canGoBack}
          className="grid h-6 w-6 place-items-center border border-white/6 text-[#8fa5b8] hover:bg-white/4 hover:text-[#d6e5f0] disabled:opacity-30 transition-colors"
          title="Back (Alt+Left)"
        >
          <ArrowLeft size={11} />
        </button>

        <button
          onClick={handleGoForward}
          disabled={!activeTab?.canGoForward}
          className="grid h-6 w-6 place-items-center border border-white/6 text-[#8fa5b8] hover:bg-white/4 hover:text-[#d6e5f0] disabled:opacity-30 transition-colors"
          title="Forward (Alt+Right)"
        >
          <ArrowRight size={11} />
        </button>

        <button
          onClick={activeTab?.isLoading ? handleStopLoading : handleReload}
          className="grid h-6 w-6 place-items-center border border-white/6 text-[#8fa5b8] hover:bg-white/4 hover:text-[#d6e5f0] transition-colors"
          title={activeTab?.isLoading ? 'Stop Loading (Esc)' : 'Reload (Ctrl+R)'}
        >
          {activeTab?.isLoading ? <X size={11} /> : <RotateCw size={11} />}
        </button>

        <button
          onClick={() => handleNavigate('about:home')}
          className="grid h-6 w-6 place-items-center border border-white/6 text-[#8fa5b8] hover:bg-white/4 hover:text-[#d6e5f0] transition-colors"
          title="Home"
        >
          <Home size={11} />
        </button>

        {/* Smart Omnibox (Address Bar) */}
        <div
          onContextMenu={(e) => handleOpenContextMenu(e, 'omnibox')}
          className="browser-omnibox-shell relative flex min-w-0 flex-1 items-center border border-white/8 bg-black/50 px-2 focus-within:border-electric/50 transition-colors"
        >
          {/* SSL / Protocol Badge */}
          <div className="mr-2 flex items-center gap-1 shrink-0 font-mono text-[8px]">
            {activeTab?.url === 'about:home' || activeTab?.url.startsWith('about:') ? (
              <img
                src={getDomainFavicon(SEARCH_ENGINE_INFO[searchEngine].home)}
                alt=""
                className="h-3 w-3 object-contain"
                title={`${SEARCH_ENGINE_INFO[searchEngine].label} search`}
              />
            ) : isSecure ? (
              <Lock size={10} className="text-emerald" />
            ) : (
              <AlertTriangle size={10} className="text-os-amber" />
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
            placeholder={`Search ${SEARCH_ENGINE_INFO[searchEngine].label} or enter a web address (Ctrl+L)`}
            className="browser-omnibox-input min-w-0 flex-1 bg-transparent text-[11px] text-[#e0ecf7] outline-none placeholder:text-[#3d5568]"
          />

          {/* Bookmark Action in Omnibox */}
          <button
            onClick={handleToggleBookmark}
            className={`grid h-5 w-5 place-items-center transition-colors ${
              isCurrentBookmarked ? 'text-os-amber' : 'text-[#5a7184] hover:text-[#bcd0df]'
            }`}
            title={isCurrentBookmarked ? 'Remove Bookmark (Ctrl+D)' : 'Bookmark this Tab (Ctrl+D)'}
          >
            <Star size={11} fill={isCurrentBookmarked ? '#f59e0b' : 'none'} />
          </button>

          {/* Autocomplete / Search Suggestions Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 border border-white/10 bg-[#070d16] shadow-2xl">
              {suggestions.map((sug, i) => (
                <button
                  key={i}
                  onMouseDown={() => handleNavigate(sug)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[#c0d2e2] hover:bg-electric/15 hover:text-white transition-colors"
                >
                  <Search size={11} className="text-electric" />
                  <span>{sug}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action Toggles */}
        <button
          onClick={() => setSidePanel((prev) => (prev === 'devtools' ? 'none' : 'devtools'))}
          className={`grid h-6 w-6 place-items-center border border-white/6 transition-colors ${
            sidePanel === 'devtools'
              ? 'bg-electric/15 text-[#a0d2ff] border-electric/50'
              : 'text-[#8fa5b8] hover:bg-white/4 hover:text-[#d6e5f0]'
          }`}
          title="Developer Tools"
        >
          <Terminal size={11} />
        </button>

        <button
          onClick={() => setSidePanel((prev) => (prev === 'proxy' ? 'none' : 'proxy'))}
          className={`relative grid h-6 w-6 place-items-center border transition-colors ${
            sidePanel === 'proxy'
              ? 'border-electric/50 bg-electric/15 text-[#a0d2ff]'
              : effectiveProxyConnection
                ? 'border-emerald/45 bg-emerald/10 text-[#61e8b8]'
                : 'border-white/6 text-[#8fa5b8] hover:bg-white/4 hover:text-[#d6e5f0]'
          }`}
          title={
            effectiveProxyConnection
              ? `Public proxy active for ${tabProxyConnections[activeTabId] ? 'this tab' : 'the whole browser'}`
              : 'Proxy Manager'
          }
          aria-label="Open Proxy Manager"
        >
          <Network size={11} />
          {effectiveProxyConnection && (
            <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-emerald shadow-[0_0_5px_#2ee6a6]" />
          )}
        </button>

        <button
          onClick={() => setSidePanel((prev) => (prev === 'history' ? 'none' : 'history'))}
          className={`grid h-6 w-6 place-items-center border border-white/6 transition-colors ${
            sidePanel === 'history'
              ? 'bg-electric/15 text-[#a0d2ff] border-electric/50'
              : 'text-[#8fa5b8] hover:bg-white/4 hover:text-[#d6e5f0]'
          }`}
          title="History"
        >
          <HistoryIcon size={11} />
        </button>

        <button
          onClick={() => setSidePanel((prev) => (prev === 'bookmarks' ? 'none' : 'bookmarks'))}
          className={`grid h-6 w-6 place-items-center border border-white/6 transition-colors ${
            sidePanel === 'bookmarks'
              ? 'bg-electric/15 text-[#a0d2ff] border-electric/50'
              : 'text-[#8fa5b8] hover:bg-white/4 hover:text-[#d6e5f0]'
          }`}
          title="Bookmarks"
        >
          <BookOpen size={11} />
        </button>

        <button
          onClick={() => setMenuOpen((open) => !open)}
          className={`browser-menu-trigger grid h-6 w-6 place-items-center border border-white/6 transition-colors ${
            menuOpen
              ? 'border-electric/50 bg-electric/15 text-[#a0d2ff]'
              : 'text-[#8fa5b8] hover:bg-white/4 hover:text-[#d6e5f0]'
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
          onShowProxyManager={() => setSidePanel('proxy')}
          onZoomOut={() => setZoomLevel((level) => Math.max(50, level - 10))}
          onResetZoom={() => setZoomLevel(100)}
          onZoomIn={() => setZoomLevel((level) => Math.min(200, level + 10))}
        />
      )}

      {findOpen && (
        <div className="flex h-8 shrink-0 items-center justify-end gap-1.5 border-b border-white/6 bg-[#070c14] px-2">
          <div className="flex w-72 items-center border border-white/8 bg-black/40 px-2 py-1 focus-within:border-electric/50">
            <FileCode size={10} className="mr-1.5 shrink-0 text-electric" />
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
            className="grid h-5 w-5 place-items-center border border-white/[0.07] text-[#7790a5] hover:bg-white/4 hover:text-white"
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp size={10} />
          </button>
          <button
            type="button"
            onClick={() => void handleFindInPage('next')}
            className="grid h-5 w-5 place-items-center border border-white/[0.07] text-[#7790a5] hover:bg-white/4 hover:text-white"
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
        <div className="browser-bookmarks-bar flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/4 bg-[#060a12] px-2 os-scrollbar">
          {bookmarks.map((bm) => (
            <button
              key={bm.id}
              onClick={() => handleNavigate(bm.url)}
              onContextMenu={(e) => handleOpenContextMenu(e, 'bookmark', undefined, bm.id)}
              className="flex items-center gap-1.5 border border-transparent px-2 py-0.5 font-mono text-[8.5px] text-[#7a92a6] hover:border-white/6 hover:bg-white/3 hover:text-[#d0e0ed] transition-colors"
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
                <Globe size={9} className="text-electric" />
              )}
              <span className="truncate max-w-30">{bm.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* 4. Main Browser Stage & Side Inspector */}
      <div className="flex min-h-0 flex-1 overflow-hidden relative">
        {/* Web Viewport */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#05080d]">
          {activeTab?.url === 'about:home' && (
            <NammuNewTab
              bookmarks={bookmarks}
              history={history}
              quickDials={DEFAULT_QUICK_DIALS}
              searchEngine={searchEngine}
              onNavigate={handleNavigate}
              onOpenInNewTab={(url) => handleNewTab(url)}
            />
          )}

          <div
            className={`absolute inset-0 flex items-start justify-center overflow-hidden bg-black ${
              activeTab?.url === 'about:home' ? 'invisible pointer-events-none' : 'visible'
            }`}
            aria-hidden={activeTab?.url === 'about:home'}
          >
            {!nativeInternalPage && engineState === 'error' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#05080d]">
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
                    className="border border-electric/50 bg-electric/10 px-3 py-1.5 font-mono text-[9px] text-[#a0d2ff] hover:bg-electric/20"
                  >
                    Retry engine
                  </button>
                </>
              </div>
            )}
            {nativeInternalPage && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#05080d] p-6">
                <div className="w-full max-w-md border border-white/10 bg-[#08101a] p-5 shadow-2xl">
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-electric">
                    Nammu Browser
                  </div>
                  <h2 className="mt-2 text-[15px] font-medium text-[#e0ecf7]">
                    {INTERNAL_PAGE_TITLES[activeTab.url] || 'Internal browser page'}
                  </h2>
                  <p className="mt-2 text-[11px] leading-relaxed text-[#7890a4]">
                    This Gecko-specific internal page is not exposed to Internet content in the
                    native Windows browser. Use Nammu Browser's own toolbar and side panels for the
                    equivalent controls.
                  </p>
                </div>
              </div>
            )}
            {nativeSurfaceEnabled &&
              tabs
                .filter((tab) => /^https?:\/\//i.test(tab.url))
                .map((tab) => (
                  <NativeWebSurface
                    key={`${nativeSurfaceAttempt}:${tab.id}`}
                    ref={getNativeSurfaceRef(tab.id)}
                    enabled
                    active={tab.id === activeTabId}
                    privateSession={tab.isPrivate === true}
                    url={tab.url}
                    zoom={zoomLevel}
                    muted={Boolean(tab.isMuted)}
                    browserOverlayActive={browserOverlayActive}
                    onState={(snapshot) => handleNativeSurfaceState(tab.id, snapshot)}
                    onReady={() => handleNativeSurfaceReady(tab.id)}
                    onFailure={(reason) => handleNativeSurfaceFailure(tab.id, reason)}
                    onDiagnostic={handleNativeSurfaceDiagnostic}
                    onOpenRequest={(url) => handleNewTab(url)}
                  />
                ))}
            {!nativeSurfaceEnabled && runtimeWispUrl && (
              <iframe
                key={engineAttempt}
                ref={iframeRef}
                src={getBrowserRuntimeUrl(engineAttempt, runtimeWispUrl)}
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
            )}
          </div>

          {bookmarkDraft && (
            <div
              className="nammu-glass-dialog-backdrop absolute inset-0 z-85 grid place-items-center p-4"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) setBookmarkDraft(null);
              }}
            >
              <form
                onSubmit={saveBookmarkDraft}
                className="nammu-glass-dialog w-full max-w-sm rounded-2xl p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <strong className="block text-[12px] font-semibold text-white">
                      Edit bookmark
                    </strong>
                    <span className="text-[8.5px] text-[#71889b]">
                      Update its name, address or group.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBookmarkDraft(null)}
                    className="grid h-7 w-7 place-items-center rounded-lg text-[#71889b] hover:bg-white/8 hover:text-white"
                    aria-label="Close bookmark editor"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="grid gap-2.5">
                  {[
                    { key: 'title' as const, label: 'Name', placeholder: 'Bookmark name' },
                    { key: 'url' as const, label: 'Address', placeholder: 'https://example.com' },
                    { key: 'group' as const, label: 'Group', placeholder: 'Optional group' },
                  ].map((field) => (
                    <label key={field.key} className="grid gap-1">
                      <span className="text-[8px] font-medium uppercase tracking-[0.12em] text-[#71889b]">
                        {field.label}
                      </span>
                      <input
                        value={bookmarkDraft[field.key]}
                        onChange={(event) =>
                          setBookmarkDraft((current) =>
                            current
                              ? { ...current, [field.key]: event.target.value, error: '' }
                              : current,
                          )
                        }
                        placeholder={field.placeholder}
                        className="h-8 rounded-lg border border-white/9 bg-white/5 px-2.5 text-[10px] text-white outline-none placeholder:text-[#52697b] focus:border-white/20"
                        autoFocus={field.key === 'title'}
                      />
                    </label>
                  ))}
                </div>
                {bookmarkDraft.error && (
                  <p className="mt-2 text-[8.5px] text-[#ff9a9a]">{bookmarkDraft.error}</p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setBookmarkDraft(null)}
                    className="h-7 rounded-lg px-3 text-[9px] text-[#91a5b6] hover:bg-white/6 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="h-7 rounded-lg border border-white/13 bg-white/10 px-3 text-[9px] font-medium text-white hover:bg-white/15"
                  >
                    Save changes
                  </button>
                </div>
              </form>
            </div>
          )}

          {bookmarkDeleteAllPending && (
            <div
              className="nammu-glass-dialog-backdrop absolute inset-0 z-86 grid place-items-center p-4"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) setBookmarkDeleteAllPending(false);
              }}
            >
              <section
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="delete-all-bookmarks-title"
                className="nammu-glass-dialog w-full max-w-xs rounded-2xl p-4"
              >
                <span className="mb-3 grid h-8 w-8 place-items-center rounded-xl border border-[#ff7777]/15 bg-[#ff6464]/8 text-[#ff9999]">
                  <Trash2 size={14} />
                </span>
                <strong id="delete-all-bookmarks-title" className="block text-[12px] text-white">
                  Delete all bookmarks?
                </strong>
                <p className="mt-1 text-[9px] leading-relaxed text-[#8196a8]">
                  This will permanently remove all {bookmarks.length} saved bookmarks from Nammu
                  Browser. This action cannot be undone.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setBookmarkDeleteAllPending(false)}
                    className="h-7 rounded-lg px-3 text-[9px] text-[#91a5b6] hover:bg-white/6 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const deletedCount = bookmarks.length;
                      setBookmarks([]);
                      saveStoredBookmarks([]);
                      setBookmarkDeleteAllPending(false);
                      setBookmarkTransferStatus(`Deleted ${deletedCount} bookmarks`);
                    }}
                    className="h-7 rounded-lg border border-[#ff7777]/20 bg-[#ff6464]/10 px-3 text-[9px] font-medium text-[#ffaaaa] hover:bg-[#ff6464]/18 hover:text-white"
                  >
                    Delete all
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>

        {/* 5. Side Panels (Proxy Manager, DevTools, History, Bookmarks) */}
        {sidePanel !== 'none' && (
          <aside className="w-80 shrink-0 border-l border-white/8 bg-[#070b14] p-3 flex flex-col justify-between overflow-y-auto os-scrollbar">
            {sidePanel === 'proxy' && (
              <ProxyManagerPanel
                activeTabUrl={activeTab?.url || ''}
                engineReady={engineState === 'ready'}
                browserConnection={browserProxyConnection}
                tabConnection={tabProxyConnections[activeTabId] || null}
                onClose={() => setSidePanel('none')}
                onConnect={handleProxyConnect}
                onDisconnect={handleProxyDisconnect}
                onDisconnectAll={handleProxyDisconnectAll}
              />
            )}

            {/* DevTools Inspector Panel */}
            {sidePanel === 'devtools' && (
              <div className="space-y-3 flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between border-b border-white/6 pb-2">
                  <span className="font-mono text-[8.5px] uppercase tracking-wider text-electric">
                    Developer Tools
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
                            ? 'border-electric/60 bg-electric/15 text-[#a0d2ff]'
                            : 'border-white/6 text-[#69849b] hover:bg-white/3'
                        }`}
                      >
                        <mode.icon size={10} />
                        <span>{mode.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center justify-between border border-white/6 bg-black/30 px-2 py-1 font-mono text-[8.5px]">
                  <span>Zoom: {zoomLevel}%</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setZoomLevel((z) => Math.max(50, z - 10))}
                      className="border border-white/6 px-1.5 py-0.5 hover:bg-white/4"
                    >
                      <ZoomOut size={10} />
                    </button>
                    <button
                      onClick={() => setZoomLevel(100)}
                      className="border border-white/6 px-1.5 py-0.5 hover:bg-white/4"
                    >
                      100%
                    </button>
                    <button
                      onClick={() => setZoomLevel((z) => Math.min(200, z + 10))}
                      className="border border-white/6 px-1.5 py-0.5 hover:bg-white/4"
                    >
                      <ZoomIn size={10} />
                    </button>
                  </div>
                </div>

                {/* Network Logs */}
                <div className="flex-1 space-y-1 min-h-35 flex flex-col">
                  <div className="font-mono text-[8px] text-[#557087]">NETWORK TRAFFIC</div>
                  <div className="flex-1 overflow-auto os-scrollbar border border-white/6 bg-black/50 p-2 font-mono text-[8.5px] space-y-1">
                    {networkLogs.map((n, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between border-b border-white/3 pb-0.5"
                      >
                        <span className="text-emerald">{n.method}</span>
                        <span className="truncate max-w-35 text-[#90a8bd]">{n.url}</span>
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
                <div className="flex-1 space-y-1 min-h-35 flex flex-col">
                  <div className="font-mono text-[8px] text-[#557087]">BROWSER CONSOLE</div>
                  <div className="flex-1 overflow-auto os-scrollbar border border-white/6 bg-black/50 p-2 font-mono text-[8.5px] space-y-1">
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

            {/* History Panel */}
            {sidePanel === 'history' && (
              <div className="space-y-3 flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between border-b border-white/6 pb-2">
                  <span className="font-mono text-[8.5px] uppercase tracking-wider text-electric">
                    History
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
                      className="flex w-full items-center gap-2 border border-transparent p-1.5 text-left hover:border-white/6 hover:bg-white/2.5 transition-colors"
                    >
                      {item.favicon ? (
                        <img
                          src={item.favicon}
                          alt=""
                          className="h-3.5 w-3.5 object-contain shrink-0"
                        />
                      ) : (
                        <Globe size={11} className="text-electric shrink-0" />
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
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex items-center justify-between border-b border-white/8 pb-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/6 text-[#dce8f2] shadow-[inset_0_1px_rgba(255,255,255,0.07)]">
                      <BookmarkIcon size={13} />
                    </span>
                    <span className="min-w-0">
                      <strong className="block text-[11px] font-semibold text-[#edf4fa]">
                        Bookmarks
                      </strong>
                      <small className="block text-[8px] text-[#71889b]">
                        {bookmarks.length} saved {bookmarks.length === 1 ? 'page' : 'pages'}
                      </small>
                    </span>
                  </div>
                  <button
                    onClick={() => setSidePanel('none')}
                    className="grid h-7 w-7 place-items-center rounded-lg text-[#71889b] hover:bg-white/7 hover:text-white"
                    aria-label="Close bookmarks"
                  >
                    <X size={12} />
                  </button>
                </div>

                <label className="flex h-8 shrink-0 items-center gap-2 rounded-xl border border-white/9 bg-white/5 px-2.5 shadow-[inset_0_1px_rgba(255,255,255,0.045)] focus-within:border-white/16">
                  <Search size={11} className="shrink-0 text-[#71889b]" />
                  <input
                    value={bookmarkQuery}
                    onChange={(event) => setBookmarkQuery(event.target.value)}
                    className="browser-panel-search-input min-w-0 flex-1 text-[9.5px] text-[#e5eef6] outline-none placeholder:text-[#657b8e]"
                    placeholder="Search bookmarks"
                    aria-label="Search bookmarks"
                  />
                  {bookmarkQuery && (
                    <button
                      type="button"
                      onClick={() => setBookmarkQuery('')}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[#71889b] hover:bg-white/7 hover:text-white"
                      aria-label="Clear bookmark search"
                    >
                      <X size={10} />
                    </button>
                  )}
                </label>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void importBookmarks()}
                    className="flex h-7 items-center gap-1.5 rounded-lg border border-white/8 bg-white/4 px-2 text-[8.5px] text-[#9eb1c0] hover:bg-white/8 hover:text-white"
                  >
                    <Upload size={10} /> Import
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportBookmarks()}
                    className="flex h-7 items-center gap-1.5 rounded-lg border border-white/8 bg-white/4 px-2 text-[8.5px] text-[#9eb1c0] hover:bg-white/8 hover:text-white"
                  >
                    <Download size={10} /> Export
                  </button>
                  <button
                    type="button"
                    onClick={() => setBookmarkDeleteAllPending(true)}
                    disabled={!bookmarks.length}
                    className="flex h-7 items-center gap-1.5 rounded-lg border border-[#ff7777]/12 bg-[#ff6464]/5 px-2 text-[8.5px] text-[#d99898] hover:bg-[#ff6464]/10 hover:text-[#ffb0b0] disabled:pointer-events-none disabled:opacity-35"
                  >
                    <Trash2 size={10} /> Delete all
                  </button>
                  {bookmarkTransferStatus && (
                    <span className="min-w-0 flex-1 truncate text-right text-[8px] text-[#71889b]">
                      {bookmarkTransferStatus}
                    </span>
                  )}
                </div>

                <div className="flex-1 overflow-auto os-scrollbar">
                  {filteredBookmarks.map((bookmark) => (
                    <div
                      key={bookmark.id}
                      onContextMenu={(event) =>
                        handleOpenContextMenu(event, 'bookmark', undefined, bookmark.id)
                      }
                      className="group flex items-center gap-2 border-b border-white/4 px-1 py-2.5 transition-colors hover:bg-white/4"
                    >
                      <button
                        type="button"
                        onClick={() => handleNavigate(bookmark.url)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <img
                          src={bookmark.favicon || getDomainFavicon(bookmark.url)}
                          alt=""
                          className="h-4 w-4 shrink-0 object-contain"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[10px] font-medium text-[#e4edf5]">
                            {bookmark.title}
                          </span>
                          <span className="mt-0.5 block truncate text-[8px] text-[#6f8699]">
                            {(() => {
                              try {
                                return new URL(bookmark.url).hostname.replace(/^www\./, '');
                              } catch {
                                return bookmark.url;
                              }
                            })()}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openBookmarkEditor(bookmark)}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[#6f8598] opacity-0 hover:bg-white/7 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Edit ${bookmark.title}`}
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNewTab(bookmark.url)}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[#6f8598] opacity-0 hover:bg-white/7 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Open ${bookmark.title} in new tab`}
                      >
                        <ExternalLink size={10} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = bookmarks.filter((item) => item.id !== bookmark.id);
                          setBookmarks(updated);
                          saveStoredBookmarks(updated);
                        }}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[#6f8598] opacity-0 hover:bg-[#ef6262]/10 hover:text-[#ff9a9a] group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Delete ${bookmark.title}`}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                  {filteredBookmarks.length === 0 && (
                    <div className="grid place-items-center gap-1 py-10 text-center">
                      <BookmarkIcon size={17} className="text-[#52697b]" />
                      <strong className="text-[10px] font-medium text-[#aebfcd]">
                        {bookmarks.length ? 'No matching bookmarks' : 'No bookmarks saved'}
                      </strong>
                      <span className="text-[8px] text-[#61788b]">
                        {bookmarks.length
                          ? 'Try another title or address.'
                          : 'Star a page to keep it here.'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Browser Preferences */}
            {sidePanel === 'settings' && (
              <div className="flex min-h-0 flex-1 flex-col space-y-3">
                <div className="flex items-center justify-between border-b border-white/6 pb-2">
                  <span className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-wider text-electric">
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
                  <label className="block rounded border border-white/6 bg-black/25 p-2.5">
                    <span className="mb-1.5 block text-[10px] font-medium text-[#d4e1ed]">
                      Default Search Engine
                    </span>
                    <select
                      value={preferences.searchEngine}
                      onChange={(event) =>
                        updatePreference('searchEngine', event.target.value as SearchEngine)
                      }
                      className="w-full rounded border border-white/8 bg-[#080d15] px-2 py-1.5 text-[10px] text-[#bcd0df] outline-none focus:border-electric/50"
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
                      className="flex w-full items-center justify-between gap-3 rounded border border-white/6 bg-black/25 p-2.5 text-left hover:bg-white/2.5"
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
                            ? 'border-electric/60 bg-electric/35'
                            : 'border-white/10 bg-white/4'
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

                  <div className="rounded border border-white/6 bg-black/25 p-2.5">
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
                      className="os-range"
                      style={{
                        background: `linear-gradient(90deg, var(--color-os-accent) ${((preferences.defaultZoom - 50) / 150) * 100}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-1 border-t border-white/6 pt-3">
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
                      className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-[9.5px] text-[#8fa7bb] hover:bg-white/4 hover:text-white"
                    >
                      <span>{item.label}</span>
                      <ArrowRight size={10} />
                    </button>
                  ))}
                </div>

                <div className="mt-auto border-t border-white/6 pt-3">
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
          className="nammu-context-surface nammu-context-legacy absolute z-50 max-h-[90%] min-w-52.5 overflow-y-auto border border-white/[0.14] bg-navy/95 p-1 font-mono text-[10px] text-[#c9d7e2] shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 os-scrollbar"
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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Plus size={11} className="text-electric" />
                  <span>New Tab</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+T</span>
              </button>

              <button
                onClick={() => {
                  handleDuplicateTab(contextMenu.targetTabId!);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Copy size={11} className="text-electric" />
                  <span>Duplicate Tab</span>
                </div>
              </button>

              <button
                onClick={() => {
                  handleReload();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <RotateCw size={11} className="text-electric" />
                  <span>Reload Tab</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+R</span>
              </button>

              <div className="my-1 border-t border-white/8" />

              <button
                onClick={() => {
                  handleTogglePinTab(contextMenu.targetTabId!);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  {tabs.find((t) => t.id === contextMenu.targetTabId)?.isMuted ? (
                    <Volume2 size={11} className="text-emerald" />
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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Share2 size={11} className="text-electric" />
                  <span>Copy Page URL</span>
                </div>
              </button>

              <div className="my-1 border-t border-white/8" />

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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
              >
                <span>Close Other Tabs</span>
              </button>

              <button
                onClick={() => {
                  handleCloseTabsToRight(contextMenu.targetTabId!);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Scissors size={11} className="text-electric" />
                  <span>Cut</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+X</span>
              </button>

              <button
                onClick={() => {
                  navigator.clipboard?.writeText(omniboxInput);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Copy size={11} className="text-electric" />
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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Clipboard size={11} className="text-electric" />
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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <CornerDownLeft size={11} className="text-emerald" />
                  <span>Paste and Go</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Enter</span>
              </button>

              <div className="my-1 border-t border-white/8" />

              <button
                onClick={() => {
                  omniboxRef.current?.select();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <span>Select All</span>
                <span className="text-[8.5px] text-[#567289]">Ctrl+A</span>
              </button>

              <button
                onClick={() => {
                  setOmniboxInput('');
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white disabled:opacity-30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ArrowLeft size={11} className="text-electric" />
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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white disabled:opacity-30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ArrowRight size={11} className="text-electric" />
                  <span>Forward</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Alt+→</span>
              </button>

              <button
                onClick={() => {
                  handleReload();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <RotateCw size={11} className="text-electric" />
                  <span>Reload</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+R</span>
              </button>

              <div className="my-1 border-t border-white/8" />

              <button
                onClick={() => {
                  handleToggleBookmark();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Star
                    size={11}
                    fill={isCurrentBookmarked ? '#f59e0b' : 'none'}
                    className="text-os-amber"
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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Copy size={11} className="text-electric" />
                  <span>Copy Page URL</span>
                </div>
              </button>

              <div className="my-1 border-t border-white/8" />

              <button
                onClick={() => {
                  openFindBar();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Search size={11} className="text-electric" />
                  <span>Find in Page</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+F</span>
              </button>

              <button
                onClick={() => {
                  handleSavePage();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileDown size={11} className="text-electric" />
                  <span>Save Page</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+S</span>
              </button>

              <button
                onClick={() => {
                  handlePrintPage();
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Printer size={11} className="text-electric" />
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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileCode size={11} className="text-electric" />
                  <span>View Page Source</span>
                </div>
              </button>

              <div className="my-1 border-t border-white/8" />

              <button
                onClick={() => {
                  setSidePanel((p) => (p === 'devtools' ? 'none' : 'devtools'));
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileCode size={11} className="text-electric" />
                  <span>Developer Tools</span>
                </div>
                <span className="text-[8.5px] text-[#567289]">Ctrl+Shift+I</span>
              </button>

              <button
                onClick={() => {
                  setZoomLevel(100);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
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
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ExternalLink size={11} className="text-electric" />
                  <span>Open in New Tab</span>
                </div>
              </button>

              <button
                onClick={() => {
                  const bookmark = bookmarks.find(
                    (item) => item.id === contextMenu.targetBookmarkId,
                  );
                  if (bookmark) openBookmarkEditor(bookmark);
                  setContextMenu((previous) => ({ ...previous, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left transition-colors hover:bg-electric/15 hover:text-white"
              >
                <div className="flex items-center gap-2">
                  <Pencil size={11} className="text-electric" />
                  <span>Edit Bookmark</span>
                </div>
              </button>

              <button
                onClick={() => {
                  const bm = bookmarks.find((b) => b.id === contextMenu.targetBookmarkId);
                  if (bm?.url) navigator.clipboard?.writeText(bm.url);
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-electric/15 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Copy size={11} className="text-electric" />
                  <span>Copy Link Address</span>
                </div>
              </button>

              <div className="my-1 border-t border-white/8" />

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
