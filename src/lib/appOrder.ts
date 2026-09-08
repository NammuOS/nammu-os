import { SYSTEM_APPS, type SystemAppId } from '../components/os/systemAppRegistry';

export const START_MENU_ORDER_KEY = 'nammu-start-menu-order';
export const START_MENU_HIDDEN_KEY = 'nammu-start-menu-hidden';
export const START_MENU_ORDER_CHANGE_EVENT = 'nammu-start-menu-order-change';

export const DEFAULT_START_MENU_ORDER: SystemAppId[] = [
  'files',
  'pdf',
  'browser',
  'youtube-music',
  'cloud',
  'projects',
  'whatsapp',
  'telegram',
  'notes',
  'maps',
  'mail',
  'calendar',
  'editor',
  'calculator',
  'qr-gen',
  'terminal',
  'ai',
  'settings',
];

function registeredIds(): SystemAppId[] {
  return SYSTEM_APPS.map((app) => app.id);
}

function normalizeIds(value: unknown, fallback: SystemAppId[]): SystemAppId[] {
  const available = registeredIds();
  const source = Array.isArray(value) ? value : fallback;
  const valid = source.filter(
    (id): id is SystemAppId => typeof id === 'string' && available.includes(id as SystemAppId),
  );
  return [...new Set([...valid, ...available])];
}

export interface StartMenuPreferences {
  order: SystemAppId[];
  hidden: SystemAppId[];
}

export function getStartMenuPreferences(): StartMenuPreferences {
  if (typeof window === 'undefined')
    return { order: normalizeIds(null, DEFAULT_START_MENU_ORDER), hidden: [] };
  try {
    const order = normalizeIds(
      JSON.parse(localStorage.getItem(START_MENU_ORDER_KEY) || 'null'),
      DEFAULT_START_MENU_ORDER,
    );
    const available = registeredIds();
    const hiddenValue = JSON.parse(localStorage.getItem(START_MENU_HIDDEN_KEY) || '[]');
    const hidden = Array.isArray(hiddenValue)
      ? hiddenValue.filter(
          (id): id is SystemAppId =>
            typeof id === 'string' && available.includes(id as SystemAppId),
        )
      : [];
    return { order, hidden: [...new Set(hidden)] };
  } catch {
    return { order: normalizeIds(null, DEFAULT_START_MENU_ORDER), hidden: [] };
  }
}

export function saveStartMenuPreferences(preferences: StartMenuPreferences): StartMenuPreferences {
  const normalized = {
    order: normalizeIds(preferences.order, DEFAULT_START_MENU_ORDER),
    hidden: preferences.hidden.filter((id) => registeredIds().includes(id)),
  };
  if (typeof window !== 'undefined') {
    localStorage.setItem(START_MENU_ORDER_KEY, JSON.stringify(normalized.order));
    localStorage.setItem(START_MENU_HIDDEN_KEY, JSON.stringify(normalized.hidden));
    window.dispatchEvent(
      new CustomEvent<StartMenuPreferences>(START_MENU_ORDER_CHANGE_EVENT, { detail: normalized }),
    );
  }
  return normalized;
}

export function reorderIds<T extends string>(values: T[], sourceId: T, targetId: T): T[] {
  if (sourceId === targetId) return values;
  const sourceIndex = values.indexOf(sourceId);
  const targetIndex = values.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return values;
  const next = [...values];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}
