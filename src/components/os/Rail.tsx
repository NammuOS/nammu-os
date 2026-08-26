import {
  Cloud,
  Eye,
  Files,
  FolderOpen,
  Globe,
  Home,
  Layers3,
  Minimize2,
  PanelsTopLeft,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  SquareTerminal,
  TimerReset,
  X,
  MessageSquare,
  Flame,
} from 'lucide-react';
import type { WindowState } from '../../hooks/useWindowManager';
import type { SystemAppId } from './systemAppRegistry';
import { useContextMenu } from '../context-menu/useContextMenu';
import type { ContextMenuEntry } from '../context-menu/contextMenuTypes';

interface RailProps {
  windows: WindowState[];
  searchActive: boolean;
  onHome: () => void;
  onOpenSearch: () => void;
  onOpenSystemApp: (id: SystemAppId) => void;
  onFocusWindow: (id: string) => void;
  onRestoreWindow: (id: string) => void;
  onMinimizeWindow: (id: string) => void;
  onCloseWindow: (id: string) => void;
}

const ITEMS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'firefox', label: 'Firefox', icon: Flame, app: 'firefox' as SystemAppId },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, app: 'whatsapp' as SystemAppId },
  { id: 'browser', label: 'Browser', icon: Globe, app: 'browser' as SystemAppId },
  { id: 'projects', label: 'Projects', icon: Layers3, app: 'projects' as SystemAppId },
  { id: 'tools', label: 'Tools', icon: Search },
  { id: 'spaces', label: 'Spaces', icon: PanelsTopLeft, app: 'spaces' as SystemAppId },
  { id: 'sessions', label: 'Sessions', icon: TimerReset, app: 'sessions' as SystemAppId },
  { id: 'files', label: 'Files', icon: Files, app: 'files' as SystemAppId },
  { id: 'cloud', label: 'Cloud', icon: Cloud, app: 'cloud' as SystemAppId },
  { id: 'ai', label: 'Nammu AI', icon: Sparkles, app: 'ai' as SystemAppId },
  { id: 'terminal', label: 'Shell', icon: SquareTerminal, app: 'terminal' as SystemAppId },
];

export default function Rail({
  windows,
  searchActive,
  onHome,
  onOpenSearch,
  onOpenSystemApp,
  onFocusWindow,
  onRestoreWindow,
  onMinimizeWindow,
  onCloseWindow,
}: RailProps) {
  const contextMenu = useContextMenu();
  const visible = windows.filter((windowState) => !windowState.isMinimized);
  const isActive = (id: string, app?: SystemAppId) =>
    id === 'home'
      ? !visible.length && !searchActive
      : id === 'tools'
        ? searchActive
        : visible.some((windowState) => windowState.toolId === `system:${app}`);
  const activate = (id: string, app?: SystemAppId) => {
    if (id === 'home') onHome();
    else if (id === 'tools') onOpenSearch();
    else if (app) onOpenSystemApp(app);
  };
  const railMenu: ContextMenuEntry[] = [
    { id: 'rail-header', type: 'header', label: 'Navigation rail' },
    { id: 'rail-home', label: 'Show desktop', icon: Home, action: onHome },
    {
      id: 'rail-files',
      label: 'Open Files',
      icon: FolderOpen,
      action: () => onOpenSystemApp('files'),
    },
    {
      id: 'rail-shell',
      label: 'Open Shell',
      icon: SquareTerminal,
      action: () => onOpenSystemApp('terminal'),
    },
    { id: 'rail-sep', type: 'separator' },
    {
      id: 'rail-settings',
      label: 'Rail settings',
      icon: Settings2,
      action: () => onOpenSystemApp('settings'),
    },
  ];

  return (
    <nav
      className="os-rail fixed bottom-[32px] left-0 top-0 z-[9996] flex w-[36px] flex-col items-center border-r border-white/[0.06] bg-[linear-gradient(90deg,rgba(5,8,13,.98),rgba(7,11,18,.94))] py-2 backdrop-blur-xl"
      aria-label="Nammu sidebar"
      onContextMenu={(event) =>
        contextMenu.openAtEvent(event, railMenu, {
          safeArea: { left: 36, right: 0, bottom: 32 },
          ariaLabel: 'Navigation rail menu',
        })
      }
      onPointerDown={(event) =>
        contextMenu.startLongPress(event, railMenu, {
          safeArea: { left: 36, right: 0, bottom: 32 },
          ariaLabel: 'Navigation rail menu',
        })
      }
      onPointerUp={contextMenu.cancelLongPress}
      onPointerCancel={contextMenu.cancelLongPress}
      onPointerMove={contextMenu.cancelLongPress}
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.id, item.app);
        return (
          <button
            key={item.id}
            onClick={() => activate(item.id, item.app)}
            onContextMenu={(event) => {
              const existing = item.app
                ? windows.find((windowState) => windowState.toolId === `system:${item.app}`)
                : undefined;
              const items: ContextMenuEntry[] =
                item.id === 'home'
                  ? [
                      { id: 'rail-home-header', type: 'header', label: 'Home' },
                      { id: 'rail-home-show', label: 'Show desktop', icon: Home, action: onHome },
                      {
                        id: 'rail-home-restore',
                        label: 'Restore all windows',
                        icon: RotateCcw,
                        action: () =>
                          windows
                            .filter((win) => win.isMinimized)
                            .forEach((win) => onRestoreWindow(win.id)),
                      },
                    ]
                  : item.id === 'tools'
                    ? [
                        { id: 'rail-tools-header', type: 'header', label: 'Tools' },
                        {
                          id: 'rail-tools-open',
                          label: 'Open tool search',
                          icon: Search,
                          shortcut: 'WIN SPACE',
                          action: onOpenSearch,
                        },
                      ]
                    : [
                        { id: `rail-${item.id}-header`, type: 'header', label: item.label },
                        {
                          id: `rail-${item.id}-open`,
                          label: !existing
                            ? 'Open'
                            : existing.isMinimized
                              ? 'Restore'
                              : existing.isFocused
                                ? 'Minimize'
                                : 'Bring to front',
                          icon: existing?.isFocused ? Minimize2 : Eye,
                          action: () =>
                            !existing && item.app
                              ? onOpenSystemApp(item.app)
                              : existing?.isMinimized
                                ? onRestoreWindow(existing.id)
                                : existing?.isFocused
                                  ? onMinimizeWindow(existing.id)
                                  : existing
                                    ? onFocusWindow(existing.id)
                                    : undefined,
                        },
                        ...(existing
                          ? [
                              { id: `rail-${item.id}-sep`, type: 'separator' as const },
                              {
                                id: `rail-${item.id}-close`,
                                label: 'Exit',
                                icon: X,
                                danger: true,
                                action: () => onCloseWindow(existing.id),
                              },
                            ]
                          : []),
                      ];
              contextMenu.openAtEvent(event, items, {
                safeArea: { left: 36, right: 0, bottom: 32 },
                ariaLabel: `${item.label} menu`,
              });
            }}
            className={`group relative my-0.5 grid h-7 w-7 place-items-center rounded-[5px] transition-colors ${active ? 'bg-[#4aa3ff]/10 text-[#9dccff]' : 'text-[#536b7f] hover:bg-white/[0.04] hover:text-[#adc2d4]'}`}
            aria-label={item.label}
            title={item.label}
          >
            {active && (
              <span className="absolute -left-1 h-3.5 w-0.5 bg-[#4aa3ff] shadow-[0_0_6px_rgba(74,163,255,.8)]" />
            )}
            <Icon size={14} strokeWidth={1.35} />
            {item.id === 'sessions' && (
              <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-[#2ee6a6] shadow-[0_0_4px_rgba(46,230,166,.8)]" />
            )}
            <span className="pointer-events-none absolute left-[calc(100%+8px)] z-50 whitespace-nowrap border border-white/[0.07] bg-[#080d15]/95 px-2 py-1 font-mono text-[8px] tracking-[0.08em] text-[#9db2c4] opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
              {item.label}
            </span>
          </button>
        );
      })}
      <div className="flex-1" />
      <button
        onClick={() => onOpenSystemApp('settings')}
        onContextMenu={(event) => {
          const existing = windows.find((windowState) => windowState.toolId === 'system:settings');
          contextMenu.openAtEvent(
            event,
            [
              { id: 'rail-settings-header', type: 'header', label: 'Settings' },
              {
                id: 'rail-settings-open',
                label: !existing
                  ? 'Open'
                  : existing.isMinimized
                    ? 'Restore'
                    : existing.isFocused
                      ? 'Minimize'
                      : 'Bring to front',
                icon: existing?.isFocused ? Minimize2 : Eye,
                action: () =>
                  !existing
                    ? onOpenSystemApp('settings')
                    : existing.isMinimized
                      ? onRestoreWindow(existing.id)
                      : existing.isFocused
                        ? onMinimizeWindow(existing.id)
                        : onFocusWindow(existing.id),
              },
              ...(existing
                ? [
                    { id: 'rail-settings-sep', type: 'separator' as const },
                    {
                      id: 'rail-settings-close',
                      label: 'Exit',
                      icon: X,
                      danger: true,
                      action: () => onCloseWindow(existing.id),
                    },
                  ]
                : []),
            ],
            { safeArea: { left: 36, right: 0, bottom: 32 }, ariaLabel: 'Settings menu' },
          );
        }}
        className={`group relative grid h-7 w-7 place-items-center rounded-[5px] transition-colors ${isActive('settings', 'settings') ? 'bg-[#4aa3ff]/10 text-[#9dccff]' : 'text-[#536b7f] hover:bg-white/[0.04] hover:text-[#adc2d4]'}`}
        title="Settings"
        aria-label="Settings"
      >
        <Settings2 size={14} strokeWidth={1.35} />
        <span className="pointer-events-none absolute left-[calc(100%+8px)] whitespace-nowrap border border-white/[0.07] bg-[#080d15]/95 px-2 py-1 font-mono text-[8px] text-[#9db2c4] opacity-0 group-hover:opacity-100">
          Settings
        </span>
      </button>
    </nav>
  );
}
