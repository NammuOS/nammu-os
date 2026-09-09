import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SYSTEM_THEME,
  normalizeSystemTheme,
  resolveInitialSystemTheme,
} from '../src/lib/systemTheme';

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe('system theme defaults', () => {
  test('uses Horizon for missing and unknown theme values', () => {
    expect(normalizeSystemTheme(undefined)).toBe(DEFAULT_SYSTEM_THEME);
    expect(normalizeSystemTheme('removed-theme')).toBe(DEFAULT_SYSTEM_THEME);
  });

  test('preserves every registered legacy theme', () => {
    expect(normalizeSystemTheme('macos')).toBe('macos');
    expect(normalizeSystemTheme('obsidian')).toBe('obsidian');
    expect(normalizeSystemTheme('midnight')).toBe('midnight');
  });

  test('moves the inherited Cyber default once without removing Cyber', () => {
    const storage = createStorage();

    expect(resolveInitialSystemTheme('cyber', storage)).toEqual({
      theme: 'horizon',
      migratedLegacyDefault: true,
    });
    expect(resolveInitialSystemTheme('cyber', storage)).toEqual({
      theme: 'cyber',
      migratedLegacyDefault: false,
    });
  });

  test('never changes an existing non-Cyber selection during migration', () => {
    expect(resolveInitialSystemTheme('macos', createStorage())).toEqual({
      theme: 'macos',
      migratedLegacyDefault: false,
    });
  });

  test('migrates the temporary pre-release theme id to Horizon', () => {
    expect(resolveInitialSystemTheme('umbrel', createStorage())).toEqual({
      theme: 'horizon',
      migratedLegacyDefault: true,
    });
  });

  test('remains deterministic when persistent storage is unavailable', () => {
    const unavailableStorage = {
      getItem() {
        throw new Error('unavailable');
      },
      setItem() {
        throw new Error('unavailable');
      },
    };

    expect(resolveInitialSystemTheme('cyber', unavailableStorage)).toEqual({
      theme: 'cyber',
      migratedLegacyDefault: false,
    });
  });
});
