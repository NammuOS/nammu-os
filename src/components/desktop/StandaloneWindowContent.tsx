'use client';

import { Suspense, useEffect, useMemo, useSyncExternalStore } from 'react';
import { findToolById } from '../../lib/toolRegistry';
import { SYSTEM_APPS } from '../os/systemAppRegistry';
import { SystemAppContent } from '../os/SystemApps';
import ContextMenu from '../context-menu/ContextMenu';
import { ContextMenuProvider } from '../context-menu/contextMenuStore';
import { TOOL_COMPONENTS } from './toolComponents';
import { applyIconSettings } from '../../lib/iconSettings';
import {
  DEFAULT_SYSTEM_ACCENT,
  DEFAULT_SYSTEM_THEME,
  resolveInitialSystemTheme,
} from '../../lib/systemTheme';

interface StandaloneWindowContentProps {
  kind: string;
  id: string;
}

const subscribeToClientReady = () => () => {};
const getClientReadySnapshot = () => true;
const getServerReadySnapshot = () => false;

export default function StandaloneWindowContent({ kind, id }: StandaloneWindowContentProps) {
  const systemApp = kind === 'app' ? SYSTEM_APPS.find((app) => app.id === id) : undefined;
  const tool = kind === 'tool' ? findToolById(id) : undefined;
  const ToolComponent = tool ? TOOL_COMPONENTS[tool.component] : undefined;
  const title = systemApp?.title || tool?.name || 'Unavailable';
  const safeArea = useMemo(() => ({ left: 0, right: 0, top: 0, bottom: 0, margin: 6 }), []);
  const clientReady = useSyncExternalStore(
    subscribeToClientReady,
    getClientReadySnapshot,
    getServerReadySnapshot,
  );

  useEffect(() => {
    document.title = `${title} — Nammu OS`;

    try {
      const saved = localStorage.getItem('nammu-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        applyIconSettings(document.documentElement, parsed);
        const { theme, migratedLegacyDefault } = resolveInitialSystemTheme(
          parsed.themeStyle,
          localStorage,
        );
        const appearance = parsed.appearance === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-appearance', appearance);
        document.documentElement.style.colorScheme = appearance;
        const accentColor = migratedLegacyDefault ? DEFAULT_SYSTEM_ACCENT : parsed.accentColor;
        if (accentColor) {
          document.documentElement.style.setProperty('--os-accent', accentColor);
          document.documentElement.style.setProperty('--color-os-accent', accentColor);
        }
        document.documentElement.setAttribute(
          'data-reduced-motion',
          parsed.reduceMotion === true ? 'on' : 'off',
        );
        if (migratedLegacyDefault) {
          localStorage.setItem(
            'nammu-settings',
            JSON.stringify({
              ...parsed,
              themeStyle: theme,
              accentColor,
              enableScanlines: false,
            }),
          );
        }
      } else {
        resolveInitialSystemTheme(undefined, localStorage);
        applyIconSettings(document.documentElement, null);
        document.documentElement.setAttribute('data-theme', DEFAULT_SYSTEM_THEME);
        document.documentElement.setAttribute('data-appearance', 'dark');
        document.documentElement.setAttribute('data-reduced-motion', 'off');
        document.documentElement.style.colorScheme = 'dark';
      }
    } catch {}

    const handleThemeChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          theme?: string;
          appearance?: 'light' | 'dark';
          reduceMotion?: boolean;
        }>
      ).detail;
      if (detail?.theme) document.documentElement.setAttribute('data-theme', detail.theme);
      if (detail?.appearance) {
        document.documentElement.setAttribute('data-appearance', detail.appearance);
        document.documentElement.style.colorScheme = detail.appearance;
      }
      if (typeof detail?.reduceMotion === 'boolean') {
        document.documentElement.setAttribute(
          'data-reduced-motion',
          detail.reduceMotion ? 'on' : 'off',
        );
      }
    };
    window.addEventListener('nammu-theme-change', handleThemeChange);
    return () => window.removeEventListener('nammu-theme-change', handleThemeChange);
  }, [title]);

  return (
    <ContextMenuProvider safeArea={safeArea}>
      <main className="nammu-os-shell h-dvh w-screen overflow-hidden bg-[#05070b]">
        {!clientReady ? (
          <div className="horizon-app-loading h-full" aria-label={`Opening ${title}`}>
            <div className="horizon-app-loading-sidebar" aria-hidden="true" />
            <div className="horizon-app-loading-content" aria-hidden="true">
              <span className="horizon-app-loading-title" />
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : systemApp ? (
          <SystemAppContent appId={systemApp.id} />
        ) : ToolComponent ? (
          <Suspense
            fallback={
              <div className="horizon-app-loading h-full" aria-label={`Opening ${title}`} />
            }
          >
            <div
              data-nammu-tool={tool?.id}
              className={
                tool?.id === 'subdomain-discovery'
                  ? 'nammu-app-surface h-full'
                  : 'nammu-app-surface h-full overflow-auto p-3'
              }
            >
              <ToolComponent />
            </div>
          </Suspense>
        ) : (
          <div className="grid h-full place-items-center bg-os-bg px-6 text-center">
            <div>
              <div className="text-sm font-semibold text-[#d6e5f0]">Cannot open this item</div>
              <div className="mt-1 text-[11px] text-[#70869a]">
                This app or tool is not available as a standalone window.
              </div>
            </div>
          </div>
        )}
        <ContextMenu />
      </main>
    </ContextMenuProvider>
  );
}
