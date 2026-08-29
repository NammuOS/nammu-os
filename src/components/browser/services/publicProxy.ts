export type PublicProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5';

export type PublicProxyAnonymity = 'elite' | 'anonymous' | 'transparent' | 'unknown';

export interface PublicProxyEndpoint {
  id: string;
  host: string;
  port: number;
  protocol: PublicProxyProtocol;
  country: string;
  countryCode: string;
  city: string;
  anonymity: PublicProxyAnonymity;
  source: 'ProxyScrape' | 'Proxifly';
  sourceLatencyMs: number | null;
  uptimePercent: number | null;
  lastCheckedAt: string | null;
}

export interface PublicProxyHealth extends PublicProxyEndpoint {
  alive: boolean;
  latencyMs: number | null;
  checkedAt: string;
  error?: string;
}

export interface PublicProxyConnection {
  scope: 'browser' | 'tab';
  tabId?: string;
  primary: PublicProxyHealth;
  failovers: PublicProxyHealth[];
  connectedAt: string;
}

export const PUBLIC_PROXY_NOTICE =
  'Public proxies are untrusted third-party servers, not a VPN. Never use them for passwords, banking, email, private messages, payments, or any signed-in account.';

export function formatProxyEndpoint(proxy: Pick<PublicProxyEndpoint, 'host' | 'port'>) {
  return `${proxy.host}:${proxy.port}`;
}

type GeckoProxyRouting = {
  browser: PublicProxyEndpoint[] | null;
  tabs: Record<string, PublicProxyEndpoint[]>;
};

/**
 * Installs one Gecko channel filter for the whole Nammu Browser session. The
 * routing data can be replaced without registering duplicate filters.
 */
export function buildConfigureGeckoProxyScript(routing: GeckoProxyRouting) {
  return `(()=>{
    const routing = ${JSON.stringify(routing)};
    const filterVersion = 2;
    globalThis.__nammuPublicProxyRouting = routing;
    globalThis.__nammuPublicProxyRevision = (globalThis.__nammuPublicProxyRevision || 0) + 1;
    const proxyService = Cc['@mozilla.org/network/protocol-proxy-service;1']
      .getService(Ci.nsIProtocolProxyService);

    if (globalThis.__nammuPublicProxyFilter &&
        globalThis.__nammuPublicProxyFilterVersion !== filterVersion) {
      try { proxyService.unregisterChannelFilter(globalThis.__nammuPublicProxyFilter); } catch (_) {}
      globalThis.__nammuPublicProxyFilter = null;
    }

    if (!globalThis.__nammuPublicProxyFilter) {
      const toProxyChain = (route, isolationKey) => {
        if (!Array.isArray(route) || route.length === 0) return null;
        return route.reduceRight((failover, endpoint) => {
          const type = endpoint.protocol === 'socks5'
            ? 'socks'
            : endpoint.protocol === 'socks4'
              ? 'socks4'
              : 'http';
          const resolvesHost = type === 'socks' || type === 'socks4'
            ? Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST
            : 0;
          const alwaysTunnel = endpoint.protocol === 'https'
            ? Ci.nsIProxyInfo.ALWAYS_TUNNEL_VIA_PROXY
            : 0;
          return proxyService.newProxyInfo(
            type,
            endpoint.host,
            endpoint.port,
            '',
            isolationKey,
            resolvesHost | alwaysTunnel,
            4,
            failover,
          );
        }, null);
      };

      const findTabId = (channel) => {
        const topContext = channel.loadInfo?.browsingContext?.top;
        const registry = globalThis.__nammuBrowserTabs || Object.create(null);
        if (topContext) {
          for (const [tabId, tab] of Object.entries(registry)) {
            if (tab?.linkedBrowser?.browsingContext === topContext) return tabId;
          }
        }

        // Worker and service-worker channels often have no browsing context.
        // Match their loading/top-level principal back to the owning tab so a
        // tab-scoped route cannot leak part of a site through the direct IP.
        const loadInfo = channel.loadInfo;
        const requestPrincipal = loadInfo?.topLevelPrincipal ||
          loadInfo?.loadingPrincipal || loadInfo?.triggeringPrincipal;
        const requestOrigin = requestPrincipal?.originNoSuffix;
        if (requestOrigin && !requestPrincipal?.isSystemPrincipal) {
          for (const [tabId, tab] of Object.entries(registry)) {
            const tabOrigin = tab?.linkedBrowser?.contentPrincipal?.originNoSuffix;
            if (tabOrigin === requestOrigin) return tabId;
          }
        }
        return null;
      };

      globalThis.__nammuPublicProxyFilter = {
        QueryInterface: ChromeUtils.generateQI(['nsIProtocolProxyChannelFilter']),
        applyFilter(channel, defaultProxyInfo, result) {
          try {
            const scheme = channel.URI?.scheme;
            if (scheme !== 'http' && scheme !== 'https') {
              result.onProxyFilterResult(defaultProxyInfo);
              return;
            }

            const tabId = findTabId(channel);
            const current = globalThis.__nammuPublicProxyRouting || { browser: null, tabs: {} };
            const route = (tabId && current.tabs?.[tabId]) || current.browser;
            if (!route?.length) {
              result.onProxyFilterResult(defaultProxyInfo);
              return;
            }

            // Do not send Gecko maintenance traffic through an untrusted public proxy.
            const principal = channel.loadInfo?.triggeringPrincipal;
            if (!tabId && principal?.isSystemPrincipal) {
              result.onProxyFilterResult(defaultProxyInfo);
              return;
            }

            const isolationKey = 'nammu-public-' + (tabId || 'browser') + '-' +
              globalThis.__nammuPublicProxyRevision;
            result.onProxyFilterResult(toProxyChain(route, isolationKey));
          } catch (_) {
            result.onProxyFilterResult(defaultProxyInfo);
          }
        },
      };
      proxyService.registerChannelFilter(globalThis.__nammuPublicProxyFilter, 0);
      globalThis.__nammuPublicProxyFilterVersion = filterVersion;
    }

    // A route change must not reuse sockets or DNS answers created through the
    // previous proxy. Firefox will establish clean connections on the reload.
    try { Services.obs.notifyObservers(null, 'net:prune-all-connections'); } catch (_) {}
    try { Services.dns.clearCache(true); } catch (_) {}
    try { proxyService.notifyProxyConfigChangedInternal(); } catch (_) {}

    return JSON.stringify({
      browser: routing.browser?.length || 0,
      tabs: Object.keys(routing.tabs || {}).length,
    });
  })()`;
}
