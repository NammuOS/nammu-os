import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WALLPAPERS } from '../src/lib/wallpapers';
import { DEFAULT_SYSTEM_THEME, SYSTEM_THEME_IDS } from '../src/lib/systemTheme';

const root = resolve(import.meta.dir, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Horizon product-wide theme', () => {
  test('is the named default without removing the established themes', () => {
    expect(DEFAULT_SYSTEM_THEME).toBe('horizon');
    expect(SYSTEM_THEME_IDS).toEqual(['horizon', 'cyber', 'macos', 'obsidian', 'midnight']);
  });

  test('bundles the complete licensed wallpaper collection with adaptive accents', () => {
    const horizon = WALLPAPERS.filter((wallpaper) => wallpaper.id.startsWith('horizon-'));
    expect(horizon).toHaveLength(25);
    expect(horizon.every((wallpaper) => wallpaper.kind === 'image')).toBe(true);
    expect(horizon.every((wallpaper) => /^#[0-9a-f]{6}$/i.test(wallpaper.accent ?? ''))).toBe(true);
  });

  test('places every system app and tool inside the shared visual boundary', () => {
    const systemApps = read('src/components/os/SystemApps.tsx');
    const desktop = read('src/components/desktop/DesktopApp.tsx');
    const standalone = read('src/components/desktop/StandaloneWindowContent.tsx');

    expect(systemApps).toContain('className="nammu-app-surface');
    expect(systemApps).toContain('data-nammu-app={appId}');
    expect(desktop).toContain('data-nammu-tool={tool?.id}');
    expect(standalone).toContain('data-nammu-tool={tool?.id}');
  });

  test('loads the application theme after the legacy global layer in both runtimes', () => {
    expect(read('src/app/layout.tsx').indexOf("import './horizon.css'")).toBeGreaterThan(
      read('src/app/layout.tsx').indexOf("import './globals.css'"),
    );
    expect(read('desktop/main.tsx').indexOf("import '../src/app/horizon.css'")).toBeGreaterThan(
      read('desktop/main.tsx').indexOf("import '../src/app/globals.css'"),
    );
  });

  test('keeps the intended Horizon recipe authoritative and removes legacy boot copy', () => {
    const globals = read('src/app/globals.css');
    const applicationTheme = read('src/app/horizon.css');
    const desktopClient = read('src/components/desktop/DesktopClient.tsx');

    expect(globals).toContain('@media not all {');
    expect(applicationTheme).toContain("[data-theme='horizon'] .nammu-app-surface");
    expect(applicationTheme).toContain("[data-nammu-app='files']");
    expect(applicationTheme).toContain("[data-nammu-app='browser']");
    expect(applicationTheme).toContain("[data-nammu-app='maps']");
    expect(applicationTheme).toContain("[data-nammu-app='pdf']");
    expect(applicationTheme).toContain("[data-nammu-tool='subdomain-discovery']");
    expect(desktopClient).not.toContain('KERNEL BOOTING');
  });
});
