import {
  Eye,
  FolderOpen,
  Home,
  Minimize2,
  PinOff,
  RotateCcw,
  Search,
  Settings2,
  SquareTerminal,
  X,
  Music,
  type LucideIcon,
} from 'lucide-react';
import type { WindowState } from '../../hooks/useWindowManager';
import type { SystemAppId } from './systemAppRegistry';
import { findSystemApp } from './systemAppRegistry';
import { findToolById } from '../../lib/toolRegistry';
import {
  DEFAULT_RAIL_ORDER,
  RAIL_PREFERENCES_CHANGE_EVENT,
  getRailPreferences,
  railAppId,
  railToolId,
  saveRailPreferences,
  type RailItemId,
} from '../../lib/railPreferences';
import { useContextMenu } from '../context-menu/useContextMenu';
import type { ContextMenuEntry } from '../context-menu/contextMenuTypes';
import { useEffect, useState } from 'react';

interface RailProps {
  windows: WindowState[];
  searchActive: boolean;
  onHome: () => void;
  onOpenSearch: () => void;
  onOpenSystemApp: (id: SystemAppId) => void;
  onOpenTool: (id: string) => void;
  onFocusWindow: (id: string) => void;
  onRestoreWindow: (id: string) => void;
  onMinimizeWindow: (id: string) => void;
  onCloseWindow: (id: string) => void;
  musicOpen: boolean;
  onToggleMusic: () => void;
}

interface RailDisplayItem {
  id: RailItemId;
  label: string;
  icon: LucideIcon;
  app?: SystemAppId;
  tool?: string;
}

function resolveRailItem(id: RailItemId): RailDisplayItem | null {
  if (id === 'system:home') return { id, label: 'Home', icon: Home };
  if (id === 'system:search') return { id, label: 'Tools', icon: Search };
  if (id === 'system:music') return { id, label: 'Music', icon: Music };
  const appId = railAppId(id);
  if (appId) {
    const app = findSystemApp(appId);
    return app ? { id, label: app.title, icon: app.icon, app: app.id } : null;
  }
  const toolId = railToolId(id);
  const tool = toolId ? findToolById(toolId) : null;
  return tool ? { id, label: tool.name, icon: tool.icon, tool: tool.id } : null;
}

export default function Rail({
  windows,
  searchActive,
  onHome,
  onOpenSearch,
  onOpenSystemApp,
  onOpenTool,
  onFocusWindow,
  onRestoreWindow,
  onMinimizeWindow,
  onCloseWindow,
  musicOpen,
  onToggleMusic,
}: RailProps) {
  const contextMenu = useContextMenu();
  const [itemOrder, setItemOrder] = useState<RailItemId[]>(DEFAULT_RAIL_ORDER);
  const [draggedItemId, setDraggedItemId] = useState<RailItemId | null>(null);

  useEffect(() => {
    const syncRail = () => setItemOrder(getRailPreferences().order);
    syncRail();
    window.addEventListener(RAIL_PREFERENCES_CHANGE_EVENT, syncRail);
    return () => window.removeEventListener(RAIL_PREFERENCES_CHANGE_EVENT, syncRail);
  }, []);

  const reorderRail = (sourceId: RailItemId, targetId: RailItemId) => {
    if (sourceId === targetId) return;
    const sourceIndex = itemOrder.indexOf(sourceId);
    const targetIndex = itemOrder.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...itemOrder];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    setItemOrder(saveRailPreferences({ order: next }).order);
  };

  const removeFromRail = (id: RailItemId) => {
    setItemOrder(saveRailPreferences({ order: itemOrder.filter((item) => item !== id) }).order);
  };

  const orderedItems = itemOrder.flatMap((id) => {
    const item = resolveRailItem(id);
    return item ? [item] : [];
  });
  const visible = windows.filter((windowState) => !windowState.isMinimized);
  const isActive = (id: RailItemId, app?: SystemAppId, tool?: string) =>
    id === 'system:home'
      ? !visible.length && !searchActive
      : id === 'system:search'
        ? searchActive
        : id === 'system:music'
          ? musicOpen
          : visible.some(
              (windowState) => windowState.toolId === (app ? `system:${app}` : tool ? tool : ''),
            );
  const activate = (id: RailItemId, app?: SystemAppId, tool?: string) => {
    if (id === 'system:home') onHome();
    else if (id === 'system:search') onOpenSearch();
    else if (id === 'system:music') onToggleMusic();
    else if (app) onOpenSystemApp(app);
    else if (tool) onOpenTool(tool);
  };
  const railMenu: ContextMenuEntry[] = [
    { id: 'rail-header', type: 'header', label: 'Navigation rail' },
    { id: 'rail-home', label: 'Show desktop', icon: Home, action: onHome },
    {
      id: 'rail-music',
      label: musicOpen ? 'Hide music player' : 'Show music player',
      icon: Music,
      checked: musicOpen,
      action: onToggleMusic,
    },
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
      <div className="rail-custom-items flex min-h-0 w-full flex-col items-center overflow-y-auto overflow-x-hidden">
        {orderedItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.id, item.app, item.tool);
          return (
            <button
              key={item.id}
              draggable
              aria-grabbed={draggedItemId === item.id}
              onDragStart={(event) => {
                setDraggedItemId(item.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', item.id);
              }}
              onDragOver={(event) => {
                if (!draggedItemId || draggedItemId === item.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = (draggedItemId ||
                  event.dataTransfer.getData('text/plain')) as RailItemId;
                if (sourceId) reorderRail(sourceId, item.id);
                setDraggedItemId(null);
              }}
              onDragEnd={() => setDraggedItemId(null)}
              onClick={() => activate(item.id, item.app, item.tool)}
              onContextMenu={(event) => {
                const windowId = item.app ? `system:${item.app}` : item.tool;
                const existing = windowId
                  ? windows.find((windowState) => windowState.toolId === windowId)
                  : undefined;
                const items: ContextMenuEntry[] =
                  item.id === 'system:home'
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
                    : item.id === 'system:search'
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
                      : item.id === 'system:music'
                        ? [
                            { id: 'rail-music-header', type: 'header', label: 'Music' },
                            {
                              id: 'rail-music-toggle',
                              label: musicOpen ? 'Hide music player' : 'Show music player',
                              icon: Music,
                              checked: musicOpen,
                              action: onToggleMusic,
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
                                  : !existing && item.tool
                                    ? onOpenTool(item.tool)
                                    : existing?.isMinimized
                                      ? onRestoreWindow(existing.id)
                                      : existing?.isFocused
                                        ? onMinimizeWindow(existing.id)
                                        : existing
                                          ? onFocusWindow(existing.id)
                                          : undefined,
                            },
                            { id: `rail-${item.id}-sep`, type: 'separator' as const },
                            {
                              id: `rail-${item.id}-remove`,
                              label: 'Remove from rail',
                              icon: PinOff,
                              action: () => removeFromRail(item.id),
                            },
                            ...(existing
                              ? [
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
              className={`rail-app-button group relative my-0.5 grid h-7 w-7 place-items-center rounded-[5px] transition-colors ${draggedItemId === item.id ? 'opacity-40' : ''} ${active ? 'is-active bg-[#4aa3ff]/10 text-[#9dccff]' : 'text-[#536b7f] hover:bg-white/[0.04] hover:text-[#adc2d4]'}`}
              aria-label={item.label}
              title={item.label}
            >
              {active && (
                <span className="absolute -left-1 h-3.5 w-0.5 bg-[#4aa3ff] shadow-[0_0_6px_rgba(74,163,255,.8)]" />
              )}
              <Icon size={14} strokeWidth={1.35} />
              <span className="rail-tooltip pointer-events-none absolute left-[calc(100%+8px)] z-50 whitespace-nowrap border border-white/[0.07] bg-[#080d15]/95 px-2 py-1 font-mono text-[8px] tracking-[0.08em] text-[#9db2c4] opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
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
        className={`rail-app-button group relative grid h-7 w-7 shrink-0 place-items-center rounded-[5px] transition-colors ${isActive('app:settings', 'settings') ? 'is-active bg-[#4aa3ff]/10 text-[#9dccff]' : 'text-[#536b7f] hover:bg-white/[0.04] hover:text-[#adc2d4]'}`}
        title="Settings"
        aria-label="Settings"
      >
        <Settings2 size={14} strokeWidth={1.35} />
        <span className="rail-tooltip pointer-events-none absolute left-[calc(100%+8px)] whitespace-nowrap border border-white/[0.07] bg-[#080d15]/95 px-2 py-1 font-mono text-[8px] text-[#9db2c4] opacity-0 group-hover:opacity-100">
          Settings
        </span>
      </button>
    </nav>
  );
}
