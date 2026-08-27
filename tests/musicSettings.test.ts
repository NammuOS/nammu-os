import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_MUSIC_SETTINGS,
  areMusicSettingsEqual,
  normalizeMusicSettings,
} from '../src/lib/musicSettings';

describe('music player settings', () => {
  test('fills missing controls with product defaults', () => {
    expect(normalizeMusicSettings({ transparency: 35 })).toEqual({
      ...DEFAULT_MUSIC_SETTINGS,
      transparency: 35,
    });
  });

  test('clamps unsafe numeric values and rejects unsupported modes', () => {
    expect(
      normalizeMusicSettings({
        transparency: 500,
        blur: -20,
        playbackRate: 7,
        repeat: 'invalid' as never,
        pane: 'invalid' as never,
      }),
    ).toMatchObject({
      transparency: 70,
      blur: 0,
      playbackRate: 2,
      repeat: DEFAULT_MUSIC_SETTINGS.repeat,
      pane: DEFAULT_MUSIC_SETTINGS.pane,
    });
  });

  test('recognizes an echoed settings event as the same canonical state', () => {
    const changed = { ...DEFAULT_MUSIC_SETTINGS, playbackRate: 1.25 };
    expect(areMusicSettingsEqual(changed, { ...changed })).toBe(true);
    expect(areMusicSettingsEqual(changed, DEFAULT_MUSIC_SETTINGS)).toBe(false);
  });
});
