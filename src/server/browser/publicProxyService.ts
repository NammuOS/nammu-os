import { isIP } from 'node:net';
import net from 'node:net';
import tls from 'node:tls';
import type {
  PublicProxyAnonymity,
  PublicProxyEndpoint,
  PublicProxyHealth,
  PublicProxyProtocol,
} from './publicProxyTypes';

const SOURCE_CACHE_MS = 5 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 10_000;
const CHECK_TIMEOUT_MS = 6_000;
const MAX_DISCOVERED_PROXIES = 800;
const MAX_CHECK_BATCH = 20;
const TLS_TEST_HOST = 'speed.cloudflare.com';
const PROBE_BYTES = 128 * 1024;
const MINIMUM_PROBE_BYTES = 64 * 1024;
const MINIMUM_TARGET_BYTES = 1;

const PROXY_SOURCES = [
  {
    name: 'ProxyScrape' as const,
    url: 'https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/all/data.json',
  },
  {
    name: 'Proxifly' as const,
    url: 'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/all/data.json',
  },
];

type SourceName = (typeof PROXY_SOURCES)[number]['name'];
type UnknownRecord = Record<string, unknown>;

let discoveryCache: { expiresAt: number; proxies: PublicProxyEndpoint[] } | null = null;

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAnonymity(value: unknown): PublicProxyAnonymity {
  const anonymity = String(value || '').toLowerCase();
  if (anonymity === 'elite' || anonymity === 'anonymous' || anonymity === 'transparent') {
    return anonymity;
  }
  return 'unknown';
}

function isPublicIpv4(host: string) {
  if (isIP(host) !== 4) return false;
  const [a, b, c] = host.split('.').map(Number);

  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function proxyId(protocol: PublicProxyProtocol, host: string, port: number) {
  return `${protocol}:${host}:${port}`;
}

function normalizeProtocol(record: UnknownRecord): PublicProxyProtocol | null {
  const protocol = String(record.protocol || '').toLowerCase();
  if (protocol === 'socks4' || protocol === 'socks5' || protocol === 'https') return protocol;
  if (protocol !== 'http') return null;

  // ProxyScrape represents CONNECT-capable HTTPS entries as protocol=http + ssl=true.
  return record.ssl === true || record.https === true ? 'https' : 'http';
}

function normalizeSourceRecord(
  record: UnknownRecord,
  source: SourceName,
): PublicProxyEndpoint | null {
  const protocol = normalizeProtocol(record);
  const host = String(record.ip || '').trim();
  const port = finiteNumber(record.port);
  if (!protocol || !isPublicIpv4(host) || port === null || port < 1 || port > 65_535) {
    return null;
  }

  const geolocation =
    record.geolocation && typeof record.geolocation === 'object'
      ? (record.geolocation as UnknownRecord)
      : null;
  const countryCode = String(record.country_code || geolocation?.country || 'ZZ').toUpperCase();
  const lastChecked = finiteNumber(record.last_checked);

  return {
    id: proxyId(protocol, host, port),
    host,
    port,
    protocol,
    country: String(record.country || countryCode || 'Unknown'),
    countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : 'ZZ',
    city: String(record.city || geolocation?.city || 'Unknown'),
    anonymity: normalizeAnonymity(record.anonymity),
    source,
    sourceLatencyMs: finiteNumber(record.latency_ms),
    uptimePercent: finiteNumber(record.uptime_percent),
    lastCheckedAt: lastChecked ? new Date(lastChecked * 1000).toISOString() : null,
  };
}

async function fetchSource(source: (typeof PROXY_SOURCES)[number]) {
  const response = await fetch(source.url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${source.name} returned ${response.status}`);

  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error(`${source.name} returned an invalid proxy list`);
  return body
    .map((record) =>
      record && typeof record === 'object'
        ? normalizeSourceRecord(record as UnknownRecord, source.name)
        : null,
    )
    .filter((proxy): proxy is PublicProxyEndpoint => proxy !== null);
}

export async function getDiscoveredPublicProxies(options?: { refresh?: boolean }) {
  const now = Date.now();
  if (!options?.refresh && discoveryCache && discoveryCache.expiresAt > now) {
    return discoveryCache.proxies;
  }

  const settled = await Promise.allSettled(PROXY_SOURCES.map(fetchSource));
  const successful = settled.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  );
  if (successful.length === 0) {
    const reason = settled
      .map((result) => (result.status === 'rejected' ? String(result.reason) : ''))
      .filter(Boolean)
      .join('; ');
    throw new Error(reason || 'No public proxy source is currently available.');
  }

  const deduplicated = new Map<string, PublicProxyEndpoint>();
  for (const proxy of successful) {
    const existing = deduplicated.get(proxy.id);
    if (!existing || (proxy.uptimePercent || 0) > (existing.uptimePercent || 0)) {
      deduplicated.set(proxy.id, proxy);
    }
  }

  const proxies = [...deduplicated.values()]
    .sort((a, b) => {
      const uptime = (b.uptimePercent || 0) - (a.uptimePercent || 0);
      if (uptime !== 0) return uptime;
      return (
        (a.sourceLatencyMs ?? Number.MAX_SAFE_INTEGER) -
        (b.sourceLatencyMs ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .slice(0, MAX_DISCOVERED_PROXIES);

  discoveryCache = { expiresAt: now + SOURCE_CACHE_MS, proxies };
  return proxies;
}

interface ProbeTarget {
  host: string;
  minimumBytes: number;
  requireSuccessfulStatus: boolean;
}

const DEFAULT_PROBE_TARGET: ProbeTarget = {
  host: TLS_TEST_HOST,
  minimumBytes: MINIMUM_PROBE_BYTES,
  requireSuccessfulStatus: true,
};

function getSiteProbeTarget(targetUrl?: string): ProbeTarget | null {
  if (!targetUrl) return null;
  try {
    const url = new URL(targetUrl);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      (url.port && url.port !== '443') ||
      !host ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      isIP(host) !== 0
    ) {
      return null;
    }
    return { host, minimumBytes: MINIMUM_TARGET_BYTES, requireSuccessfulStatus: true };
  } catch {
    return null;
  }
}

function socketCheck(
  proxy: PublicProxyEndpoint,
  target: ProbeTarget = DEFAULT_PROBE_TARGET,
): Promise<PublicProxyHealth> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host: proxy.host, port: proxy.port });
    let activeSocket: net.Socket = socket;
    let finished = false;
    let socksStage = 0;

    const finish = (alive: boolean, error?: string) => {
      if (finished) return;
      finished = true;
      activeSocket.destroy();
      resolve({
        ...proxy,
        alive,
        latencyMs: alive ? Date.now() - startedAt : null,
        checkedAt: new Date().toISOString(),
        ...(error ? { error } : {}),
      });
    };

    socket.setTimeout(CHECK_TIMEOUT_MS);
    socket.once('timeout', () => finish(false, 'Timed out'));
    socket.once('error', () => finish(false, 'Connection failed'));

    const verifyTrustedTlsTunnel = () => {
      socket.removeAllListeners('data');
      let responseBuffer = Buffer.alloc(0);
      let responseAccepted = false;
      let downloadedBytes = 0;
      const secureSocket = tls.connect({
        socket,
        servername: target.host,
        rejectUnauthorized: true,
        ALPNProtocols: ['http/1.1'],
      });
      activeSocket = secureSocket;
      secureSocket.setTimeout(CHECK_TIMEOUT_MS);
      secureSocket.once('timeout', () => finish(false, 'TLS validation timed out'));
      secureSocket.once('error', () => finish(false, 'TLS certificate validation failed'));
      secureSocket.once('secureConnect', () => {
        if (!secureSocket.authorized) {
          finish(false, 'TLS certificate validation failed');
          return;
        }
        secureSocket.write(
          target === DEFAULT_PROBE_TARGET
            ? `GET /__down?bytes=${PROBE_BYTES} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\nAccept: application/octet-stream\r\n\r\n`
            : `GET / HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\nAccept: text/html,*/*\r\nUser-Agent: Mozilla/5.0\r\n\r\n`,
        );
      });
      secureSocket.on('data', (chunk: Buffer) => {
        if (responseAccepted) {
          downloadedBytes += chunk.length;
        } else {
          responseBuffer = Buffer.concat([responseBuffer, chunk]);
          const headerEnd = responseBuffer.indexOf('\r\n\r\n');
          if (headerEnd === -1) {
            if (responseBuffer.length > 16 * 1024) finish(false, 'Invalid HTTPS response');
            return;
          }
          const status = responseBuffer
            .subarray(0, headerEnd)
            .toString('latin1')
            .match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
          const statusCode = status ? Number(status[1]) : 0;
          if (
            !status ||
            (target.requireSuccessfulStatus && (statusCode < 200 || statusCode >= 400))
          ) {
            finish(false, 'Target website rejected this proxy');
            return;
          }
          if (target !== DEFAULT_PROBE_TARGET && statusCode >= 300) {
            finish(true);
            return;
          }
          responseAccepted = true;
          downloadedBytes = responseBuffer.length - headerEnd - 4;
          responseBuffer = Buffer.alloc(0);
        }

        if (downloadedBytes >= target.minimumBytes) finish(true);
      });
    };

    socket.once('connect', () => {
      if (proxy.protocol === 'http' || proxy.protocol === 'https') {
        socket.write(
          `CONNECT ${target.host}:443 HTTP/1.1\r\nHost: ${target.host}:443\r\nProxy-Connection: keep-alive\r\n\r\n`,
        );
      } else if (proxy.protocol === 'socks4') {
        // SOCKS4a keeps DNS resolution on the proxy side.
        socket.write(
          Buffer.concat([
            Buffer.from([0x04, 0x01, 0x01, 0xbb, 0x00, 0x00, 0x00, 0x01, 0x00]),
            Buffer.from(`${target.host}\0`),
          ]),
        );
      } else {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      }
    });

    socket.on('data', (data) => {
      if (proxy.protocol === 'http' || proxy.protocol === 'https') {
        const statusMatch = data.toString('latin1').match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
        if (!statusMatch) return;
        const status = Number(statusMatch[1]);
        if (status !== 200) finish(false, 'Secure tunnel rejected');
        else verifyTrustedTlsTunnel();
        return;
      }

      if (proxy.protocol === 'socks4') {
        if (data.length >= 2) {
          if (data[1] === 0x5a) verifyTrustedTlsTunnel();
          else finish(false, 'SOCKS4 rejected');
        }
        return;
      }

      if (socksStage === 0 && data.length >= 2) {
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          finish(false, 'SOCKS5 authentication rejected');
          return;
        }
        socksStage = 1;
        const host = Buffer.from(target.host);
        socket.write(
          Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
            host,
            Buffer.from([0x01, 0xbb]),
          ]),
        );
      } else if (socksStage === 1 && data.length >= 2) {
        if (data[0] === 0x05 && data[1] === 0x00) verifyTrustedTlsTunnel();
        else finish(false, 'SOCKS5 rejected');
      }
    });
  });
}

export async function checkDiscoveredPublicProxies(ids: string[], targetUrl?: string) {
  const uniqueIds = [...new Set(ids)].slice(0, MAX_CHECK_BATCH);
  const discovered = await getDiscoveredPublicProxies();
  const allowlist = new Map(discovered.map((proxy) => [proxy.id, proxy]));
  const targets = uniqueIds.map((id) => allowlist.get(id)).filter(Boolean) as PublicProxyEndpoint[];
  const baseline = await Promise.all(targets.map((proxy) => socketCheck(proxy)));
  const siteTarget = getSiteProbeTarget(targetUrl);
  if (!siteTarget || siteTarget.host === TLS_TEST_HOST) return baseline;

  return Promise.all(
    baseline.map((health) =>
      health.alive ? socketCheck(health, siteTarget) : Promise.resolve(health),
    ),
  );
}

export const publicProxyServiceInternals = {
  isPublicIpv4,
  normalizeSourceRecord,
  proxyId,
  getSiteProbeTarget,
};
