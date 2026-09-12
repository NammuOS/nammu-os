import {
  Calendar,
  Cloud,
  Folder,
  Globe,
  Layers3,
  Mail,
  MapPinned,
  Settings,
  Sparkles,
  SquareTerminal,
  StickyNote,
  Workflow,
  MessageCircle,
  Calculator,
  QrCode,
  FileText,
  Music2,
  Send,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';

export type SystemAppId =
  | 'browser'
  | 'whatsapp'
  | 'telegram'
  | 'files'
  | 'cloud'
  | 'terminal'
  | 'editor'
  | 'notes'
  | 'mail'
  | 'maps'
  | 'calendar'
  | 'settings'
  | 'projects'
  | 'ai'
  | 'calculator'
  | 'qr-gen'
  | 'youtube-music'
  | 'pdf'
  | 'app-store';

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
    title: 'Calculator',
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
    id: 'whatsapp',
    windowId: 'system:whatsapp',
    title: 'WhatsApp',
    icon: MessageCircle,
    keywords: ['whatsapp', 'chat', 'message', 'messaging', 'social', 'calls'],
  },
  {
    id: 'telegram',
    windowId: 'system:telegram',
    title: 'Telegram',
    icon: Send,
    startMenu: true,
    keywords: ['telegram', 'chat', 'message', 'messaging', 'social', 'calls', 'channels'],
  },
  {
    id: 'browser',
    windowId: 'system:browser',
    title: 'Browser',
    icon: Globe,
    keywords: ['browser', 'web', 'internet', 'proxy', 'surf'],
  },
  {
    id: 'youtube-music',
    windowId: 'system:youtube-music',
    title: 'YouTube Music',
    icon: Music2,
    startMenu: true,
    keywords: [
      'music',
      'youtube music',
      'audio',
      'songs',
      'albums',
      'artists',
      'playlists',
      'lyrics',
      'equalizer',
      'streaming',
    ],
  },
  {
    id: 'files',
    windowId: 'system:files',
    title: 'Files',
    icon: Folder,
    keywords: ['files', 'explorer', 'folder', 'directories', 'file manager', 'storage'],
  },
  {
    id: 'pdf',
    windowId: 'system:pdf',
    title: 'Nammu PDF',
    icon: FileText,
    startMenu: true,
    keywords: ['pdf', 'document', 'reader', 'editor', 'acrobat', 'pages', 'forms', 'annotate'],
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
    id: 'maps',
    windowId: 'system:maps',
    title: 'Maps',
    icon: MapPinned,
    startMenu: true,
    keywords: ['maps', 'map', 'places', 'location', 'navigation', 'directions', 'gps'],
  },
  {
    id: 'calendar',
    windowId: 'system:calendar',
    title: 'Calendar',
    icon: Calendar,
    keywords: ['calendar', 'schedule', 'events', 'agenda', 'date', 'planner'],
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
    keywords: ['projects', 'portfolio', 'showcase', 'websites', 'developer work', 'case studies'],
  },
  {
    id: 'ai',
    windowId: 'system:ai',
    title: 'Nammu AI',
    icon: Sparkles,
    startMenu: true,
    keywords: ['ai', 'nammu ai', 'copilot', 'assistant', 'chat', 'intelligence', 'bot'],
  },
  {
    id: 'app-store',
    windowId: 'system:app-store',
    title: 'App Store',
    icon: ShoppingBag,
    startMenu: true,
    keywords: ['app store', 'apps', 'applications', 'install', 'download', 'store', 'marketplace'],
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
