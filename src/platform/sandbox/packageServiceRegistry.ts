import type { PlatformCapabilities } from '../contracts';
import {
  PACKAGE_SERVICE_RESPONSE_LIMIT_BYTES,
  type PackageServiceResponse,
} from './integrationContracts';

type ServiceHandler = (payload: unknown) => Promise<PackageServiceResponse>;

const BROWSER_SEARCH_QUERY_LIMIT = 512;
const PUBLIC_PROXY_ID_LIMIT = 20;
const publicProxyProtocols = new Set(['http', 'https', 'socks4', 'socks5']);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The packaged service request is invalid.');
  }
  return value as Record<string, unknown>;
}

function optionalString(
  value: unknown,
  options: { maxLength: number; pattern?: RegExp } = { maxLength: 256 },
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > options.maxLength ||
    (options.pattern && !options.pattern.test(value))
  ) {
    throw new Error('The packaged service request is invalid.');
  }
  return value;
}

async function requestJson(
  platform: PlatformCapabilities,
  path: string,
  init?: RequestInit,
): Promise<PackageServiceResponse> {
  const response = await platform.services.request(path, init);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('The Nammu service returned an invalid response.');
  }
  return { status: response.status, data };
}

function serializedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
}

/**
 * Core-owned, deny-by-default service catalog for packaged apps.
 * Entries expose named operations, never URLs, headers, credentials, or raw fetch.
 */
export function createPackageServiceRegistry(platform: PlatformCapabilities) {
  const services = new Map<string, Map<string, ServiceHandler>>([
    [
      'core.runtime',
      new Map([
        [
          'describe',
          async () => ({
            status: 200,
            data: { runtime: platform.runtime, webSurfaces: platform.webSurfaces.supported },
          }),
        ],
      ]),
    ],
    [
      'browser.search',
      new Map([
        [
          'suggest',
          async (payload) => {
            const query = optionalString(record(payload).query, {
              maxLength: BROWSER_SEARCH_QUERY_LIMIT,
            });
            return requestJson(platform, `/api/browser/search?q=${encodeURIComponent(query!)}`);
          },
        ],
      ]),
    ],
    [
      'browser.public-proxies',
      new Map([
        [
          'discover',
          async (payload) => {
            const input = record(payload);
            const params = new URLSearchParams();
            const protocol = optionalString(input.protocol, { maxLength: 6 });
            if (protocol) {
              if (!publicProxyProtocols.has(protocol)) {
                throw new Error('The packaged service request is invalid.');
              }
              params.set('protocol', protocol);
            }
            const country = optionalString(input.country, {
              maxLength: 2,
              pattern: /^[A-Za-z]{2}$/,
            });
            if (country) params.set('country', country.toUpperCase());
            const limit = input.limit === undefined ? 100 : Number(input.limit);
            if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
              throw new Error('The packaged service request is invalid.');
            }
            params.set('limit', String(limit));
            if (input.refresh === true) params.set('refresh', '1');
            return requestJson(platform, `/api/browser/public-proxies?${params}`);
          },
        ],
        [
          'check',
          async (payload) => {
            const input = record(payload);
            if (
              !Array.isArray(input.ids) ||
              input.ids.length === 0 ||
              input.ids.length > PUBLIC_PROXY_ID_LIMIT ||
              !input.ids.every(
                (id) => typeof id === 'string' && id.length > 0 && id.length <= 256,
              )
            ) {
              throw new Error('The packaged service request is invalid.');
            }
            const targetUrl = optionalString(input.targetUrl, { maxLength: 2_048 });
            if (targetUrl) {
              const parsed = new URL(targetUrl);
              if (parsed.protocol !== 'https:' || parsed.origin !== targetUrl) {
                throw new Error('The packaged service request is invalid.');
              }
            }
            return requestJson(platform, '/api/browser/public-proxies/check', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: input.ids, ...(targetUrl ? { targetUrl } : {}) }),
            });
          },
        ],
      ]),
    ],
  ]);

  return Object.freeze({
    async request(service: string, operation: string, payload: unknown) {
      if (serializedSize(payload) > 256 * 1024) {
        throw new Error('The packaged service request exceeds the 256 KiB limit.');
      }
      const handler = services.get(service)?.get(operation);
      if (!handler) throw new Error('The requested packaged service operation is unavailable.');
      const response = await handler(payload);
      if (serializedSize(response.data) > PACKAGE_SERVICE_RESPONSE_LIMIT_BYTES) {
        throw new Error('The packaged service response exceeds the 4 MiB limit.');
      }
      return response;
    },
  });
}

export type PackageServiceRegistry = ReturnType<typeof createPackageServiceRegistry>;
