import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RAIL_ORDER,
  isValidRailItemId,
  normalizeRailOrder,
} from '../src/lib/railPreferences';

describe('Rail preferences', () => {
  test('preserves the established default rail', () => {
    expect(DEFAULT_RAIL_ORDER).toEqual([
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
    ]);
  });

  test('accepts registered apps and tools while rejecting stale identifiers', () => {
    expect(isValidRailItemId('app:calendar')).toBe(true);
    expect(isValidRailItemId('tool:img-compress')).toBe(true);
    expect(isValidRailItemId('app:removed-app')).toBe(false);
    expect(isValidRailItemId('tool:removed-tool')).toBe(false);
  });

  test('migrates the legacy order without adding shortcuts the user did not choose', () => {
    expect(normalizeRailOrder(['home', 'browser', 'tools', 'music', 'browser'])).toEqual([
      'system:home',
      'app:browser',
      'system:search',
      'system:music',
    ]);
  });

  test('allows a deliberately empty custom rail', () => {
    expect(normalizeRailOrder([], false)).toEqual([]);
  });
});
