import {
  Box,
  Calendar,
  Cloud,
  Folder,
  Globe,
  Layers3,
  Mail,
  Orbit,
  Settings,
  Sparkles,
  SquareTerminal,
  StickyNote,
  TimerReset,
  Workflow,
  MessageSquare,
  Flame,
  Calculator,
  QrCode,
  type LucideIcon,
} from 'lucide-react';

export type SystemAppId =
  | 'browser'
  | 'firefox'
  | 'whatsapp'
  | 'files'
  | 'cloud'
  | 'terminal'
  | 'editor'
  | 'notes'
  | 'mail'
  | 'calendar'
  | 'orbit'
  | 'aether'
  | 'settings'
  | 'projects'
  | 'spaces'
  | 'sessions'
  | 'ai'
  | 'calculator'
  | 'qr-gen';

export interface SystemAppDefinition {
  id: SystemAppId;
  windowId: string;
  title: string;
  icon: LucideIcon;
  startMenu?: boolean;
  keywords: string[];
}

export const SYSTEM_APPS: SystemAppDefinition[] = [
  {
    id: 'calculator',
    windowId: 'system:calculator',
    title: 'Calculator Suite',
    icon: Calculator,
    startMenu: true,
    keywords: [
      'calculator',
      'calculator suite',
      'math',
      'calc',
      'scientific',
      'programmer',
      'converter',
      'finance',
      'statistics',
      'equation',
      'bmi',
      'interest',
    ],
  },
  {
    id: 'qr-gen',
    windowId: 'system:qr-gen',
    title: 'QR Studio',
    icon: QrCode,
    startMenu: true,
    keywords: ['qr', 'qr studio', 'qr code', 'barcode', 'svg qr', 'generate qr', 'scanner'],
  },
  {
    id: 'firefox',
    windowId: 'system:firefox',
    title: 'Firefox',
    icon: Flame,
    keywords: ['firefox', 'browser', 'web', 'mozilla', 'internet'],
  },
  {
    id: 'whatsapp',
    windowId: 'system:whatsapp',
    title: 'WhatsApp',
    icon: MessageSquare,
    keywords: ['whatsapp', 'chat', 'message', 'messaging', 'social', 'calls'],
  },
  {
    id: 'browser',
    windowId: 'system:browser',
    title: 'Browser',
    icon: Globe,
    keywords: ['browser', 'web', 'internet', 'proxy', 'surf'],
  },
  {
    id: 'files',
    windowId: 'system:files',
    title: 'Files',
    icon: Folder,
    keywords: ['files', 'explorer', 'folder', 'directories', 'file manager', 'storage'],
  },
  {
    id: 'cloud',
    windowId: 'system:cloud',
    title: 'Cloud',
    icon: Cloud,
    keywords: ['cloud', 'drive', 'storage', 'sync', 'remote'],
  },
  {
    id: 'terminal',
    windowId: 'system:terminal',
    title: 'Shell',
    icon: SquareTerminal,
    keywords: ['terminal', 'shell', 'bash', 'cmd', 'command', 'cli', 'powershell'],
  },
  {
    id: 'editor',
    windowId: 'system:editor',
    title: 'Editor',
    icon: Workflow,
    keywords: ['editor', 'code', 'text editor', 'ide', 'script'],
  },
  {
    id: 'notes',
    windowId: 'system:notes',
    title: 'Notes',
    icon: StickyNote,
    keywords: ['notes', 'scratchpad', 'notepad', 'markdown', 'memo', 'text'],
  },
  {
    id: 'mail',
    windowId: 'system:mail',
    title: 'Mail',
    icon: Mail,
    keywords: ['mail', 'email', 'inbox', 'messages', 'relay'],
  },
  {
    id: 'calendar',
    windowId: 'system:calendar',
    title: 'Calendar',
    icon: Calendar,
    keywords: ['calendar', 'schedule', 'events', 'agenda', 'date', 'planner'],
  },
  {
    id: 'orbit',
    windowId: 'system:orbit',
    title: 'Orbit',
    icon: Orbit,
    keywords: ['orbit', 'satellites', 'telemetry', 'downlink', 'carrier', 'graph'],
  },
  {
    id: 'aether',
    windowId: 'system:aether',
    title: 'Aether',
    icon: Box,
    keywords: ['aether', 'runtime', 'jit', 'compiler', 'spatial', '3d'],
  },
  {
    id: 'settings',
    windowId: 'system:settings',
    title: 'Settings',
    icon: Settings,
    keywords: ['settings', 'preferences', 'configuration', 'config', 'theme', 'audio', 'system'],
  },
  {
    id: 'projects',
    windowId: 'system:projects',
    title: 'Projects',
    icon: Layers3,
    startMenu: true,
    keywords: ['projects', 'environments', 'workspaces', 'tasks', 'todo', 'kanban'],
  },
  {
    id: 'spaces',
    windowId: 'system:spaces',
    title: 'Spaces',
    icon: Orbit,
    startMenu: true,
    keywords: ['spaces', 'desktops', 'modes', 'focus'],
  },
  {
    id: 'sessions',
    windowId: 'system:sessions',
    title: 'Sessions',
    icon: TimerReset,
    startMenu: true,
    keywords: ['sessions', 'state', 'snapshots', 'history'],
  },
  {
    id: 'ai',
    windowId: 'system:ai',
    title: 'Nammu AI',
    icon: Sparkles,
    startMenu: true,
    keywords: ['ai', 'nammu ai', 'copilot', 'assistant', 'chat', 'intelligence', 'bot'],
  },
];

export const START_MENU_APPS = SYSTEM_APPS.filter((app) => app.startMenu !== false);

export const searchSystemApps = (query: string): SystemAppDefinition[] => {
  if (!query.trim()) return SYSTEM_APPS;
  const q = query.toLowerCase().trim();
  return SYSTEM_APPS.filter((app) => {
    return (
      app.id.toLowerCase().includes(q) ||
      app.title.toLowerCase().includes(q) ||
      app.keywords.some((k) => k.toLowerCase().includes(q))
    );
  });
};

export const findSystemApp = (id: SystemAppId) => SYSTEM_APPS.find((app) => app.id === id);
export const findSystemAppByWindowId = (windowId: string) =>
  SYSTEM_APPS.find((app) => app.windowId === windowId);
