export interface WhatsAppAccountTab {
  id: string;
  name: string;
  phone?: string;
  color: string;
  unreadCount: number;
  isMuted: boolean;
  themeId: string;
  url: string;
}

export interface WhatsAppTheme {
  id: string;
  name: string;
  primaryColor: string;
  backgroundColor: string;
  bubbleColor: string;
  customCss?: string;
}

export const DEFAULT_WHATSAPP_THEMES: WhatsAppTheme[] = [
  {
    id: 'default-dark',
    name: 'WhatsApp Dark (Default)',
    primaryColor: '#00a884',
    backgroundColor: '#111b21',
    bubbleColor: '#005c4b',
  },
  {
    id: 'emerald-night',
    name: 'Emerald Night',
    primaryColor: '#2ee6a6',
    backgroundColor: '#0a1017',
    bubbleColor: '#0d3829',
  },
  {
    id: 'midnight-oled',
    name: 'Midnight OLED Black',
    primaryColor: '#25d366',
    backgroundColor: '#000000',
    bubbleColor: '#0a2318',
  },
  {
    id: 'discord-dark',
    name: 'Discord Blurple',
    primaryColor: '#5865f2',
    backgroundColor: '#1e1f22',
    bubbleColor: '#35373c',
  },
  {
    id: 'cyberpunk-neon',
    name: 'Cyberpunk Neon',
    primaryColor: '#00f0ff',
    backgroundColor: '#0d0f18',
    bubbleColor: '#1a1f36',
  },
];

const TABS_STORAGE_KEY = 'nammu_whatsapp_tabs';
const THEMES_STORAGE_KEY = 'nammu_whatsapp_themes';
const SETTINGS_STORAGE_KEY = 'nammu_whatsapp_settings';

export function getStoredWhatsAppTabs(): WhatsAppAccountTab[] {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [
    {
      id: 'wa-account-1',
      name: 'Personal Account',
      color: '#00a884',
      unreadCount: 0,
      isMuted: false,
      themeId: 'default-dark',
      url: 'https://web.whatsapp.com/',
    },
  ];
}

export function saveStoredWhatsAppTabs(tabs: WhatsAppAccountTab[]): void {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
  } catch {}
}

export function getStoredWhatsAppThemes(): WhatsAppTheme[] {
  try {
    const raw = localStorage.getItem(THEMES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_WHATSAPP_THEMES;
}

export function saveStoredWhatsAppThemes(themes: WhatsAppTheme[]): void {
  try {
    localStorage.setItem(THEMES_STORAGE_KEY, JSON.stringify(themes));
  } catch {}
}
