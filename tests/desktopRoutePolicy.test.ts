import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  classifyDesktopRoute,
  desktopRoutePolicy,
  DesktopRouteClass,
  DesktopRouteExecution,
} from '../src/server/runtime/desktopRoutePolicy.mjs';

const routeSamples: Readonly<Record<string, string>> = {
  health: '/api/health',
  preferences: '/api/preferences',
  history: '/api/history',
  settings: '/api/settings',
  allocation: '/api/allocation',
  'allocation-config': '/api/allocation/config',
  'allocation-stats': '/api/allocation/stats',
  'google-accounts': '/api/accounts',
  'account-item': '/api/accounts/account-id',
  'account-connect': '/api/accounts/account-id/connect',
  'account-callback': '/api/accounts/account-id/callback',
  'account-status': '/api/accounts/account-id/status',
  'google-files': '/api/files',
  'google-file-bulk-delete': '/api/files/bulk/delete',
  'google-file-folder': '/api/files/folders',
  'google-empty-trash': '/api/files/trash/empty',
  'file-download': '/api/files/file-id/download',
  'file-preview': '/api/files/file-id/preview',
  'file-item': '/api/files/file-id',
  'file-action': '/api/files/file-id/star',
  'google-upload-initiate': '/api/uploads/initiate',
  'upload-stream': '/api/uploads/upload-id/stream',
  sync: '/api/sync',
  'google-sync': '/api/sync/run',
  'maps-search': '/api/maps/search',
  'maps-location': '/api/maps/location',
  'browser-search': '/api/browser/search',
  'browser-public-proxies': '/api/browser/public-proxies',
  'browser-public-proxy-check': '/api/browser/public-proxies/check',
  'browser-wisp-endpoint': '/api/browser/wisp-endpoint',
  'browser-arbitrary-proxy': '/api/browser/proxy',
  'music-lyrics': '/api/music/lyrics',
  'music-sponsorblock': '/api/music/sponsorblock',
  'subdomain-inspector': '/api/tools/subdomains',
  'official-store-package': '/api/app-store/packages/os.nammu.notes/1.0.0',
  trpc: '/api/trpc/example.query',
};

describe('desktop route policy', () => {
  test('requires every current Next API handler to have an explicit policy entry', () => {
    const apiRoot = join(process.cwd(), 'src', 'app', 'api');
    const routeFiles: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        if (entry.isFile() && entry.name === 'route.ts') routeFiles.push(path);
      }
    };
    walk(apiRoot);

    const reviewed = routeFiles.map((file) => {
      const segments = relative(apiRoot, file)
        .split(sep)
        .slice(0, -1)
        .map((segment) =>
          segment.startsWith('[') && segment.endsWith(']')
            ? `sample-${segment.slice(1, -1).replaceAll('.', '-')}`
            : segment,
        );
      return classifyDesktopRoute(`/api/${segments.join('/')}`)?.id ?? null;
    });

    expect(reviewed).not.toContain(null);
    expect(new Set(reviewed).size).toBe(routeFiles.length);
    expect(desktopRoutePolicy.length).toBeGreaterThanOrEqual(routeFiles.length);
  });

  test('classifies every reviewed route without generic-pattern shadowing', () => {
    for (const [expectedId, sample] of Object.entries(routeSamples)) {
      expect(classifyDesktopRoute(sample)?.id).toBe(expectedId);
    }
  });

  test('defaults to deny and keeps the arbitrary proxy explicitly disabled', () => {
    expect(classifyDesktopRoute('/api/new-unreviewed-route')).toBeNull();
    const proxy = classifyDesktopRoute('/api/browser/proxy');
    expect(proxy?.classification).toBe(DesktopRouteClass.DISABLED_DESKTOP);
    expect(proxy?.enabled).toBe(false);
    expect(classifyDesktopRoute('/api/accounts/google_drive/connect')?.enabled).toBe(true);
    for (const provider of ['onedrive', 'dropbox', 'yandex', 'mega', 'pcloud', 's3']) {
      const connect = classifyDesktopRoute(`/api/accounts/${provider}/connect`);
      expect(connect?.classification).toBe(DesktopRouteClass.DISABLED_DESKTOP);
      expect(connect?.enabled).toBe(false);
    }
    expect(classifyDesktopRoute('/api/accounts/google_drive/callback')?.enabled).toBe(false);
  });

  test('enables only local settings and explicitly reviewed stateless service routes', () => {
    expect(desktopRoutePolicy.filter((entry) => entry.enabled).map((entry) => entry.id)).toEqual([
      'health',
      'preferences',
      'history',
      'settings',
      'allocation',
      'google-accounts',
      'google-account-item',
      'google-account-connect',
      'google-account-status',
      'google-files',
      'google-file-bulk-delete',
      'google-file-folder',
      'google-empty-trash',
      'google-file-download',
      'google-file-preview',
      'google-file-item',
      'google-file-action',
      'google-upload-initiate',
      'google-upload-stream',
      'google-sync',
      'maps-search',
      'maps-location',
      'browser-search',
      'browser-public-proxies',
      'browser-public-proxy-check',
      'music-lyrics',
      'music-sponsorblock',
      'subdomain-inspector',
      'official-store-package',
    ]);
    expect(
      desktopRoutePolicy.filter((entry) => entry.enabled).every((entry) => entry.execution),
    ).toBe(true);
    expect(classifyDesktopRoute('/api/maps/search')?.execution).toBe(DesktopRouteExecution.NEXT);
    expect(classifyDesktopRoute('/api/preferences')?.execution).toBe(DesktopRouteExecution.LOCAL);
    expect(classifyDesktopRoute('/api/app-store/packages/evil%2Fid/1.0.0')).toBeNull();
  });
});
