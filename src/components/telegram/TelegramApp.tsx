import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Edit2, Plus, RotateCw, Send, Volume2, VolumeX, X } from 'lucide-react';
import { getPlatformCapabilities, type WebSurfaceSnapshot } from '../../platform';
import NativeWebSurface, { type NativeWebSurfaceHandle } from '../web-surfaces/NativeWebSurface';
import { getGeckoRuntimeUrl } from '../../web-surfaces/geckoRuntimeUrl';
import {
  MAX_TELEGRAM_ACCOUNTS,
  getStoredTelegramTabs,
  saveStoredTelegramTabs,
  type TelegramAccountTab,
} from './services/telegramStore';

const TELEGRAM_WEB_URL = 'https://web.telegram.org/a/';
const RUNTIME_BOOT_URL = 'about:blank';
const ACCOUNT_COLORS = ['#2aabee', '#64b5f6', '#8b5cf6', '#2dd4bf', '#f59e0b', '#f472b6'];
const CONTAINER_COLORS = ['blue', 'turquoise', 'purple', 'green', 'orange', 'pink', 'red'];

type EngineState = 'starting' | 'ready' | 'error';

type GeckoRuntimeWindow = Window & {
  geckoDispose?: () => void;
  geckoEvalChrome?: (script: string) => Promise<unknown>;
};

interface RuntimeTab {
  id: string;
  url: string;
  containerColor: string;
}

function getSafeTelegramUrl(candidate?: string) {
  try {
    const url = new URL(candidate || TELEGRAM_WEB_URL);
    if (
      url.protocol === 'https:' &&
      (url.hostname === 'web.telegram.org' ||
        url.hostname === 'telegram.org' ||
        url.hostname === 't.me')
    ) {
      return url.toString();
    }
  } catch {}
  return TELEGRAM_WEB_URL;
}

function getRuntimeTabs(tabs: TelegramAccountTab[]): RuntimeTab[] {
  return tabs.map((tab, index) => ({
    id: tab.id,
    url: getSafeTelegramUrl(tab.url),
    containerColor: CONTAINER_COLORS[index % CONTAINER_COLORS.length],
  }));
}

const TELEGRAM_CONTAINER_HELPER = `
  const getTelegramContainerId = (descriptor) => {
    try {
      const { ContextualIdentityService } = ChromeUtils.importESModule(
        'resource://gre/modules/ContextualIdentityService.sys.mjs'
      );
      const identityName = 'Nammu Telegram · ' + descriptor.id;
      const existingIdentity = ContextualIdentityService.getPublicIdentities()
        .find((identity) => identity.name === identityName);
      const identity = existingIdentity || ContextualIdentityService.create(
        identityName,
        descriptor.containerColor,
        'circle'
      );
      return identity.userContextId;
    } catch (error) {
      console.warn('Nammu Telegram container isolation unavailable', error);
      return 0;
    }
  };
`;

function buildInitializeSessionScript(tabs: TelegramAccountTab[], activeTabId: string) {
  const descriptors = getRuntimeTabs(tabs);
  return `(()=>{
    const descriptors = ${JSON.stringify(descriptors)};
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    ${TELEGRAM_CONTAINER_HELPER}
    const previousTabs = Array.from(gBrowser.tabs);
    const registry = Object.create(null);
    const loaded = Object.create(null);
    globalThis.__nammuTelegramTabs = registry;
    globalThis.__nammuTelegramLoaded = loaded;
    for (const descriptor of descriptors) {
      const tab = gBrowser.addTab(${JSON.stringify(RUNTIME_BOOT_URL)}, {
        triggeringPrincipal: principal,
        userContextId: getTelegramContainerId(descriptor)
      });
      registry[descriptor.id] = tab;
    }
    for (const previousTab of previousTabs) gBrowser.removeTab(previousTab, { animate: false });
    const activeDescriptor = descriptors.find((item) => item.id === ${JSON.stringify(activeTabId)}) || descriptors[0];
    const activeTab = activeDescriptor && registry[activeDescriptor.id];
    if (activeTab) {
      gBrowser.selectedTab = activeTab;
      openTrustedLinkIn(activeDescriptor.url, 'current');
      loaded[activeDescriptor.id] = true;
    }
    return descriptors.length;
  })()`;
}

function buildCreateTabScript(tab: TelegramAccountTab, index: number) {
  const descriptor = {
    ...getRuntimeTabs([tab])[0],
    containerColor: CONTAINER_COLORS[index % CONTAINER_COLORS.length],
  };
  return `(()=>{
    const descriptor = ${JSON.stringify(descriptor)};
    const registry = globalThis.__nammuTelegramTabs || (globalThis.__nammuTelegramTabs = Object.create(null));
    const loaded = globalThis.__nammuTelegramLoaded || (globalThis.__nammuTelegramLoaded = Object.create(null));
    ${TELEGRAM_CONTAINER_HELPER}
    if (registry[descriptor.id] && !registry[descriptor.id].closing) {
      gBrowser.selectedTab = registry[descriptor.id];
      return 'existing-tab-selected';
    }
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    const runtimeTab = gBrowser.addTab(${JSON.stringify(RUNTIME_BOOT_URL)}, {
      triggeringPrincipal: principal,
      userContextId: getTelegramContainerId(descriptor)
    });
    registry[descriptor.id] = runtimeTab;
    gBrowser.selectedTab = runtimeTab;
    openTrustedLinkIn(descriptor.url, 'current');
    loaded[descriptor.id] = true;
    return 'tab-created';
  })()`;
}

function buildSelectTabScript(tab: TelegramAccountTab) {
  return `(()=>{
    const descriptor = ${JSON.stringify({ id: tab.id, url: getSafeTelegramUrl(tab.url) })};
    const registry = globalThis.__nammuTelegramTabs || Object.create(null);
    const loaded = globalThis.__nammuTelegramLoaded || (globalThis.__nammuTelegramLoaded = Object.create(null));
    const runtimeTab = registry[descriptor.id];
    if (!runtimeTab || runtimeTab.closing) return 'tab-unavailable';
    gBrowser.selectedTab = runtimeTab;
    if (!loaded[descriptor.id]) {
      openTrustedLinkIn(descriptor.url, 'current');
      loaded[descriptor.id] = true;
    }
    return 'tab-selected';
  })()`;
}

function buildRemoveTabScript(tabId: string, nextActiveTabId: string) {
  return `(()=>{
    const registry = globalThis.__nammuTelegramTabs || Object.create(null);
    const loaded = globalThis.__nammuTelegramLoaded || Object.create(null);
    const runtimeTab = registry[${JSON.stringify(tabId)}];
    if (runtimeTab && !runtimeTab.closing) gBrowser.removeTab(runtimeTab, { animate: false });
    delete registry[${JSON.stringify(tabId)}];
    delete loaded[${JSON.stringify(tabId)}];
    const nextTab = registry[${JSON.stringify(nextActiveTabId)}];
    if (nextTab && !nextTab.closing) gBrowser.selectedTab = nextTab;
    return 'tab-removed';
  })()`;
}

function buildRunOnTabScript(tabId: string, command: string) {
  return `(()=>{
    const runtimeTab = globalThis.__nammuTelegramTabs?.[${JSON.stringify(tabId)}];
    if (!runtimeTab || runtimeTab.closing) return 'tab-unavailable';
    gBrowser.selectedTab = runtimeTab;
    ${command}
  })()`;
}

function createAccountId() {
  const id =
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `telegram-account-${id}`;
}

export default function TelegramApp() {
  const platform = getPlatformCapabilities();
  const nativeSurfaceEnabled = platform.runtime === 'tauri';
  const [tabs, setTabs] = useState<TelegramAccountTab[]>(getStoredTelegramTabs);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id || 'telegram-account-1');
  const [editingTab, setEditingTab] = useState<TelegramAccountTab | null>(null);
  const [editingName, setEditingName] = useState('');
  const [engineState, setEngineState] = useState<EngineState>('starting');
  const [engineError, setEngineError] = useState('');
  const [engineAttempt, setEngineAttempt] = useState(1);
  const [runtimeWispUrl, setRuntimeWispUrl] = useState('');
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const geckoRuntimeRef = useRef<GeckoRuntimeWindow | null>(null);
  const engineReadyRef = useRef(false);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const nativeSurfaceRefs = useRef(new Map<string, NativeWebSurfaceHandle>());
  const nativeReadyRef = useRef(new Set<string>());

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];

  useEffect(() => {
    tabsRef.current = tabs;
    saveStoredTelegramTabs(tabs);
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    if (nativeSurfaceEnabled) return;
    let cancelled = false;
    void platform.services
      .wispUrl()
      .then((url) => {
        if (!cancelled) setRuntimeWispUrl(url);
      })
      .catch((error) => {
        if (cancelled) return;
        setEngineState('error');
        setEngineError(
          error instanceof Error ? error.message : 'Telegram networking is unavailable.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [nativeSurfaceEnabled, platform.services]);

  const evaluateInRuntime = useCallback(
    (script: string): Promise<unknown> => {
      if (nativeSurfaceEnabled) return Promise.resolve(null);
      const execute = async () => {
        const runtime = iframeRef.current?.contentWindow as GeckoRuntimeWindow | null;
        if (!runtime?.geckoEvalChrome) return null;
        let timeoutId = 0;
        try {
          return await Promise.race([
            runtime.geckoEvalChrome(script),
            new Promise<never>((_, reject) => {
              timeoutId = window.setTimeout(
                () => reject(new Error('Telegram did not answer the command in time.')),
                15_000,
              );
            }),
          ]);
        } finally {
          window.clearTimeout(timeoutId);
        }
      };
      const result = commandQueueRef.current.then(execute, execute);
      commandQueueRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [nativeSurfaceEnabled],
  );

  useEffect(() => {
    if (nativeSurfaceEnabled) return;
    const handleRuntimeMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        iframeRef.current?.contentWindow !== event.source
      )
        return;
      if (event.data?.type === 'NAMMU_GECKO_ERROR') {
        engineReadyRef.current = false;
        setEngineState('error');
        setEngineError('Telegram could not finish opening. Please try again.');
        return;
      }
      if (event.data?.type !== 'NAMMU_GECKO_READY') return;
      geckoRuntimeRef.current = event.source as GeckoRuntimeWindow;
      void evaluateInRuntime(buildInitializeSessionScript(tabsRef.current, activeTabIdRef.current))
        .then(() => {
          engineReadyRef.current = true;
          setEngineState('ready');
          setEngineError('');
        })
        .catch((error) => {
          engineReadyRef.current = false;
          setEngineState('error');
          setEngineError(error instanceof Error ? error.message : 'Telegram could not open.');
        });
    };
    window.addEventListener('message', handleRuntimeMessage);
    return () => window.removeEventListener('message', handleRuntimeMessage);
  }, [evaluateInRuntime, nativeSurfaceEnabled]);

  useEffect(() => {
    if (!nativeSurfaceEnabled) return;
    if (nativeReadyRef.current.has(activeTabId)) {
      engineReadyRef.current = true;
      setEngineState('ready');
      setEngineError('');
    } else {
      engineReadyRef.current = false;
      setEngineState('starting');
    }
  }, [activeTabId, engineAttempt, nativeSurfaceEnabled]);

  useEffect(() => {
    if (engineState !== 'starting') return;
    const timeout = window.setTimeout(() => {
      if (engineReadyRef.current) return;
      setEngineState('error');
      setEngineError('Telegram did not finish opening within two minutes.');
    }, 120_000);
    return () => window.clearTimeout(timeout);
  }, [engineAttempt, engineState]);

  useEffect(
    () => () => {
      nativeSurfaceRefs.current.clear();
      nativeReadyRef.current.clear();
      if (nativeSurfaceEnabled) return;
      engineReadyRef.current = false;
      try {
        geckoRuntimeRef.current?.geckoDispose?.();
      } catch {}
      geckoRuntimeRef.current = null;
      try {
        iframeRef.current?.setAttribute('src', 'about:blank');
      } catch {}
    },
    [nativeSurfaceEnabled],
  );

  const activateTab = (tab: TelegramAccountTab) => {
    activeTabIdRef.current = tab.id;
    setActiveTabId(tab.id);
    if (!nativeSurfaceEnabled && engineReadyRef.current) {
      void evaluateInRuntime(buildSelectTabScript(tab));
    }
  };

  const addAccount = () => {
    if (tabs.length >= MAX_TELEGRAM_ACCOUNTS) return;
    const id = createAccountId();
    const tab: TelegramAccountTab = {
      id,
      name: `Account ${tabs.length + 1}`,
      color: ACCOUNT_COLORS[tabs.length % ACCOUNT_COLORS.length],
      unreadCount: 0,
      isMuted: false,
      url: TELEGRAM_WEB_URL,
    };
    const next = [...tabs, tab];
    tabsRef.current = next;
    setTabs(next);
    activeTabIdRef.current = id;
    setActiveTabId(id);
    if (!nativeSurfaceEnabled && engineReadyRef.current) {
      void evaluateInRuntime(buildCreateTabScript(tab, next.length - 1));
    }
  };

  const closeAccount = (tabId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (tabs.length === 1) return;
    const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
    const next = tabs.filter((tab) => tab.id !== tabId);
    const nextActiveId =
      activeTabId === tabId ? next[Math.min(closingIndex, next.length - 1)].id : activeTabId;
    tabsRef.current = next;
    setTabs(next);
    nativeReadyRef.current.delete(tabId);
    nativeSurfaceRefs.current.delete(tabId);
    if (activeTabId === tabId) {
      activeTabIdRef.current = nextActiveId;
      setActiveTabId(nextActiveId);
    }
    if (!nativeSurfaceEnabled && engineReadyRef.current) {
      void evaluateInRuntime(buildRemoveTabScript(tabId, nextActiveId));
    }
  };

  const toggleMute = () => {
    if (!activeTab) return;
    const muted = !activeTab.isMuted;
    setTabs((current) =>
      current.map((tab) => (tab.id === activeTab.id ? { ...tab, isMuted: muted } : tab)),
    );
    if (nativeSurfaceEnabled) void nativeSurfaceRefs.current.get(activeTab.id)?.setMuted(muted);
    else if (engineReadyRef.current) {
      void evaluateInRuntime(
        buildRunOnTabScript(
          activeTab.id,
          "runtimeTab.toggleMuteAudio('nammu-telegram'); return 'ok';",
        ),
      );
    }
  };

  const reload = () => {
    if (!activeTab) return;
    if (nativeSurfaceEnabled) void nativeSurfaceRefs.current.get(activeTab.id)?.reload();
    else if (engineReadyRef.current) {
      void evaluateInRuntime(
        buildRunOnTabScript(activeTab.id, "runtimeTab.linkedBrowser.reload(); return 'ok';"),
      );
    }
  };

  const retry = () => {
    nativeReadyRef.current.clear();
    nativeSurfaceRefs.current.clear();
    engineReadyRef.current = false;
    setEngineError('');
    setEngineState('starting');
    if (!nativeSurfaceEnabled) {
      try {
        geckoRuntimeRef.current?.geckoDispose?.();
      } catch {}
      geckoRuntimeRef.current = null;
      commandQueueRef.current = Promise.resolve();
    }
    setEngineAttempt((value) => value + 1);
  };

  const saveAccountName = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingTab) return;
    const name = editingName.trim().slice(0, 48);
    if (!name) return;
    setTabs((current) => current.map((tab) => (tab.id === editingTab.id ? { ...tab, name } : tab)));
    setEditingTab(null);
    setEditingName('');
  };

  return (
    <div className="flex h-full min-h-0 w-full select-none flex-col overflow-hidden bg-[#0e1621] text-[#e6edf3]">
      <div className="flex h-9 shrink-0 items-center justify-between gap-1.5 overflow-x-auto border-b border-white/[0.08] bg-[#17212b] px-2 os-scrollbar">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                onClick={() => activateTab(tab)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') activateTab(tab);
                }}
                className={`group flex h-7 max-w-48 cursor-pointer items-center gap-2 rounded px-2.5 text-[11px] transition-colors ${
                  active
                    ? 'border border-[#2aabee]/30 bg-[#202f3d] font-medium text-white'
                    : 'bg-white/[0.025] text-[#8fa6b8] hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tab.color }} />
                <span className="truncate">{tab.name}</span>
                {tab.isMuted && <VolumeX size={10} className="shrink-0 text-[#ef6574]" />}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingTab(tab);
                    setEditingName(tab.name);
                  }}
                  className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#64b5f6]"
                  title="Rename account tab"
                >
                  <Edit2 size={10} />
                </button>
                {tabs.length > 1 && (
                  <button
                    type="button"
                    onClick={(event) => closeAccount(tab.id, event)}
                    className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#ef6574]"
                    title="Close account tab"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={addAccount}
            disabled={tabs.length >= MAX_TELEGRAM_ACCOUNTS}
            className="grid h-6 w-6 shrink-0 place-items-center rounded bg-white/[0.04] text-[#8fa6b8] transition-colors hover:bg-[#2aabee]/15 hover:text-[#64b5f6] disabled:cursor-not-allowed disabled:opacity-30"
            title={
              tabs.length >= MAX_TELEGRAM_ACCOUNTS
                ? `Maximum ${MAX_TELEGRAM_ACCOUNTS} accounts`
                : 'Add Telegram account tab'
            }
          >
            <Plus size={12} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className="mr-1 hidden items-center gap-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c7488] sm:flex">
            <Send size={10} className="text-[#2aabee]" /> Telegram
          </span>
          <button
            type="button"
            onClick={reload}
            disabled={engineState !== 'ready'}
            className="grid h-6 w-6 place-items-center rounded text-[#8fa6b8] transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-35"
            title="Reload Telegram"
          >
            <RotateCw size={12} />
          </button>
          <button
            type="button"
            onClick={toggleMute}
            disabled={engineState !== 'ready'}
            className="grid h-6 w-6 place-items-center rounded text-[#8fa6b8] transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-35"
            title={activeTab?.isMuted ? 'Unmute Telegram' : 'Mute Telegram'}
          >
            {activeTab?.isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0e1621]">
        {engineState === 'error' && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-[#0e1621] p-6 text-center">
            <div className="max-w-sm">
              <AlertTriangle size={26} className="mx-auto text-amber-400" />
              <div className="mt-3 text-[13px] font-semibold text-white">
                Telegram could not open
              </div>
              <div className="mt-1 text-[10.5px] leading-relaxed text-[#8fa6b8]">{engineError}</div>
              <button
                type="button"
                onClick={retry}
                className="mt-4 border border-[#2aabee]/45 bg-[#2aabee]/10 px-3 py-1.5 text-[10px] text-[#7ac8f5] hover:bg-[#2aabee]/20"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {nativeSurfaceEnabled
          ? tabs.map((tab) => (
              <NativeWebSurface
                key={`${engineAttempt}-${tab.id}`}
                ref={(surface) => {
                  if (surface) nativeSurfaceRefs.current.set(tab.id, surface);
                  else nativeSurfaceRefs.current.delete(tab.id);
                }}
                enabled
                active={tab.id === activeTabId}
                owner="telegram"
                profileKey={tab.id}
                privateSession={false}
                url={getSafeTelegramUrl(tab.url)}
                zoom={100}
                muted={tab.isMuted}
                browserOverlayActive={false}
                overlayActive={Boolean(editingTab)}
                surfaceLabel={`Telegram · ${tab.name}`}
                onState={(snapshot: WebSurfaceSnapshot) => {
                  setTabs((current) => {
                    const target = current.find((item) => item.id === tab.id);
                    if (!target || target.isMuted === snapshot.isMuted) return current;
                    return current.map((item) =>
                      item.id === tab.id ? { ...item, isMuted: snapshot.isMuted } : item,
                    );
                  });
                }}
                onReady={() => {
                  nativeReadyRef.current.add(tab.id);
                  if (tab.id === activeTabIdRef.current) {
                    engineReadyRef.current = true;
                    setEngineState('ready');
                    setEngineError('');
                  }
                }}
                onFailure={(message) => {
                  if (tab.id !== activeTabIdRef.current) return;
                  engineReadyRef.current = false;
                  setEngineState('error');
                  setEngineError(message || 'Telegram could not open in the native web runtime.');
                }}
                onDiagnostic={() => {}}
              />
            ))
          : runtimeWispUrl && (
              <iframe
                key={engineAttempt}
                ref={iframeRef}
                src={getGeckoRuntimeUrl(`nammu-telegram-${engineAttempt}`, runtimeWispUrl)}
                className="h-full w-full border-0 bg-[#0e1621]"
                title="Telegram Web"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-orientation-lock"
                allow="cross-origin-isolated; camera; microphone; clipboard-read; clipboard-write; autoplay; display-capture; fullscreen"
              />
            )}
      </div>

      {editingTab && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <form
            onSubmit={saveAccountName}
            className="w-full max-w-sm border border-white/[0.1] bg-[#17212b] p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-semibold text-white">Rename account tab</div>
              <button
                type="button"
                onClick={() => setEditingTab(null)}
                className="text-[#8fa6b8] hover:text-white"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <label className="mt-4 block font-mono text-[8px] uppercase tracking-wider text-[#6d879b]">
              Account label
            </label>
            <input
              autoFocus
              value={editingName}
              maxLength={48}
              onChange={(event) => setEditingName(event.target.value)}
              className="mt-1.5 h-9 w-full border border-white/[0.1] bg-[#0e1621] px-3 text-[12px] text-white outline-none focus:border-[#2aabee]/60"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingTab(null)}
                className="border border-white/[0.08] px-3 py-1.5 text-[10px] text-[#8fa6b8] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="border border-[#2aabee]/45 bg-[#2aabee]/15 px-3 py-1.5 text-[10px] text-[#7ac8f5] hover:bg-[#2aabee]/25"
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
