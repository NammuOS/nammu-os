import { describe, expect, test } from 'bun:test';
import {
  normalizeHistoryEntry,
  normalizePreferences,
  normalizeSettingMutation,
} from '../src/server/services/settingsPayloads.mjs';

describe('local settings payload validation', () => {
  test('normalizes safe preferences and rejects malformed input', () => {
    expect(
      normalizePreferences({
        pinned_tools: [' browser ', 'browser', 'files'],
        settings: { density: 'compact' },
      }),
    ).toEqual({
      pinned_tools: ['browser', 'files'],
      settings: { density: 'compact' },
    });
    expect(() => normalizePreferences({ pinned_tools: 'browser' })).toThrow();
  });

  test('bounds history and setting keys', () => {
    expect(
      normalizeHistoryEntry({ tool_id: 'hash', tool_name: 'Hash', category: 'Developer' }),
    ).toEqual({ tool_id: 'hash', tool_name: 'Hash', category: 'Developer' });
    expect(() => normalizeSettingMutation({ key: '../secret', value: true })).toThrow();
    expect(normalizeSettingMutation({ key: 'appearance.theme', value: { dark: true } })).toEqual({
      key: 'appearance.theme',
      value: '{"dark":true}',
    });
  });
});
