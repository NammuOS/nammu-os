import { describe, expect, test } from 'bun:test';
import { DEFAULT_ICON_SETTINGS, normalizeIconSettings } from '../src/lib/iconSettings';

describe('global icon settings', () => {
  test('fills missing controls with stable defaults', () => {
    expect(normalizeIconSettings({ iconScale: 115 })).toEqual({
      ...DEFAULT_ICON_SETTINGS,
      iconScale: 115,
    });
  });

  test('clamps unsafe visual values', () => {
    expect(
      normalizeIconSettings({ iconScale: 400, iconStrokeWidth: 0, iconHoverScale: 70 }),
    ).toMatchObject({ iconScale: 135, iconStrokeWidth: 1, iconHoverScale: 100 });
  });
});
