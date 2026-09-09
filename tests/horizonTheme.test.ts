import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_HORIZON_WALLPAPER_ACCENT,
  DEFAULT_HORIZON_WALLPAPER_SRC,
  WALLPAPERS,
} from '../src/lib/wallpapers';
import {
  DEFAULT_SYSTEM_ACCENT,
  DEFAULT_SYSTEM_THEME,
  SYSTEM_THEME_IDS,
} from '../src/lib/systemTheme';

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
    expect(DEFAULT_HORIZON_WALLPAPER_SRC).toBe('/wallpapers/horizon/21.avif');
    expect(DEFAULT_SYSTEM_ACCENT).toBe(DEFAULT_HORIZON_WALLPAPER_ACCENT);
    expect(
      horizon.find((wallpaper) => wallpaper.src === DEFAULT_HORIZON_WALLPAPER_SRC)?.accent,
    ).toBe(DEFAULT_HORIZON_WALLPAPER_ACCENT);
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

  test('uses compact neutral scrollbars and an edge-revealed macOS-sized rail', () => {
    const applicationTheme = read('src/app/horizon.css');
    const taskbar = read('src/components/os/Taskbar.tsx');

    expect(applicationTheme).toContain('width: 5px !important');
    expect(applicationTheme).toContain('scrollbar-color: rgba(255, 255, 255, 0.25) transparent');
    expect(applicationTheme).toContain("[data-theme='horizon'] .os-rail::after");
    expect(applicationTheme).toContain('width: 44px !important');
    expect(applicationTheme).toContain('transform: translate3d(-58px, -50%, 0)');
    expect(applicationTheme).toContain("[data-theme='horizon'] .os-rail:hover");
    expect(applicationTheme).toContain("[data-theme='horizon'] .taskbar-button.active > .absolute");
    expect(taskbar).toContain('taskbar-button-unpinned');
  });

  test('uses full-workspace maximize and auto-hides the dock for snapped windows', () => {
    const applicationTheme = read('src/app/horizon.css');
    const desktop = read('src/components/desktop/DesktopApp.tsx');
    const taskbar = read('src/components/os/Taskbar.tsx');
    const windowChrome = read('src/components/os/Window.tsx');

    expect(desktop).toContain("hasMaximizedWindow ? 'desktop-has-maximized' : ''");
    expect(desktop).toContain('const shouldAutoHideTaskbar = windows.some(');
    expect(desktop).toContain('windowState.isMaximized || Boolean(windowState.snap)');
    expect(desktop).toContain('autoHide={shouldAutoHideTaskbar}');
    expect(taskbar).toContain('taskbar-reveal-zone');
    expect(taskbar).toContain("autoHide ? 'taskbar-auto-hide' : ''");
    expect(windowChrome).toContain("win.isMaximized ? 'os-window-maximized' : ''");
    expect(applicationTheme).toContain(
      "[data-theme='horizon'] .desktop-has-maximized .os-window-maximized",
    );
    expect(applicationTheme).toContain(
      "[data-theme='macos'] .desktop-has-maximized .os-window-maximized",
    );
    expect(applicationTheme).toContain(
      "[data-theme='horizon'] .taskbar-reveal-zone:hover + .taskbar-auto-hide",
    );
  });

  test('connects Horizon split windows and the music workspace to screen edges', () => {
    const applicationTheme = read('src/app/horizon.css');
    const windowChrome = read('src/components/os/Window.tsx');

    expect(windowChrome).toContain('data-snap={snapPreview}');
    expect(windowChrome).toContain('data-snap={win.snap || undefined}');
    expect(windowChrome).toContain("'--window-right-inset': `${rightInset}px`");
    expect(applicationTheme).toContain("[data-snap='left']");
    expect(applicationTheme).toContain("[data-snap='bottom-right']");
    expect(applicationTheme).toContain(
      'width: calc((100vw - var(--window-right-inset, 0px)) / 2) !important',
    );
    expect(applicationTheme).toContain(
      'width: calc(100vw - var(--window-right-inset, 0px)) !important',
    );
    expect(applicationTheme).toContain("[data-theme='horizon'] .music-sidebar {");
    expect(applicationTheme).toContain('bottom: 0 !important');
  });

  test('uses a warm adaptive shell and premium Horizon desktop search', () => {
    const applicationTheme = read('src/app/horizon.css');
    const identity = read('src/components/os/Identity.tsx');
    const startMenu = read('src/components/os/StartMenu.tsx');

    expect(applicationTheme).toContain("url('/wallpapers/horizon/21.avif')");
    expect(applicationTheme).toContain('.nammu-os-shell\n  :is(');
    expect(applicationTheme).toContain("[class*='text-cyan']");
    expect(applicationTheme).toContain("[data-theme='horizon'] .desktop-search-field");
    expect(applicationTheme).toContain('width: min(520px, calc(100vw - 48px)) !important');
    expect(applicationTheme).toContain('height: 50px !important');
    expect(applicationTheme).toContain('.identity-actions');
    expect(applicationTheme).toContain("[data-theme='horizon'] .start-menu-search");
    expect(applicationTheme).toContain('background: rgba(0, 0, 0, 0.4) !important');
    expect(applicationTheme).toContain("[data-theme='horizon'] .taskbar-start-button img");
    expect(identity).toContain('identity-search-wrap');
    expect(identity).toContain('identity-search-icon');
    expect(startMenu).toContain('start-menu-layer');
    expect(startMenu).toContain('start-menu-app');
  });

  test('ships one optimized brand system and removes retired wallpapers', () => {
    const taskbar = read('src/components/os/Taskbar.tsx');
    const wallpapers = read('src/lib/wallpapers.ts');

    expect(taskbar).toContain('/branding/nammu-logo.webp');
    expect(wallpapers).not.toContain("id: 'whale'");
    expect(wallpapers).not.toContain("id: 'high-tech-city'");
    expect(existsSync(resolve(root, 'public/branding/nammu-logo.webp'))).toBe(true);
    expect(existsSync(resolve(root, 'public/branding/nammu-logo.png'))).toBe(true);
    expect(existsSync(resolve(root, 'public/wallpapers/whale.webp'))).toBe(false);
    expect(existsSync(resolve(root, 'public/wallpapers/high-tech city.webp'))).toBe(false);
  });

  test('keeps Browser bookmark rows flat rather than rounded cards', () => {
    const browser = read('src/components/browser/BrowserApp.tsx');
    const bookmarkLibrary = browser.slice(browser.indexOf("{sidePanel === 'bookmarks'"));

    expect(bookmarkLibrary).toContain(
      'group flex items-center gap-2 border-b border-white/4 px-1 py-2',
    );
    expect(bookmarkLibrary).not.toContain(
      'group flex items-center gap-2 rounded border border-transparent',
    );
  });
});
