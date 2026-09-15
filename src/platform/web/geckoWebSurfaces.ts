import type {
  CapabilityResult,
  PlatformWebSurfaces,
  WebSurfaceBounds,
  WebSurfaceControl,
  WebSurfaceNavigationPolicy,
  WebSurfaceProxyEndpoint,
  WebSurfaceSnapshot,
} from '../contracts';
import type { WebIntegrationProfileController } from './integrationProfiles';

type GeckoWindow = Window & {
  geckoEvalChrome?: (script: string) => Promise<unknown>;
  geckoDispose?: () => void;
};

interface Session {
  key: string;
  iframe: HTMLIFrameElement;
  ready: boolean;
  surfaceIds: Set<string>;
  poll?: number;
  profileProxy: readonly WebSurfaceProxyEndpoint[];
  surfaceProxies: Map<string, readonly WebSurfaceProxyEndpoint[]>;
  temporaryCleanup?: boolean;
  cleanupReady?: () => void;
  cleanupFailed?: (error: Error) => void;
}

interface Entry {
  id: string;
  session: Session;
  policy: WebSurfaceNavigationPolicy;
  bounds: WebSurfaceBounds;
  privateSession: boolean;
  partitionKey?: string;
  snapshot: WebSurfaceSnapshot;
}

const failure = (error: unknown): CapabilityResult<never> => ({
  status: 'error',
  code: 'operation-failed',
  message: error instanceof Error ? error.message : String(error),
});
const ok = <T>(value: T): CapabilityResult<T> => ({ status: 'success', value });

function allowed(policy: WebSurfaceNavigationPolicy, raw: string, trustedOrigin: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !host ||
      url.username ||
      url.password ||
      url.origin === trustedOrigin ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '[::1]'
    ) {
      return false;
    }
    return policy.allowPublicWeb || policy.allowedOrigins.includes(url.origin);
  } catch {
    return false;
  }
}

function styleSession(session: Session, bounds: WebSurfaceBounds, visible: boolean) {
  Object.assign(session.iframe.style, {
    position: 'fixed',
    border: '0',
    zIndex: '40',
    background: '#fff',
    left: `${bounds.x}px`,
    top: `${bounds.y}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    display: visible ? 'block' : 'none',
  });
}

function proxyRoutingScript(session: Session) {
  const routing = {
    profile: session.profileProxy,
    surfaces: Object.fromEntries(session.surfaceProxies),
  };
  return `(()=>{
    const routing = ${JSON.stringify(routing)};
    const proxyService = Cc['@mozilla.org/network/protocol-proxy-service;1']
      .getService(Ci.nsIProtocolProxyService);
    globalThis.__nammuIntegrationProxyRouting = routing;
    if (!globalThis.__nammuIntegrationProxyFilter) {
      const toChain = (route, isolationKey) => {
        if (!Array.isArray(route) || route.length === 0) return null;
        return route.reduceRight((failover, endpoint) => {
          const type = endpoint.protocol === 'socks5'
            ? 'socks'
            : endpoint.protocol === 'socks4' ? 'socks4' : 'http';
          const resolvesHost = type.startsWith('socks')
            ? Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST : 0;
          const tunnel = endpoint.protocol === 'https' ? Ci.nsIProxyInfo.ALWAYS_TUNNEL_VIA_PROXY : 0;
          return proxyService.newProxyInfo(
            type, endpoint.host, endpoint.port, '', isolationKey,
            resolvesHost | tunnel, 4, failover
          );
        }, null);
      };
      globalThis.__nammuIntegrationProxyFilter = {
        QueryInterface: ChromeUtils.generateQI(['nsIProtocolProxyChannelFilter']),
        applyFilter(channel, defaultProxyInfo, result) {
          try {
            const scheme = channel.URI?.scheme;
            if (scheme !== 'http' && scheme !== 'https') {
              result.onProxyFilterResult(defaultProxyInfo); return;
            }
            const top = channel.loadInfo?.browsingContext?.top;
            const tabs = globalThis.__nammuIntegrationTabs || Object.create(null);
            let surfaceId = null;
            for (const [id, tab] of Object.entries(tabs)) {
              if (tab?.linkedBrowser?.browsingContext === top) { surfaceId = id; break; }
            }
            const current = globalThis.__nammuIntegrationProxyRouting || { profile: [], surfaces: {} };
            const route = (surfaceId && current.surfaces?.[surfaceId]) || current.profile;
            result.onProxyFilterResult(toChain(route, 'nammu-integration-' + (surfaceId || 'profile')) || defaultProxyInfo);
          } catch (_) { result.onProxyFilterResult(defaultProxyInfo); }
        }
      };
      proxyService.registerChannelFilter(globalThis.__nammuIntegrationProxyFilter, 0);
    }
    try { Services.obs.notifyObservers(null, 'net:prune-all-connections'); } catch (_) {}
    try { Services.dns.clearCache(true); } catch (_) {}
    return 'proxy-updated';
  })()`;
}

/**
 * Core-owned Web driver. Logical surfaces sharing a profile share one Gecko
 * engine/session, preserving Browser's one-engine-per-application-session model.
 */
export function createGeckoWebSurfaces(environment: {
  getDocument(): Document | undefined;
  getWindow(): Window | undefined;
  getOrigin(): string | undefined;
}, integrationProfiles?: WebIntegrationProfileController): PlatformWebSurfaces {
  const entries = new Map<string, Entry>();
  const sessions = new Map<string, Session>();
  const stateListeners = new Set<(snapshot: WebSurfaceSnapshot) => void>();
  const openListeners = new Set<(request: any) => void>();
  const supported = Boolean(
    environment.getDocument() && environment.getWindow() && environment.getOrigin(),
  );
  const createSession = (
    profileKey: string,
    sessionId: string,
    temporaryCleanup = false,
    appendImmediately = true,
  ): Session => {
    const documentObject = environment.getDocument();
    const origin = environment.getOrigin();
    if (!documentObject || !origin) throw new Error('The Web runtime is unavailable.');
    const iframe = documentObject.createElement('iframe');
    const wisp = new URL('/firefox-wisp/', origin);
    wisp.protocol = wisp.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = new URLSearchParams({
      app: '1',
      autostart: '1',
      url: 'about:blank',
      session: sessionId,
    });
    const fragment = new URLSearchParams({ 'nammu-wisp': wisp.toString() });
    iframe.src = `/firefox-wasm/index.html?${query}#${fragment}`;
    iframe.title = temporaryCleanup
      ? 'Nammu integration profile cleanup'
      : 'Nammu packaged web surface';
    iframe.sandbox.add(
      'allow-scripts',
      'allow-same-origin',
      'allow-forms',
      'allow-popups',
      'allow-modals',
      'allow-downloads',
      'allow-pointer-lock',
    );
    iframe.allow =
      'cross-origin-isolated; camera; microphone; clipboard-read; clipboard-write; autoplay; fullscreen';
    if (temporaryCleanup) iframe.style.display = 'none';
    const session: Session = {
      key: profileKey,
      iframe,
      ready: false,
      surfaceIds: new Set(),
      profileProxy: [],
      surfaceProxies: new Map(),
      temporaryCleanup,
    };
    sessions.set(profileKey, session);
    if (appendImmediately) documentObject.body.append(iframe);
    return session;
  };

  const emit = (entry: Entry) =>
    stateListeners.forEach((listener) => listener({ ...entry.snapshot }));
  const entryFor = (id: string) => {
    const entry = entries.get(id);
    if (!entry) throw new Error('The Web integration surface does not exist.');
    return entry;
  };
  const runtimeFor = (session: Session) => session.iframe.contentWindow as GeckoWindow | null;
  const chrome = async (session: Session, source: string) => {
    const runtime = runtimeFor(session);
    if (!session.ready || !runtime?.geckoEvalChrome) {
      throw new Error('The Gecko integration session is not ready.');
    }
    return runtime.geckoEvalChrome(source);
  };
  const purgeIdentities = async (
    session: Session,
    names: readonly string[],
    namespaces: readonly string[],
  ) => {
    await chrome(
      session,
      `(()=>{
        const names = new Set(${JSON.stringify(names)});
        const prefixes = ${JSON.stringify(namespaces)}.map(
          (namespace) => 'Nammu Integration | ' + namespace + '-'
        );
        const { ContextualIdentityService } = ChromeUtils.importESModule(
          'resource://gre/modules/ContextualIdentityService.sys.mjs'
        );
        const matching = ContextualIdentityService.getPublicIdentities()
          .filter((identity) =>
            names.has(identity.name) || prefixes.some((prefix) => identity.name.startsWith(prefix))
          );
        return Promise.all(matching.map((identity) =>
          ContextualIdentityService.remove(identity.userContextId)
        )).then(() => matching.length);
      })()`,
    );
  };
  const tabScript = (entry: Entry, command: string) => `(()=>{
    const tab = globalThis.__nammuIntegrationTabs?.[${JSON.stringify(entry.id)}];
    if (!tab || tab.closing) return 'surface-tab-unavailable';
    ${command}
  })()`;
  const syncSessionVisibility = (session: Session) => {
    const visibleEntry = [...session.surfaceIds]
      .map((id) => entries.get(id))
      .find((entry) => entry?.snapshot.visible);
    if (!visibleEntry) {
      session.iframe.style.display = 'none';
      return;
    }
    styleSession(session, visibleEntry.bounds, true);
    if (session.ready) {
      void chrome(
        session,
        tabScript(visibleEntry, 'gBrowser.selectedTab = tab; return "selected";'),
      ).catch(() => undefined);
    }
  };
  const createTab = async (entry: Entry, reuseFirst: boolean) => {
    const identityName = entry.partitionKey
      ? integrationProfiles?.identityName(entry.session.key, entry.partitionKey) ??
        `Nammu Integration | ${entry.session.key} | ${entry.partitionKey}`
      : null;
    await chrome(
      entry.session,
      `(()=>{
        const registry = globalThis.__nammuIntegrationTabs ||
          (globalThis.__nammuIntegrationTabs = Object.create(null));
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        const identityName = ${JSON.stringify(identityName)};
        let userContextId = 0;
        if (identityName) {
          const { ContextualIdentityService } = ChromeUtils.importESModule(
            'resource://gre/modules/ContextualIdentityService.sys.mjs'
          );
          const existing = ContextualIdentityService.getPublicIdentities()
            .find((identity) => identity.name === identityName);
          const identity = existing || ContextualIdentityService.create(identityName, 'blue', 'circle');
          userContextId = identity.userContextId;
        }
        const initialTab = gBrowser.tabs[0];
        const tab = ${reuseFirst && !entry.partitionKey ? 'initialTab' : 'gBrowser.addTab("about:blank", { triggeringPrincipal: principal, userContextId })'};
        registry[${JSON.stringify(entry.id)}] = tab;
        if (${reuseFirst && Boolean(entry.partitionKey)} && initialTab !== tab && !initialTab.closing) {
          gBrowser.removeTab(initialTab, { animate: false });
        }
        if (${entry.privateSession}) tab.linkedBrowser.docShell.usePrivateBrowsing = true;
        if (${entry.snapshot.visible}) gBrowser.selectedTab = tab;
        if (${entry.snapshot.url !== 'about:blank'}) {
          const previous = gBrowser.selectedTab;
          gBrowser.selectedTab = tab;
          openTrustedLinkIn(${JSON.stringify(entry.snapshot.url)}, 'current');
          if (!${entry.snapshot.visible}) gBrowser.selectedTab = previous;
        }
        return 'created';
      })()`,
    );
    entry.snapshot.isLoading = false;
    emit(entry);
  };
  const startPolling = (session: Session) => {
    if (session.poll) return;
    session.poll = window.setInterval(() => {
      const entry = [...session.surfaceIds]
        .map((id) => entries.get(id))
        .find((candidate) => candidate?.snapshot.visible);
      if (!entry || !session.ready) return;
      void chrome(
        session,
        tabScript(
          entry,
          `return {
            url: tab.linkedBrowser?.currentURI?.spec || '',
            title: tab.label || '',
            canGoBack: Boolean(tab.linkedBrowser?.webNavigation?.canGoBack),
            canGoForward: Boolean(tab.linkedBrowser?.webNavigation?.canGoForward),
            isAudioPlaying: Boolean(tab.soundPlaying),
            isMuted: Boolean(tab.muted),
            openRequests: (() => {
              const registry = globalThis.__nammuIntegrationTabs || Object.create(null);
              const known = new Set(Object.values(registry));
              const requests = [];
              for (const candidate of Array.from(gBrowser.tabs)) {
                if (known.has(candidate) || candidate.closing) continue;
                const target = candidate.linkedBrowser?.currentURI?.spec || '';
                if (target === 'about:blank') continue;
                requests.push(target);
                gBrowser.removeTab(candidate, { animate: false });
              }
              return requests;
            })()
          };`,
        ),
      )
        .then((value) => {
          if (!value || typeof value !== 'object') return;
          const state = value as Partial<WebSurfaceSnapshot>;
          if (
            typeof state.url === 'string' &&
            allowed(entry.policy, state.url, environment.getOrigin() ?? '')
          ) {
            entry.snapshot.url = state.url;
          }
          if (typeof state.title === 'string') entry.snapshot.title = state.title.slice(0, 512);
          if (typeof state.canGoBack === 'boolean') entry.snapshot.canGoBack = state.canGoBack;
          if (typeof state.canGoForward === 'boolean')
            entry.snapshot.canGoForward = state.canGoForward;
          if (typeof state.isAudioPlaying === 'boolean')
            entry.snapshot.isAudioPlaying = state.isAudioPlaying;
          if (typeof state.isMuted === 'boolean') entry.snapshot.isMuted = state.isMuted;
          if (Array.isArray((state as { openRequests?: unknown }).openRequests)) {
            for (const requestedUrl of (state as { openRequests: unknown[] }).openRequests) {
              if (
                typeof requestedUrl === 'string' &&
                allowed(entry.policy, requestedUrl, environment.getOrigin() ?? '')
              ) {
                openListeners.forEach((listener) =>
                  listener({ sourceId: entry.id, url: requestedUrl }),
                );
              }
            }
          }
          emit(entry);
        })
        .catch(() => undefined);
    }, 750);
  };

  const onMessage = (event: MessageEvent) => {
    const session = [...sessions.values()].find(
      (item) => item.iframe.contentWindow === event.source,
    );
    if (!session || event.origin !== environment.getOrigin()) return;
    if (event.data?.type === 'NAMMU_GECKO_READY') {
      session.ready = true;
      const sessionEntries = [...session.surfaceIds]
        .map((id) => entries.get(id))
        .filter(Boolean) as Entry[];
      void (async () => {
        const pendingPurges = integrationProfiles?.pendingIdentityPurges() ?? [];
        const pendingNamespaces = integrationProfiles?.pendingNamespacePurges() ?? [];
        if (pendingPurges.length || pendingNamespaces.length) {
          await purgeIdentities(session, pendingPurges, pendingNamespaces);
          integrationProfiles?.completeIdentityPurges(pendingPurges, pendingNamespaces);
        }
        for (const [index, entry] of sessionEntries.entries()) {
          if (entries.has(entry.snapshot.id)) await createTab(entry, index === 0);
        }
        if (session.temporaryCleanup) {
          runtimeFor(session)?.geckoDispose?.();
          session.iframe.remove();
          sessions.delete(session.key);
          session.cleanupReady?.();
          return;
        }
        startPolling(session);
        syncSessionVisibility(session);
      })().catch((error) => session.cleanupFailed?.(error instanceof Error ? error : new Error(String(error))));
    } else if (event.data?.type === 'NAMMU_GECKO_ERROR') {
      if (session.temporaryCleanup) {
        session.cleanupFailed?.(new Error('The Gecko profile-cleanup runtime failed to start.'));
      }
      session.surfaceIds.forEach((id) => {
        const entry = entries.get(id);
        if (entry) {
          entry.snapshot.isLoading = false;
          emit(entry);
        }
      });
    }
  };
  environment.getWindow()?.addEventListener('message', onMessage);

  integrationProfiles?.registerPurger(async (names, namespaces) => {
    const active = [...sessions.values()].find(
      (session) => session.ready && !session.temporaryCleanup,
    );
    if (active) {
      await purgeIdentities(active, names, namespaces);
      integrationProfiles.completeIdentityPurges(names, namespaces);
      return;
    }
    const id = crypto.randomUUID().replaceAll('-', '');
    const cleanup = createSession(`profile-cleanup-${id.slice(0, 24)}`, id, true, false);
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup.iframe.remove();
        sessions.delete(cleanup.key);
        reject(new Error('The Web integration-profile cleanup session timed out.'));
      }, 30_000);
      cleanup.cleanupReady = () => {
        window.clearTimeout(timer);
        resolve();
      };
      cleanup.cleanupFailed = (error) => {
        window.clearTimeout(timer);
        cleanup.iframe.remove();
        sessions.delete(cleanup.key);
        reject(error);
      };
      environment.getDocument()?.body.append(cleanup.iframe);
    });
  });

  const implementation: PlatformWebSurfaces = {
    supported,
    async create(options) {
      try {
        if (!supported) {
          return {
            status: 'unsupported',
            reason: 'Native child web surfaces are unavailable in the web runtime.',
          };
        }
        if (options.owner !== 'integration' || !options.navigationPolicy) {
          throw new Error('The Web Gecko surface requires a packaged integration policy.');
        }
        const documentObject = environment.getDocument();
        const origin = environment.getOrigin();
        if (!documentObject || !origin) throw new Error('The Web runtime is unavailable.');
        if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
          throw new Error('The Web integration runtime requires cross-origin isolation.');
        }
        if (!allowed(options.navigationPolicy, options.url, origin)) {
          throw new Error('The requested navigation is outside the packaged surface policy.');
        }
        if (entries.size >= 32) throw new Error('The Web integration surface limit was reached.');
        const id = crypto.randomUUID().replaceAll('-', '');
        let session = sessions.get(options.profileKey);
        if (!session) {
          session = createSession(options.profileKey, id);
        }
        const snapshot: WebSurfaceSnapshot = {
          id,
          owner: 'integration',
          url: options.url,
          title: '',
          isLoading: true,
          canGoBack: false,
          canGoForward: false,
          isAudioPlaying: false,
          isMuted: false,
          visible: options.visible,
        };
        const entry: Entry = {
          id,
          session,
          policy: options.navigationPolicy,
          bounds: options.bounds,
          privateSession: options.privateSession,
          partitionKey: options.partitionKey,
          snapshot,
        };
        entries.set(id, entry);
        session.surfaceIds.add(id);
        if (options.visible) {
          session.surfaceIds.forEach((otherId) => {
            const other = entries.get(otherId);
            if (other && other.id !== id) other.snapshot.visible = false;
          });
        }
        styleSession(session, options.bounds, options.visible);
        if (session.ready) await createTab(entry, false);
        return ok(snapshot);
      } catch (error) {
        return failure(error);
      }
    },
    async destroy(id) {
      try {
        const entry = entryFor(id);
        const { session } = entry;
        if (session.ready) {
          await chrome(
            session,
            tabScript(
              entry,
              `gBrowser.removeTab(tab, { animate: false });
               delete globalThis.__nammuIntegrationTabs[${JSON.stringify(id)}];
               return 'removed';`,
            ),
          ).catch(() => undefined);
        }
        entries.delete(id);
        session.surfaceIds.delete(id);
        session.surfaceProxies.delete(id);
        if (session.surfaceIds.size === 0) {
          if (session.poll) window.clearInterval(session.poll);
          runtimeFor(session)?.geckoDispose?.();
          session.iframe.remove();
          sessions.delete(session.key);
        } else {
          syncSessionVisibility(session);
        }
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },
    async navigate(id, url) {
      try {
        const entry = entryFor(id);
        if (!allowed(entry.policy, url, environment.getOrigin() ?? '')) {
          throw new Error('Navigation is outside the surface policy.');
        }
        entry.snapshot.url = url;
        entry.snapshot.isLoading = true;
        emit(entry);
        if (!entry.session.ready) return ok(undefined);
        await chrome(
          entry.session,
          tabScript(
            entry,
            `const previous = gBrowser.selectedTab;
             gBrowser.selectedTab = tab;
             openTrustedLinkIn(${JSON.stringify(url)}, 'current');
             if (!${entry.snapshot.visible}) gBrowser.selectedTab = previous;
             return 'navigated';`,
          ),
        );
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },
    async control(id, control, options) {
      try {
        const entry = entryFor(id);
        const commands: Record<WebSurfaceControl, string> = {
          reload: 'tab.linkedBrowser.reload();',
          stop: 'tab.linkedBrowser.stop();',
          'go-back': 'tab.linkedBrowser.goBack();',
          'go-forward': 'tab.linkedBrowser.goForward();',
          mute: 'tab.muted = true;',
          unmute: 'tab.muted = false;',
          find: `tab.linkedBrowser.finder.fastFind(${JSON.stringify(options?.query ?? '')}, false, false);`,
          'find-next': 'tab.linkedBrowser.finder.findAgain(false, false);',
          'find-previous': 'tab.linkedBrowser.finder.findAgain(true, false);',
          'clear-find': 'tab.linkedBrowser.finder.removeSelection();',
          print: 'PrintUtils.startPrintWindow(tab.linkedBrowser.browsingContext);',
          'save-page': 'saveBrowser(tab.linkedBrowser);',
          'enable-tracking-protection':
            "Services.prefs.setBoolPref('privacy.trackingprotection.enabled', true);",
          'disable-tracking-protection':
            "Services.prefs.setBoolPref('privacy.trackingprotection.enabled', false);",
          'block-autoplay': "Services.prefs.setIntPref('media.autoplay.default', 1);",
          'allow-autoplay': "Services.prefs.setIntPref('media.autoplay.default', 0);",
        };
        await chrome(entry.session, tabScript(entry, `${commands[control]} return 'controlled';`));
        if (control === 'mute' || control === 'unmute') {
          entry.snapshot.isMuted = control === 'mute';
          emit(entry);
        }
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },
    async setBounds(id, bounds) {
      try {
        const entry = entryFor(id);
        entry.bounds = bounds;
        if (entry.snapshot.visible) styleSession(entry.session, bounds, true);
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },
    async setVisible(id, visible) {
      try {
        const entry = entryFor(id);
        if (visible) {
          entry.session.surfaceIds.forEach((otherId) => {
            const other = entries.get(otherId);
            if (other) {
              other.snapshot.visible = other.id === id;
              emit(other);
            }
          });
        } else {
          entry.snapshot.visible = false;
          emit(entry);
        }
        syncSessionVisibility(entry.session);
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },
    async focus(id) {
      try {
        const entry = entryFor(id);
        if (entry.snapshot.visible) entry.session.iframe.contentWindow?.focus();
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },
    async setZoom(id, zoom) {
      try {
        const entry = entryFor(id);
        await chrome(
          entry.session,
          tabScript(
            entry,
            `gBrowser.selectedTab = tab; FullZoom.setZoom(${JSON.stringify(zoom)}); return 'zoomed';`,
          ),
        );
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },
    async setProxyRoute(id, scope, endpoints) {
      try {
        const entry = entryFor(id);
        if (scope === 'profile') entry.session.profileProxy = [...endpoints];
        else if (scope === 'surface') entry.session.surfaceProxies.set(id, [...endpoints]);
        else throw new Error('The proxy route scope is invalid.');
        if (entry.session.ready) await chrome(entry.session, proxyRoutingScript(entry.session));
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },
    async getState(id) {
      try {
        return ok({ ...entryFor(id).snapshot });
      } catch (error) {
        return failure(error);
      }
    },
    async subscribe(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    async subscribeOpenRequests(listener) {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
  };
  return Object.freeze(implementation);
}
