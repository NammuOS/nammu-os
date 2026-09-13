import { describe, expect, test } from 'bun:test';
import { publicProxyServiceInternals } from '../src/server/browser/publicProxyService';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('public proxy manager', () => {
  test('only allows public IPv4 endpoints into the health checker allowlist', () => {
    expect(publicProxyServiceInternals.isPublicIpv4('8.8.8.8')).toBe(true);
    expect(publicProxyServiceInternals.isPublicIpv4('127.0.0.1')).toBe(false);
    expect(publicProxyServiceInternals.isPublicIpv4('10.0.0.8')).toBe(false);
    expect(publicProxyServiceInternals.isPublicIpv4('169.254.169.254')).toBe(false);
    expect(publicProxyServiceInternals.isPublicIpv4('192.168.1.10')).toBe(false);
    expect(publicProxyServiceInternals.isPublicIpv4('::1')).toBe(false);
  });

  test('normalizes CONNECT-capable HTTP records as HTTPS proxies', () => {
    const proxy = publicProxyServiceInternals.normalizeSourceRecord(
      {
        protocol: 'http',
        ip: '8.8.4.4',
        port: 8080,
        ssl: true,
        anonymity: 'elite',
        country_code: 'US',
      },
      'ProxyScrape',
    );

    expect(proxy?.protocol).toBe('https');
    expect(proxy?.id).toBe('https:8.8.4.4:8080');
  });

  test('keeps Gecko proxy authority in the generic Core web-surface driver', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/platform/web/geckoWebSurfaces.ts'),
      'utf8',
    );
    expect(source).toContain('registerChannelFilter');
    expect(source).toContain('newProxyInfo');
    expect(source).toContain('__nammuIntegrationTabs');
    expect(source).toContain('net:prune-all-connections');
  });

  test('only accepts safe HTTPS hostnames for website-specific checks', () => {
    expect(
      publicProxyServiceInternals.getSiteProbeTarget('https://www.tiktok.com/video/123')?.host,
    ).toBe('www.tiktok.com');
    expect(publicProxyServiceInternals.getSiteProbeTarget('http://www.tiktok.com')).toBeNull();
    expect(publicProxyServiceInternals.getSiteProbeTarget('https://127.0.0.1')).toBeNull();
    expect(publicProxyServiceInternals.getSiteProbeTarget('https://router.local')).toBeNull();
  });
});
