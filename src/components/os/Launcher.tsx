import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, Pin, Clock, LayoutGrid, Wrench, Star, type LucideIcon } from 'lucide-react';
import {
  TOOLS,
  CATEGORIES,
  findToolById,
  searchTools,
  getToolsByCategory,
  type ToolCategory,
} from '../../lib/toolRegistry';
import {
  SYSTEM_APPS,
  searchSystemApps,
  type SystemAppId,
  type SystemAppDefinition,
} from './systemAppRegistry';
import { useContextMenu } from '../context-menu/useContextMenu';
import type { ContextMenuEntry } from '../context-menu/contextMenuTypes';

interface LauncherProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenTool: (toolId: string) => void;
  onOpenSystemApp?: (appId: SystemAppId) => void;
  pinnedTools: string[];
  recentTools: string[];
  onPinTool: (toolId: string) => void;
  onUnpinTool: (toolId: string) => void;
  suggestedTools?: string[];
  searchQuery: string;
}

export type LauncherItem =
  | {
      type: 'app';
      id: SystemAppId;
      name: string;
      description: string;
      icon: LucideIcon;
      category: string;
    }
  | {
      type: 'tool';
      id: string;
      name: string;
      description: string;
      icon: LucideIcon;
      category: ToolCategory;
    };

const SYSTEM_APP_DESCRIPTIONS: Record<SystemAppId, string> = {
  calculator:
    'Complete calculator with standard, scientific, programmer, converter, date, and finance tools',
  'qr-gen': 'Vector SVG and high-resolution QR code generator Studio',
  whatsapp: 'End-to-end encrypted messaging and calls',
  browser: 'Proxy web browser with multi-tab browsing',
  files: 'File manager, workspace browser and cloud storage',
  cloud: 'Multi-cloud storage connector and account manager',
  terminal: 'Interactive command-line terminal shell',
  editor: 'Code and text editor with syntax highlighting',
  notes: 'Quick scratchpad, notes and markdown support',
  mail: 'Email client and messaging inbox',
  maps: 'Interactive maps with place search, map styles, pins, and current location',
  calendar: 'Calendar, events and scheduled tasks',
  settings: 'System configuration, appearance and performance',
  projects: 'Project directories and repository manager',
  ai: 'Nammu OS AI copilot and assistant',
};

const SYSTEM_APP_ITEMS: LauncherItem[] = SYSTEM_APPS.map((app: SystemAppDefinition) => ({
  type: 'app',
  id: app.id,
  name: app.title,
  description: SYSTEM_APP_DESCRIPTIONS[app.id] || 'System application',
  icon: app.icon,
  category: 'System App',
}));

const TOOL_ITEMS: LauncherItem[] = TOOLS.map((tool) => ({
  type: 'tool',
  id: tool.id,
  name: tool.name,
  description: tool.description,
  icon: tool.icon,
  category: tool.category,
}));

export default function Launcher({
  isOpen,
  onClose,
  onOpenTool,
  onOpenSystemApp,
  pinnedTools,
  recentTools,
  onPinTool,
  onUnpinTool,
  suggestedTools,
  searchQuery,
}: LauncherProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'tools' | 'pinned' | 'recent'>('all');
  const [activeCategory, setActiveCategory] = useState<ToolCategory | 'all'>('all');
  const contextMenu = useContextMenu();

  const rawDisplayedItems = useMemo<LauncherItem[]>(() => {
    // 1. Search Query
    if (searchQuery.trim()) {
      const matchedApps = searchSystemApps(searchQuery).map((app): LauncherItem => ({
        type: 'app',
        id: app.id,
        name: app.title,
        description: SYSTEM_APP_DESCRIPTIONS[app.id] || 'System application',
        icon: app.icon,
        category: 'System App',
      }));
      const matchedTools = searchTools(searchQuery).map((tool): LauncherItem => ({
        type: 'tool',
        id: tool.id,
        name: tool.name,
        description: tool.description,
        icon: tool.icon,
        category: tool.category,
      }));
      return [...matchedApps, ...matchedTools];
    }

    // 2. Pinned Tab
    if (activeTab === 'pinned') {
      const pinnedList: LauncherItem[] = [];
      for (const id of pinnedTools) {
        const app = SYSTEM_APP_ITEMS.find((a) => a.id === id || `system:${a.id}` === id);
        if (app) {
          pinnedList.push(app);
          continue;
        }
        const tool = findToolById(id);
        if (tool) {
          pinnedList.push({
            type: 'tool',
            id: tool.id,
            name: tool.name,
            description: tool.description,
            icon: tool.icon,
            category: tool.category,
          });
        }
      }
      return pinnedList;
    }

    // 3. Recent Tab
    if (activeTab === 'recent') {
      const recentList: LauncherItem[] = [];
      for (const id of recentTools) {
        const app = SYSTEM_APP_ITEMS.find((a) => a.id === id || `system:${a.id}` === id);
        if (app) {
          recentList.push(app);
          continue;
        }
        const tool = findToolById(id);
        if (tool) {
          recentList.push({
            type: 'tool',
            id: tool.id,
            name: tool.name,
            description: tool.description,
            icon: tool.icon,
            category: tool.category,
          });
        }
      }
      return recentList;
    }

    // 4. Tools Tab with Category Filter Pills
    if (activeTab === 'tools') {
      if (activeCategory && activeCategory !== 'all') {
        return getToolsByCategory(activeCategory).map((tool) => ({
          type: 'tool',
          id: tool.id,
          name: tool.name,
          description: tool.description,
          icon: tool.icon,
          category: tool.category,
        }));
      }
      if (suggestedTools && suggestedTools.length > 0) {
        const suggested = suggestedTools
          .map((id) => findToolById(id))
          .filter((t): t is NonNullable<typeof t> => t !== undefined)
          .map((t): LauncherItem => ({
            type: 'tool',
            id: t.id,
            name: t.name,
            description: t.description,
            icon: t.icon,
            category: t.category,
          }));
        if (suggested.length > 0) {
          return [...suggested, ...TOOL_ITEMS.filter((t) => !suggestedTools.includes(t.id))];
        }
      }
      return TOOL_ITEMS;
    }

    // 5. Main All Tab (Shows All System Applications)
    return SYSTEM_APP_ITEMS;
  }, [searchQuery, activeTab, activeCategory, pinnedTools, recentTools, suggestedTools]);

  const displayedItems = useMemo(
    () =>
      Array.from(
        new Map(rawDisplayedItems.map((item) => [`${item.type}:${item.id}`, item])).values(),
      ),
    [rawDisplayedItems],
  );

  const handleLaunchItem = useCallback(
    (item: LauncherItem) => {
      if (item.type === 'app') {
        if (onOpenSystemApp) onOpenSystemApp(item.id as SystemAppId);
        else onOpenTool(`system:${item.id}`);
      } else {
        onOpenTool(item.id);
      }
      onClose();
    },
    [onOpenSystemApp, onOpenTool, onClose],
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
      if (e.key === 'Enter' && isOpen && displayedItems.length > 0) {
        e.preventDefault();
        handleLaunchItem(displayedItems[0]);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, displayedItems, handleLaunchItem]);

  if (!isOpen) return null;

  const launcherMenu: ContextMenuEntry[] = [
    { id: 'launcher-header', type: 'header', label: 'Launcher' },
    {
      id: 'launcher-all',
      label: 'Show Apps',
      icon: LayoutGrid,
      checked: activeTab === 'all',
      action: () => {
        setActiveTab('all');
      },
    },
    {
      id: 'launcher-tools',
      label: 'Show tools',
      icon: Wrench,
      checked: activeTab === 'tools',
      action: () => {
        setActiveTab('tools');
        setActiveCategory('all');
      },
    },
    {
      id: 'launcher-pinned',
      label: 'Show pinned',
      icon: Pin,
      checked: activeTab === 'pinned',
      action: () => {
        setActiveTab('pinned');
      },
    },
    {
      id: 'launcher-recent',
      label: 'Show recent',
      icon: Clock,
      checked: activeTab === 'recent',
      action: () => {
        setActiveTab('recent');
      },
    },
    { id: 'launcher-sep', type: 'separator' },
    {
      id: 'launcher-close',
      label: 'Close launcher',
      icon: Search,
      shortcut: 'ESC',
      action: onClose,
    },
  ];

  return (
    <div
      className="search-launcher-shell fixed bottom-[32px] left-24 right-[292px] top-[190px] z-9999 flex items-start justify-center"
      onClick={onClose}
    >
      <div
        className="search-launcher-panel flex max-h-[58vh] w-170 max-w-[92%] flex-col overflow-hidden rounded-xl"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(event) =>
          contextMenu.openAtEvent(event, launcherMenu, { ariaLabel: 'Tool launcher menu' })
        }
      >
        {searchQuery && (
          <div className="flex items-center gap-2 border-b border-white/[0.06] bg-black/15 px-3 py-2.5 font-mono text-[9px] text-[#61788c]">
            <Search size={12} className="text-[#4aa3ff]" />
            Results for <span className="truncate text-[#dce7f2]">{searchQuery}</span>
          </div>
        )}

        {/* Top Option Tabs: All, Tools, Pinned, Recent */}
        {!searchQuery && (
          <div className="flex items-center gap-1 border-b border-white/[0.06] bg-black/15 px-3 py-2">
            <button
              onClick={() => {
                setActiveTab('all');
              }}
              className={`launcher-category-tab ${activeTab === 'all' ? 'active' : ''}`}
            >
              <LayoutGrid size={12} className="inline mr-1" /> Apps
            </button>
            <button
              onClick={() => {
                setActiveTab('tools');
                setActiveCategory('all');
              }}
              className={`launcher-category-tab ${activeTab === 'tools' ? 'active' : ''}`}
            >
              <Wrench size={12} className="inline mr-1" /> Tools
            </button>
            <button
              onClick={() => {
                setActiveTab('pinned');
              }}
              className={`launcher-category-tab ${activeTab === 'pinned' ? 'active' : ''}`}
            >
              <Pin size={12} className="inline mr-1" /> Pinned
            </button>
            <button
              onClick={() => {
                setActiveTab('recent');
              }}
              className={`launcher-category-tab ${activeTab === 'recent' ? 'active' : ''}`}
            >
              <Clock size={12} className="inline mr-1" /> Recent
            </button>
          </div>
        )}

        {/* Category Pills (Visible when Tools tab is active) with All on the left of Converters */}
        {!searchQuery && activeTab === 'tools' && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] bg-black/25 px-3 py-2">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-2.5 py-1 text-[11px] rounded-sm border transition-all ${
                activeCategory === 'all'
                  ? 'border-[#4aa3ff]/40 bg-[#4aa3ff]/15 font-medium text-[#9ecaff]'
                  : 'border-white/[0.06] bg-white/[0.01] text-[#647c90] hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-[#bcd2e4]'
              }`}
            >
              All
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-2.5 py-1 text-[11px] rounded-sm border transition-all ${
                  activeCategory === cat
                    ? 'border-[#4aa3ff]/40 bg-[#4aa3ff]/15 font-medium text-[#9ecaff]'
                    : 'border-white/[0.06] bg-white/[0.01] text-[#647c90] hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-[#bcd2e4]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Suggested items header */}
        {suggestedTools &&
          suggestedTools.length > 0 &&
          activeTab === 'tools' &&
          activeCategory === 'all' &&
          !searchQuery && (
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
              <Star size={10} className="text-[#f6c85f]" />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#d7b35f]">
                Suggested for active workspace
              </span>
            </div>
          )}

        {/* Items Grid */}
        <div className="flex-1 overflow-y-auto os-scrollbar p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {displayedItems.map((item) => {
              const Icon = item.icon;
              const isPinned = pinnedTools.includes(item.id);
              return (
                <div
                  key={`${item.type}:${item.id}`}
                  className="tool-tile group relative cursor-pointer"
                  onClick={() => handleLaunchItem(item)}
                  onContextMenu={(event) =>
                    contextMenu.openAtEvent(
                      event,
                      [
                        { id: `launcher-${item.id}-header`, type: 'header', label: item.name },
                        {
                          id: `launcher-${item.id}-open`,
                          label: 'Open',
                          icon: item.icon,
                          action: () => handleLaunchItem(item),
                        },
                        {
                          id: `launcher-${item.id}-pin`,
                          label: isPinned ? 'Unpin from taskbar' : 'Pin to taskbar',
                          icon: Pin,
                          checked: isPinned,
                          action: () => (isPinned ? onUnpinTool(item.id) : onPinTool(item.id)),
                        },
                      ],
                      { ariaLabel: `${item.name} menu` },
                    )
                  }
                >
                  <div className="flex items-start gap-2.5">
                    <div className="rounded-md border border-white/[0.06] bg-black/30 p-1.5 transition-colors group-hover:border-[#4aa3ff]/30 group-hover:bg-[#4aa3ff]/8">
                      <Icon size={18} className="text-[#4aa3ff]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[11px] font-medium text-[#dce7f2]">
                        {item.name}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[9.5px] leading-tight text-[#71889d]">
                        {item.description}
                      </div>
                      <div className="mt-1 font-mono text-[8px] uppercase tracking-wider text-[#4a6173]">
                        {item.category}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isPinned) onUnpinTool(item.id);
                      else onPinTool(item.id);
                    }}
                    className={`absolute top-2 right-2 p-1 rounded-sm opacity-0 group-hover:opacity-100 transition-all ${
                      isPinned ? 'opacity-100' : ''
                    }`}
                    title={isPinned ? 'Unpin' : 'Pin'}
                  >
                    <Pin size={10} className={isPinned ? 'text-[#4aa3ff]' : 'text-[#61788c]'} />
                  </button>
                </div>
              );
            })}
          </div>

          {displayedItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-[#71889d]">
              <Search size={24} className="mb-2 opacity-40" />
              <div className="text-xs">No matching apps or tools found</div>
              <div className="text-[10px] mt-1">Try a different search term</div>
            </div>
          )}
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-between border-t border-white/[0.06] bg-black/15 px-3 py-2 font-mono text-[8.5px] text-[#556f84]">
          <span>
            {activeTab === 'all' && `${displayedItems.length} applications`}
            {activeTab === 'tools' &&
              `${displayedItems.length} ${
                activeCategory !== 'all' ? `${activeCategory} ` : ''
              }tools`}
            {activeTab === 'pinned' && `${displayedItems.length} pinned`}
            {activeTab === 'recent' && `${displayedItems.length} recent`}
          </span>
          <span>Press ESC to close</span>
        </div>
      </div>
    </div>
  );
}
