import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');
const tauriConfig = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const installerHooks = readFileSync(
  resolve(repositoryRoot, 'src-tauri', 'windows', 'installer-hooks.nsh'),
  'utf8',
);

function filesUnder(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : entry.isFile() ? [child] : [];
  });
}

describe('desktop release hardening', () => {
  test('uses a scoped CSP without weakening Gecko isolation', () => {
    const csp = tauriConfig.app.security.csp;

    expect(csp).toBeTruthy();
    expect(csp['default-src']).toBe("'self'");
    expect(csp['script-src']).toContain("'wasm-unsafe-eval'");
    expect(csp['script-src']).toContain('blob:');
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
    expect(csp['connect-src']).toContain('data:');
    expect(csp['connect-src']).toContain('http://127.0.0.1:*');
    expect(csp['connect-src']).toContain('ws://127.0.0.1:*');
    expect(csp['connect-src']).not.toContain('localhost:*');
    expect(csp['connect-src']).not.toContain('*://*');
    expect(csp['frame-ancestors']).toBe("'self'");
    expect(csp['worker-src']).toContain('blob:');
    expect(tauriConfig.app.security.headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(tauriConfig.app.security.headers['Cross-Origin-Embedder-Policy']).toBe('credentialless');
  });

  test('keeps the Windows installer current-user and loopback bootstrapper based', () => {
    expect(tauriConfig.bundle.windows.nsis.installMode).toBe('currentUser');
    expect(tauriConfig.bundle.windows.nsis.installerHooks).toBe('windows/installer-hooks.nsh');
    expect(tauriConfig.bundle.windows.webviewInstallMode).toEqual({
      type: 'downloadBootstrapper',
      silent: true,
    });
    expect(installerHooks).toContain('NSIS_HOOK_PREINSTALL');
    expect(installerHooks).toContain('NSIS_HOOK_PREUNINSTALL');
    expect(installerHooks).toContain('RMDir /r "$INSTDIR\\resources\\local-server"');
    expect(installerHooks).not.toContain('com.nammu.os');
  });

  test('keeps Google Desktop client metadata outside React and platform code', () => {
    const frontendFiles = [
      ...filesUnder(resolve(repositoryRoot, 'src', 'components')),
      ...filesUnder(resolve(repositoryRoot, 'src', 'platform')),
      ...filesUnder(resolve(repositoryRoot, 'desktop')),
    ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs)$/.test(path));
    const frontendSource = frontendFiles.map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(frontendSource).not.toContain('GOOGLE_DESKTOP_CLIENT_SECRET');
    expect(frontendSource).not.toContain('googleDesktopClientSecret');
  });
});
