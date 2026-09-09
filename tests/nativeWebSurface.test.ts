import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformCapabilities } from '../src/platform';
import { createTauriWebSurfaces, type TauriWebSurfaceEnvironment } from '../src/platform/tauri';
import { createBrowserWebSurface } from '../src/web-surfaces';

const repositoryRoot = join(import.meta.dir, '..');

const snapshot = {
  id: 'a'.repeat(32),
  owner: 'browser' as const,
  url: 'https://example.com/',
  title: 'Example',
  isLoading: false,
  canGoBack: true,
  canGoForward: false,
  isAudioPlaying: false,
  isMuted: false,
  visible: true,
};

describe('native web-surface boundary', () => {
  test('keeps the web runtime deterministic and unsupported', async () => {
    const surfaces = getPlatformCapabilities('web').webSurfaces;
    expect(surfaces.supported).toBe(false);
    expect(
      await surfaces.create({
        owner: 'browser',
        profileKey: 'default',
        privateSession: false,
        url: 'https://example.com/',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: true,
      }),
    ).toEqual({
      status: 'unsupported',
      reason: 'Native child web surfaces are unavailable in the web runtime.',
    });
  });

  test('exposes only the narrow typed command set to the trusted shell', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const environment: TauriWebSurfaceEnvironment = {
      async invoke<T>(command: string, args?: Record<string, unknown>) {
        calls.push({ command, args });
        return (
          command === 'create_web_surface' || command === 'get_web_surface_state'
            ? snapshot
            : undefined
        ) as T;
      },
      async listen() {
        return () => {};
      },
    };
    const surfaces = createTauriWebSurfaces(environment);
    const { surface } = await createBrowserWebSurface(surfaces, {
      url: snapshot.url,
      bounds: { x: 40, y: 80, width: 900, height: 600 },
      visible: false,
    });
    await surface.navigate('https://www.wikipedia.org/');
    await surface.control('go-back');
    await surface.control('mute');
    await surface.control('unmute');
    await surface.setBounds({ x: 45, y: 85, width: 860, height: 570 });
    await surface.setVisible(true);
    await surface.focus();
    await surface.setZoom(1.25);
    expect(await surface.getState()).toEqual(snapshot);
    await surface.destroy();

    expect(calls.map(({ command }) => command)).toEqual([
      'create_web_surface',
      'navigate_web_surface',
      'control_web_surface',
      'control_web_surface',
      'control_web_surface',
      'set_web_surface_bounds',
      'set_web_surface_visibility',
      'focus_web_surface',
      'set_web_surface_zoom',
      'get_web_surface_state',
      'destroy_web_surface',
    ]);
    expect(JSON.stringify(calls)).not.toContain('eval');
    expect(JSON.stringify(calls)).not.toContain('shell');
    expect(calls[0]?.args?.privateSession).toBe(false);
  });

  test('drops malformed native state events at the platform boundary', async () => {
    let listener: ((payload: unknown) => void) | undefined;
    const surfaces = createTauriWebSurfaces({
      async invoke<T>() {
        return undefined as T;
      },
      async listen<T>(_event: string, next: (payload: T) => void) {
        listener = next as (payload: unknown) => void;
        return () => {};
      },
    });
    const received: unknown[] = [];
    await surfaces.subscribe((value) => received.push(value));
    listener?.({ ...snapshot, id: 'not-a-managed-id' });
    listener?.(snapshot);
    expect(received).toEqual([snapshot]);
  });

  test('accepts only sanitized popup requests from a managed native surface', async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const surfaces = createTauriWebSurfaces({
      async invoke<T>() {
        return undefined as T;
      },
      async listen<T>(event: string, next: (payload: T) => void) {
        listeners.set(event, next as (payload: unknown) => void);
        return () => listeners.delete(event);
      },
    });
    const received: unknown[] = [];
    const dispose = await surfaces.subscribeOpenRequests((value) => received.push(value));
    const emit = listeners.get('nammu://web-surface-open-request');

    emit?.({ sourceId: 'invalid', owner: 'browser', url: 'https://example.com/' });
    emit?.({ sourceId: snapshot.id, owner: 'browser', url: 'file:///C:/Windows/System32' });
    emit?.({ sourceId: snapshot.id, owner: 'browser', url: 'https://user:pass@example.com/' });
    emit?.({ sourceId: snapshot.id, owner: 'browser', url: 'https://example.com/' });

    expect(received).toEqual([
      { sourceId: snapshot.id, owner: 'browser', url: 'https://example.com/' },
    ]);
    dispose();
    expect(listeners.size).toBe(0);
  });

  test('scopes native permissions to local trusted shell webviews and no remote origin', () => {
    const capability = JSON.parse(
      readFileSync(join(repositoryRoot, 'src-tauri/capabilities/main.json'), 'utf8'),
    ) as {
      local?: boolean;
      windows?: string[];
      webviews?: string[];
      remote?: unknown;
      permissions?: string[];
    };
    expect(capability.local).toBe(true);
    expect(capability.webviews).toEqual(['main', 'standalone-*']);
    expect(capability.windows).toBeUndefined();
    expect(capability.remote).toBeUndefined();
    expect(capability.permissions).toContain('allow-create-web-surface');
    expect(capability.permissions).toContain('allow-open-standalone-window');
    expect(capability.permissions).toContain('allow-get-standalone-bootstrap');
    expect(capability.permissions).not.toContain('core:webview:allow-create-webview');
  });

  test('does not expose arbitrary evaluation or filesystem primitives in Rust commands', () => {
    const source = readFileSync(join(repositoryRoot, 'src-tauri/src/web_surface.rs'), 'utf8');
    expect(source).not.toContain('#[tauri::command]\npub fn eval');
    expect(source).not.toContain('shell::Command');
    expect(source).not.toContain('std::process::Command');
    expect(source).toContain('require_trusted_caller(&caller)?');
    expect(source).toContain('WebSurfaceOwner');
  });

  test('selects the native renderer directly on Tauri without an automatic Gecko fallback', () => {
    const source = readFileSync(
      join(repositoryRoot, 'src/components/browser/BrowserApp.tsx'),
      'utf8',
    );
    expect(source).toContain("const nativeSurfaceEnabled = platform.runtime === 'tauri'");
    expect(source).not.toContain("getItem('nammu-browser-renderer')");
    expect(source).not.toContain('Falling back to Gecko');
    expect(source).not.toContain('setNativeSurfaceFailed');
  });

  test('loads standalone windows from the local entry with a Rust-owned typed route', () => {
    const nativeWindow = readFileSync(
      join(repositoryRoot, 'src-tauri/src/standalone_window.rs'),
      'utf8',
    );
    const desktopEntry = readFileSync(join(repositoryRoot, 'desktop/main.tsx'), 'utf8');
    const standaloneShell = readFileSync(
      join(repositoryRoot, 'src/components/desktop/StandaloneWindowContent.tsx'),
      'utf8',
    );

    expect(nativeWindow).toContain('WebviewUrl::App(PathBuf::from("index.html"))');
    expect(nativeWindow).toContain('pub async fn open_standalone_window(');
    expect(nativeWindow).toContain('leaving\n    // a visible native window permanently parked at about:blank');
    expect(nativeWindow).toContain('StandaloneWindowState');
    expect(nativeWindow).toContain('get_standalone_bootstrap');
    expect(nativeWindow).toContain('.decorations(false)');
    expect(nativeWindow).not.toContain('.initialization_script(');
    expect(nativeWindow).not.toContain('index.html?nammuStandaloneKind=');
    expect(desktopEntry).toContain(
      "return invoke<StandaloneBootstrap | null>('get_standalone_bootstrap')",
    );
    expect(desktopEntry).not.toContain('__NAMMU_STANDALONE__');
    expect(standaloneShell).toContain('standalone-window-titlebar');
    expect(standaloneShell).toContain('platform.window.close()');
  });
});
