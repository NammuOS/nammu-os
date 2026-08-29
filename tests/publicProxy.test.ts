import { describe, expect, test } from 'bun:test';
import { buildConfigureGeckoProxyScript } from '../src/components/browser/services/publicProxy';
import { publicProxyServiceInternals } from '../src/server/browser/publicProxyService';

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

  test('builds a channel-aware Gecko route with failover support', () => {
    const endpoint = {
      id: 'socks5:8.8.8.8:1080',
      host: '8.8.8.8',
      port: 1080,
      protocol: 'socks5' as const,
      country: 'United States',
      countryCode: 'US',
      city: 'Unknown',
      anonymity: 'elite' as const,
      source: 'ProxyScrape' as const,
      sourceLatencyMs: 100,
      uptimePercent: 99,
      lastCheckedAt: null,
    };
    const script = buildConfigureGeckoProxyScript({
      browser: [endpoint],
      tabs: { 'tab-1': [endpoint] },
    });

    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('registerChannelFilter');
    expect(script).toContain('unregisterChannelFilter');
    expect(script).toContain('newProxyInfo');
    expect(script).toContain('__nammuBrowserTabs');
    expect(script).toContain('topLevelPrincipal');
    expect(script).toContain('contentPrincipal');
    expect(script).toContain('failover');
    expect(script).toContain('net:prune-all-connections');
    expect(script).toContain('__nammuPublicProxyRevision');
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
