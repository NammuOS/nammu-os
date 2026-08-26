import { describe, expect, test } from 'bun:test';
import { getDefaultWindowBounds } from '../src/lib/windowGeometry';

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
});
