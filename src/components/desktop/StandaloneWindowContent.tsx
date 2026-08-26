'use client';

import { useEffect, useMemo } from 'react';
import { findToolById } from '../../lib/toolRegistry';
import { SYSTEM_APPS } from '../os/systemAppRegistry';
import { SystemAppContent } from '../os/SystemApps';
import ContextMenu from '../context-menu/ContextMenu';
import { ContextMenuProvider } from '../context-menu/contextMenuStore';
import { TOOL_COMPONENTS } from './toolComponents';

interface StandaloneWindowContentProps {
  kind: string;
  id: string;
}

export default function StandaloneWindowContent({ kind, id }: StandaloneWindowContentProps) {
  const systemApp = kind === 'app' ? SYSTEM_APPS.find((app) => app.id === id) : undefined;
  const tool = kind === 'tool' ? findToolById(id) : undefined;
  const ToolComponent = tool ? TOOL_COMPONENTS[tool.component] : undefined;
  const title = systemApp?.title || tool?.name || 'Unavailable';
  const safeArea = useMemo(() => ({ left: 0, right: 0, top: 0, bottom: 0, margin: 6 }), []);

  useEffect(() => {
    document.title = `${title} — Nammu OS`;

    try {
      const saved = localStorage.getItem('nammu-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        const theme = ['cyber', 'obsidian', 'midnight', 'macos'].includes(parsed.themeStyle)
          ? parsed.themeStyle
          : 'cyber';
        const appearance = parsed.appearance === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-appearance', appearance);
        document.documentElement.style.colorScheme = appearance;
        if (parsed.accentColor) {
          document.documentElement.style.setProperty('--os-accent', parsed.accentColor);
          document.documentElement.style.setProperty('--color-os-accent', parsed.accentColor);
        }
      }
    } catch {}

    const handleThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ theme?: string; appearance?: 'light' | 'dark' }>)
        .detail;
      if (detail?.theme) document.documentElement.setAttribute('data-theme', detail.theme);
      if (detail?.appearance) {
        document.documentElement.setAttribute('data-appearance', detail.appearance);
        document.documentElement.style.colorScheme = detail.appearance;
      }
    };
    window.addEventListener('nammu-theme-change', handleThemeChange);
    return () => window.removeEventListener('nammu-theme-change', handleThemeChange);
  }, [title]);

  return (
    <ContextMenuProvider safeArea={safeArea}>
      <main className="nammu-os-shell h-dvh w-screen overflow-hidden bg-[#05070b]">
        {systemApp ? (
          <SystemAppContent appId={systemApp.id} />
        ) : ToolComponent ? (
          <div
            className={tool?.id === 'subdomain-discovery' ? 'h-full' : 'h-full overflow-auto p-3'}
          >
            <ToolComponent />
          </div>
        ) : (
          <div className="grid h-full place-items-center bg-[#05070b] px-6 text-center">
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
