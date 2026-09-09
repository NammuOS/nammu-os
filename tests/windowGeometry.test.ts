import { describe, expect, test } from 'bun:test';
import { getDefaultWindowBounds, getDesktopLeftInset } from '../src/lib/windowGeometry';

describe('default window geometry', () => {
  test('uses the established desktop opening size and position', () => {
    expect(getDefaultWindowBounds(1440, 900)).toEqual({
      x: 288,
      y: 190,
      width: 900,
      height: 560,
    });
  });

  test('fits the default bounds into a smaller workspace', () => {
    expect(getDefaultWindowBounds(800, 600)).toEqual({
      x: 60,
      y: 190,
      width: 716,
      height: 362,
    });
  });

  test('accounts for the optional right-side panel without changing the rule', () => {
    expect(getDefaultWindowBounds(1440, 900, 292)).toEqual({
      x: 142,
      y: 190,
      width: 900,
      height: 560,
    });
  });

  test('lets Horizon windows reach the real desktop edge while preserving legacy rails', () => {
    expect(getDesktopLeftInset('horizon')).toBe(0);
    expect(getDesktopLeftInset('cyber')).toBe(36);
    expect(getDesktopLeftInset('macos')).toBe(36);
    expect(getDesktopLeftInset()).toBe(36);
  });
});
