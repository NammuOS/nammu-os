import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, FolderOpen, RotateCcw, Search, Settings, X } from 'lucide-react';
import { searchTools } from '../../lib/toolRegistry';
import { SYSTEM_APPS, searchSystemApps, type SystemAppId } from './systemAppRegistry';
import { useContextMenu } from '../context-menu/useContextMenu';
import type { ContextMenuEntry } from '../context-menu/contextMenuTypes';
import {
  DEFAULT_START_MENU_ORDER,
  START_MENU_ORDER_CHANGE_EVENT,
  getStartMenuPreferences,
  reorderIds,
  saveStartMenuPreferences,
} from '../../lib/appOrder';

interface StartMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenTool: (toolId: string) => void;
  onOpenSystemApp: (appId: SystemAppId) => void;
}

export default function StartMenu({
  isOpen,
  onClose,
  onOpenTool,
  onOpenSystemApp,
}: StartMenuProps) {
  const [query, setQuery] = useState('');
  const [preferences, setPreferences] = useState(() => ({
    order: DEFAULT_START_MENU_ORDER,
    hidden: [] as SystemAppId[],
  }));
  const [draggedAppId, setDraggedAppId] = useState<SystemAppId | null>(null);
  const contextMenu = useContextMenu();

  useEffect(() => {
    const syncPreferences = () => setPreferences(getStartMenuPreferences());
    syncPreferences();
    window.addEventListener(START_MENU_ORDER_CHANGE_EVENT, syncPreferences);
    window.addEventListener('storage', syncPreferences);
    return () => {
      window.removeEventListener(START_MENU_ORDER_CHANGE_EVENT, syncPreferences);
      window.removeEventListener('storage', syncPreferences);
    };
  }, []);

  const orderedApps = useMemo(() => {
    const appsById = new Map(SYSTEM_APPS.map((app) => [app.id, app]));
    return preferences.order.flatMap((id) => {
      const app = appsById.get(id);
      return app && !preferences.hidden.includes(id) ? [app] : [];
    });
  }, [preferences]);

  const toolResults = useMemo(() => {
    if (!query.trim()) return [];
    return searchTools(query).slice(0, 8);
  }, [query]);

  const appResults = useMemo(() => {
    if (!query.trim()) return orderedApps;
    const matches = new Set(searchSystemApps(query).map((app) => app.id));
    return orderedApps.filter((app) => matches.has(app.id));
  }, [orderedApps, query]);

  if (!isOpen) return null;

  const close = () => {
    setQuery('');
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (appResults.length > 0) {
        onOpenSystemApp(appResults[0].id);
        close();
      } else if (toolResults.length > 0) {
        onOpenTool(toolResults[0].id);
        close();
      }
    }
  };

  const reorderApp = (sourceId: SystemAppId, targetId: SystemAppId) => {
    if (sourceId === targetId) return;
    saveStartMenuPreferences({
      ...preferences,
      order: reorderIds(preferences.order, sourceId, targetId),
    });
  };

  const resetAppOrder = () => {
    saveStartMenuPreferences({ order: DEFAULT_START_MENU_ORDER, hidden: [] });
  };

  const startMenuContext: ContextMenuEntry[] = [
    { id: 'start-header', type: 'header', label: 'Start menu' },
    {
      id: 'start-clear',
      label: 'Clear search',
      icon: X,
      disabled: !query,
      action: () => setQuery(''),
    },
    {
      id: 'start-settings',
      label: 'Open Settings',
      icon: Settings,
      action: () => {
        onOpenSystemApp('settings');
        close();
      },
    },
    {
      id: 'start-reset-order',
      label: 'Reset app arrangement',
      icon: RotateCcw,
      action: resetAppOrder,
    },
    { id: 'start-close', label: 'Close Start menu', icon: X, action: close },
  ];

  return (
    <div className="fixed inset-x-0 bottom-[32px] top-0 z-[9997]" onClick={close}>
      <div
        className="start-menu-panel absolute bottom-0 left-[36px] flex max-h-[70vh] w-[360px] flex-col border border-white/[0.08] bg-[#070b12]/94 p-3 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) =>
          contextMenu.openAtEvent(event, startMenuContext, {
            safeArea: { left: 36, bottom: 32, right: 0 },
            ariaLabel: 'Start menu actions',
          })
        }
      >
        <div className="mb-3 flex items-center gap-2 border border-white/[0.07] bg-black/25 px-2 py-1.5">
          <Search size={11} className="shrink-0 text-[#4aa3ff]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search apps or tools…"
            className="cmd-input min-w-0 flex-1 bg-transparent text-[12px] text-[#d5e0ea] outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-[#4a5c6c] hover:text-[#c5d2de]"
              aria-label="Clear search"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <div className="os-scrollbar min-h-0 overflow-y-auto">
          {!query.trim() ? (
            <>
              <div className="mb-1.5 flex items-center justify-between px-1 font-mono text-[7.5px] uppercase tracking-[0.14em] text-os-text-dim">
                <span>Drag apps to arrange</span>
                <button onClick={resetAppOrder} className="hover:text-os-accent">
                  Reset
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {orderedApps.map((app, appIndex) => {
                  const Icon = app.icon;
                  return (
                    <button
                      key={app.id}
                      draggable
                      aria-grabbed={draggedAppId === app.id}
                      onDragStart={(event) => {
                        setDraggedAppId(app.id);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', app.id);
                      }}
                      onDragOver={(event) => {
                        if (!draggedAppId || draggedAppId === app.id) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceId = (draggedAppId ||
                          event.dataTransfer.getData('text/plain')) as SystemAppId;
                        if (sourceId) reorderApp(sourceId, app.id);
                        setDraggedAppId(null);
                      }}
                      onDragEnd={() => setDraggedAppId(null)}
                      onClick={() => {
                        onOpenSystemApp(app.id);
                        close();
                      }}
                      onContextMenu={(event) =>
                        contextMenu.openAtEvent(
                          event,
                          [
                            {
                              id: `start-${app.id}-open`,
                              label: `Open ${app.title}`,
                              icon: FolderOpen,
                              action: () => {
                                onOpenSystemApp(app.id);
                                close();
                              },
                            },
                            {
                              id: `start-${app.id}-left`,
                              label: 'Move earlier',
                              icon: ArrowLeft,
                              disabled: appIndex === 0,
                              action: () => reorderApp(app.id, orderedApps[appIndex - 1].id),
                            },
                            {
                              id: `start-${app.id}-right`,
                              label: 'Move later',
                              icon: ArrowRight,
                              disabled: appIndex === orderedApps.length - 1,
                              action: () => reorderApp(app.id, orderedApps[appIndex + 1].id),
                            },
                          ],
                          { ariaLabel: `${app.title} menu` },
                        )
                      }
                      className={`flex min-w-0 flex-col items-center gap-1.5 px-1 py-2.5 text-[#8aa0b2] transition-colors hover:bg-white/[0.04] hover:text-[#d5e4f0] rounded ${draggedAppId === app.id ? 'opacity-40' : ''}`}
                      title={app.title}
                    >
                      <Icon size={16} strokeWidth={1.4} className="text-[#8ec4ff]" />
                      <span className="w-full truncate text-center font-mono text-[8px] uppercase tracking-[0.12em]">
                        {app.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div>
              {appResults.length > 0 && (
                <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.2em] text-[#4a5c6c]">
                  Apps
                </div>
              )}
              {appResults.map((app) => {
                const Icon = app.icon;
                return (
                  <button
                    key={app.id}
                    onClick={() => {
                      onOpenSystemApp(app.id);
                      close();
                    }}
                    onContextMenu={(event) =>
                      contextMenu.openAtEvent(
                        event,
                        [
                          {
                            id: `start-search-${app.id}-open`,
                            label: `Open ${app.title}`,
                            icon: FolderOpen,
                            action: () => {
                              onOpenSystemApp(app.id);
                              close();
                            },
                          },
                        ],
                        { ariaLabel: `${app.title} menu` },
                      )
                    }
                    className="row-hover flex w-full items-center gap-2 px-2 py-1.5 text-left rounded"
                  >
                    <Icon size={13} className="text-[#4aa3ff]" />
                    <span className="text-[11px] text-[#d5e0ea]">{app.title}</span>
                  </button>
                );
              })}

              {toolResults.length > 0 && (
                <div className="mb-1 mt-3 font-mono text-[8px] uppercase tracking-[0.2em] text-[#4a5c6c]">
                  Tools
                </div>
              )}
              {toolResults.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.id}
                    onClick={() => {
                      onOpenTool(tool.id);
                      close();
                    }}
                    onContextMenu={(event) =>
                      contextMenu.openAtEvent(
                        event,
                        [
                          {
                            id: `start-tool-${tool.id}-open`,
                            label: `Open ${tool.name}`,
                            icon: FolderOpen,
                            action: () => {
                              onOpenTool(tool.id);
                              close();
                            },
                          },
                        ],
                        { ariaLabel: `${tool.name} menu` },
                      )
                    }
                    className="row-hover flex w-full items-center gap-2 px-2 py-1.5 text-left rounded"
                  >
                    <Icon size={13} className="text-[#4aa3ff]" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[#d5e0ea]">
                      {tool.name}
                    </span>
                    <span className="font-mono text-[8px] uppercase text-[#4a5c6c]">
                      {tool.category}
                    </span>
                  </button>
                );
              })}

              {!appResults.length && !toolResults.length && (
                <div className="py-8 text-center font-mono text-[9px] text-[#4a5c6c]">
                  No matches
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
