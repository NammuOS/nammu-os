import { SYSTEM_APPS, type SystemAppId } from '../components/os/systemAppRegistry';
import { TOOLS } from './toolRegistry';

export type RailSystemItemId = 'system:home' | 'system:search' | 'system:music';
export type RailAppItemId = `app:${SystemAppId}`;
export type RailToolItemId = `tool:${string}`;
export type RailItemId = RailSystemItemId | RailAppItemId | RailToolItemId;

export interface RailPreferences {
  order: RailItemId[];
}

export const RAIL_ORDER_KEY = 'nammu-rail-order';
export const RAIL_PREFERENCES_CHANGE_EVENT = 'nammu-rail-preferences-change';

export const DEFAULT_RAIL_ORDER: RailItemId[] = [
  'system:home',
  'app:whatsapp',
  'app:browser',
  'app:projects',
  'system:search',
  'app:files',
  'app:cloud',
  'app:ai',
  'system:music',
  'app:terminal',
];

const SYSTEM_ITEMS = new Set<RailSystemItemId>(['system:home', 'system:search', 'system:music']);

function normalizeLegacyId(value: string): string {
  if (value === 'home') return 'system:home';
  if (value === 'tools') return 'system:search';
  if (value === 'music') return 'system:music';
  if (SYSTEM_APPS.some((app) => app.id === value)) return `app:${value}`;
  if (TOOLS.some((tool) => tool.id === value)) return `tool:${value}`;
  return value;
}

export function isValidRailItemId(value: string): value is RailItemId {
  if (SYSTEM_ITEMS.has(value as RailSystemItemId)) return true;
  if (value.startsWith('app:')) {
    const id = value.slice(4);
    return SYSTEM_APPS.some((app) => app.id === id);
  }
  if (value.startsWith('tool:')) {
    const id = value.slice(5);
    return TOOLS.some((tool) => tool.id === id);
  }
  return false;
}

export function normalizeRailOrder(value: unknown, useDefault = true): RailItemId[] {
  if (!Array.isArray(value)) return useDefault ? [...DEFAULT_RAIL_ORDER] : [];
  const valid = value
    .filter((item): item is string => typeof item === 'string')
    .map(normalizeLegacyId)
    .filter(isValidRailItemId);
  return [...new Set(valid)];
}

export function getRailPreferences(): RailPreferences {
  if (typeof window === 'undefined') return { order: [...DEFAULT_RAIL_ORDER] };
  try {
    const stored = localStorage.getItem(RAIL_ORDER_KEY);
    return { order: normalizeRailOrder(stored === null ? null : JSON.parse(stored)) };
  } catch {
    return { order: [...DEFAULT_RAIL_ORDER] };
  }
}

export function saveRailPreferences(preferences: RailPreferences): RailPreferences {
  const normalized = { order: normalizeRailOrder(preferences.order, false) };
  if (typeof window !== 'undefined') {
    localStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(normalized.order));
    window.dispatchEvent(
      new CustomEvent<RailPreferences>(RAIL_PREFERENCES_CHANGE_EVENT, { detail: normalized }),
    );
  }
  return normalized;
}

export function railAppId(itemId: RailItemId): SystemAppId | null {
  return itemId.startsWith('app:') ? (itemId.slice(4) as SystemAppId) : null;
}

export function railToolId(itemId: RailItemId): string | null {
  return itemId.startsWith('tool:') ? itemId.slice(5) : null;
}
