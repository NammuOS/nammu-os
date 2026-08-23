import { beforeEach, describe, expect, test } from 'bun:test';
import {
  calculateContextMenuPosition,
  calculateSubmenuPosition,
  resolveSafeBounds,
} from '../src/components/context-menu/contextMenuPosition';

const setViewport = (width: number, height: number) => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerWidth: width, innerHeight: height },
  });
};

describe('context menu positioning', () => {
  beforeEach(() => setViewport(1000, 800));

  test('resolves OS safe-area insets and margin', () => {
    expect(resolveSafeBounds({ left: 36, right: 200, bottom: 32, top: 4, margin: 6 })).toEqual({
      left: 42,
      top: 10,
      right: 794,
      bottom: 762,
    });
  });

  test('opens naturally down and right at screen center', () => {
    const result = calculateContextMenuPosition({
      anchorX: 400,
      anchorY: 300,
      menuWidth: 200,
      menuHeight: 180,
    });
    expect(result).toMatchObject({ left: 408, top: 308, opensLeft: false, opensUp: false });
  });

  test('flips left near the right edge', () => {
    const result = calculateContextMenuPosition({
      anchorX: 970,
      anchorY: 200,
      menuWidth: 220,
      menuHeight: 120,
    });
    expect(result.opensLeft).toBe(true);
    expect(result.left).toBe(742);
  });

  test('flips upward near the bottom edge', () => {
    const result = calculateContextMenuPosition({
      anchorX: 300,
      anchorY: 770,
      menuWidth: 180,
      menuHeight: 200,
    });
    expect(result.opensUp).toBe(true);
    expect(result.top).toBe(562);
  });

  test('flips both directions at bottom-right', () => {
    const result = calculateContextMenuPosition({
      anchorX: 980,
      anchorY: 780,
      menuWidth: 210,
      menuHeight: 190,
    });
    expect(result).toMatchObject({ opensLeft: true, opensUp: true, left: 762, top: 582 });
  });

  test('top-right opens down and left', () => {
    const result = calculateContextMenuPosition({
      anchorX: 980,
      anchorY: 4,
      menuWidth: 210,
      menuHeight: 190,
    });
    expect(result.opensLeft).toBe(true);
    expect(result.opensUp).toBe(false);
    expect(result.top).toBe(12);
  });

  test('clamps at top-left safe margin', () => {
    const result = calculateContextMenuPosition({
      anchorX: 0,
      anchorY: 0,
      menuWidth: 160,
      menuHeight: 120,
      safeArea: { left: 36, top: 0, margin: 6 },
    });
    expect(result.left).toBe(42);
    expect(result.top).toBe(8);
  });

  test('keeps an oversized menu reachable in a very small viewport', () => {
    setViewport(240, 180);
    const result = calculateContextMenuPosition({
      anchorX: 220,
      anchorY: 160,
      menuWidth: 300,
      menuHeight: 300,
      safeArea: { margin: 4 },
    });
    expect(result.left).toBe(4);
    expect(result.top).toBe(4);
  });

  test('clamps a long menu instead of allowing vertical overflow', () => {
    const result = calculateContextMenuPosition({
      anchorX: 500,
      anchorY: 300,
      menuWidth: 220,
      menuHeight: 600,
      safeArea: { bottom: 32, margin: 6 },
    });
    expect(result.top).toBeGreaterThanOrEqual(6);
    expect(result.top + 600).toBeLessThanOrEqual(762);
  });

  test('respects the taskbar and right dock safe areas', () => {
    const result = calculateContextMenuPosition({
      anchorX: 900,
      anchorY: 780,
      menuWidth: 180,
      menuHeight: 160,
      safeArea: { left: 36, right: 292, bottom: 32, margin: 6 },
    });
    expect(result.left + 180).toBeLessThanOrEqual(702);
    expect(result.top + 160).toBeLessThanOrEqual(762);
  });

  test('submenu flips to the left near the right boundary', () => {
    const parentRect = { left: 850, right: 990, top: 200, bottom: 226 } as DOMRect;
    const result = calculateSubmenuPosition({ parentRect, menuWidth: 220, menuHeight: 180 });
    expect(result.opensLeft).toBe(true);
    expect(result.left).toBe(627);
  });

  test('submenu shifts upward near the bottom boundary', () => {
    const parentRect = { left: 300, right: 480, top: 740, bottom: 766 } as DOMRect;
    const result = calculateSubmenuPosition({
      parentRect,
      menuWidth: 200,
      menuHeight: 220,
      safeArea: { bottom: 32 },
    });
    expect(result.top + 220).toBeLessThanOrEqual(762);
  });
});
