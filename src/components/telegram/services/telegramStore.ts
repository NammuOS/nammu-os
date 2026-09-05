export interface TelegramAccountTab {
  id: string;
  name: string;
  color: string;
  unreadCount: number;
  isMuted: boolean;
  url: string;
}

const TABS_STORAGE_KEY = 'nammu_telegram_tabs';
const MAX_ACCOUNTS = 8;

const DEFAULT_TAB: TelegramAccountTab = {
  id: 'telegram-account-1',
  name: 'Personal Account',
  color: '#2aabee',
  unreadCount: 0,
  isMuted: false,
  url: 'https://web.telegram.org/a/',
};

function isAccountTab(value: unknown): value is TelegramAccountTab {
  if (!value || typeof value !== 'object') return false;
  const tab = value as Partial<TelegramAccountTab>;
  return (
    typeof tab.id === 'string' &&
    /^telegram-account-[a-z0-9-]+$/.test(tab.id) &&
    typeof tab.name === 'string' &&
    tab.name.trim().length > 0 &&
    tab.name.length <= 48 &&
    typeof tab.color === 'string' &&
    /^#[a-f0-9]{6}$/i.test(tab.color) &&
    typeof tab.unreadCount === 'number' &&
    Number.isFinite(tab.unreadCount) &&
    typeof tab.isMuted === 'boolean' &&
    typeof tab.url === 'string'
  );
}

export function getStoredTelegramTabs(): TelegramAccountTab[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || 'null');
    if (Array.isArray(parsed)) {
      const tabs = parsed.filter(isAccountTab).slice(0, MAX_ACCOUNTS);
      if (tabs.length > 0) return tabs;
    }
  } catch {}
  return [{ ...DEFAULT_TAB }];
}

export function saveStoredTelegramTabs(tabs: TelegramAccountTab[]): void {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs.slice(0, MAX_ACCOUNTS)));
  } catch {}
}

export { MAX_ACCOUNTS as MAX_TELEGRAM_ACCOUNTS };
