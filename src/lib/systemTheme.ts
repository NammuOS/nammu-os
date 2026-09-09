export const SYSTEM_THEME_IDS = ['horizon', 'cyber', 'macos', 'obsidian', 'midnight'] as const;

export type SystemTheme = (typeof SYSTEM_THEME_IDS)[number];

export const DEFAULT_SYSTEM_THEME: SystemTheme = 'horizon';
export const DEFAULT_SYSTEM_ACCENT = '#f25c0d';

const DEFAULT_THEME_MIGRATION_KEY = 'nammu-theme-default-version';
const DEFAULT_THEME_MIGRATION_VERSION = 'horizon-v1';

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function normalizeSystemTheme(value: unknown): SystemTheme {
  return typeof value === 'string' && SYSTEM_THEME_IDS.includes(value as SystemTheme)
    ? (value as SystemTheme)
    : DEFAULT_SYSTEM_THEME;
}

export function resolveInitialSystemTheme(
  value: unknown,
  storage?: ThemeStorage,
): { theme: SystemTheme; migratedLegacyDefault: boolean } {
  const theme = normalizeSystemTheme(value);
  if (!storage) return { theme, migratedLegacyDefault: false };

  try {
    const previousMigration = storage.getItem(DEFAULT_THEME_MIGRATION_KEY);
    if (previousMigration === DEFAULT_THEME_MIGRATION_VERSION) {
      return { theme, migratedLegacyDefault: false };
    }
    storage.setItem(DEFAULT_THEME_MIGRATION_KEY, DEFAULT_THEME_MIGRATION_VERSION);
    if (value === 'umbrel' || (value === 'cyber' && previousMigration === null)) {
      return { theme: DEFAULT_SYSTEM_THEME, migratedLegacyDefault: true };
    }
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }

  return { theme, migratedLegacyDefault: false };
}
