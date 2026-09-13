import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeMatrixEffectSettings } from '../src/lib/wallpapers';

const root = join(import.meta.dir, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('desktop remote application runtime split', () => {
  test('selects NativeWebSurface before any Gecko runtime is rendered on Desktop', () => {
    const browserHost = source('src/components/os/SystemApps.tsx');
    const whatsapp = source('src/components/whatsapp/WhatsAppApp.tsx');
    const telegram = source('src/components/telegram/TelegramApp.tsx');
    const music = source('src/components/youtube-music/YouTubeMusicApp.tsx');

    for (const app of [whatsapp, telegram, music]) {
      expect(app).toContain("platform.runtime === 'tauri'");
      expect(app).toContain('<NativeWebSurface');
    }
    expect(browserHost).toContain('appId="os.nammu.browser"');
    expect(whatsapp).toContain('!nativeSurfaceEnabled && engineReadyRef.current');
    expect(telegram).toContain('owner="telegram"');
    expect(telegram).toContain('getGeckoRuntimeUrl');
    expect(music).toContain("if (nativeSurfaceEnabled) {\n      setRuntimeWispUrl('');");
    expect(source('src/platform/sandbox/capabilityBroker.ts')).toContain(
      'privateSession: params.privateSession === true',
    );
  });

  test('keeps owner-isolated profiles and a deny-by-default navigation policy', () => {
    const native = source('src-tauri/src/web_surface.rs');
    expect(native).toContain('Self::Whatsapp => "whatsapp"');
    expect(native).toContain('Self::Telegram => "telegram"');
    expect(native).toContain('Self::YoutubeMusic => "youtube-music"');
    expect(native).toContain('owner == WebSurfaceOwner::Integration');
    expect(native).toContain('policy.allowed_origins.iter().any');
    expect(native).toContain('require_trusted_caller(&caller)?');
    expect(native).toContain('.incognito(private_session)');
    expect(native).toContain('YOUTUBE_MUSIC_INITIALIZATION_SCRIPT');
  });

  test('uses finalized shared production naming for the native surface adapter', () => {
    const shared = source('src/components/web-surfaces/NativeWebSurface.tsx');
    expect(shared).toContain('const NativeWebSurface = forwardRef');
    expect(shared).not.toContain('NativeBrowserSurfaceProof');
  });

  test('shows the real remote surface immediately without branded startup interstitials', () => {
    const whatsapp = source('src/components/whatsapp/WhatsAppApp.tsx');
    const telegram = source('src/components/telegram/TelegramApp.tsx');
    const music = source('src/components/youtube-music/YouTubeMusicApp.tsx');

    expect(whatsapp).not.toContain('Starting WhatsApp inside Nammu OS');
    expect(telegram).not.toContain('Starting Nammu Telegram');
    expect(music).not.toContain('Starting Nammu Music');
    expect(source('src/components/os/SystemApps.tsx')).not.toContain('Starting Nammu Browser');
    expect(whatsapp).toContain("engineState === 'error'");
    expect(telegram).toContain("engineState === 'error'");
    expect(music).toContain("engineState === 'error'");
  });

  test('does not package Web-only Gecko assets or a Desktop Wisp server', () => {
    const vite = source('vite.desktop.config.ts');
    const server = source('server.mjs');
    const runtime = source('scripts/prepare-desktop-local-server.mjs');
    expect(vite).toContain("path !== 'firefox-wasm'");
    expect(server).toContain(
      "desktopLocal ? null : await import('@mercuryworkshop/wisp-js/server')",
    );
    expect(runtime).not.toContain("'@mercuryworkshop/wisp-js',");
    expect(source('scripts/verify-desktop-release.mjs')).toContain(
      'The Desktop bundle must not contain the Web-only Gecko/WASM runtime.',
    );
  });
});

describe('Synth Rain settings and scheduling', () => {
  test('accepts custom six-digit colors exactly', () => {
    expect(normalizeMatrixEffectSettings('synth-rain', { color: '#2070ff' }).color).toBe('#2070ff');
  });

  test('updates settings through a live ref without restarting the renderer', () => {
    const wallpaper = source('src/components/os/wallpapers/MatrixWallpaper.tsx');
    expect(wallpaper).toContain('settingsRef.current = settings');
    expect(wallpaper).toContain('schedule(frameInterval)');
    expect(wallpaper).toContain('}, [variant]);');
    expect(wallpaper).toContain('MAX_RENDER_WIDTH / cssWidth');
  });
});
