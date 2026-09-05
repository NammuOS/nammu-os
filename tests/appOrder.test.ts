import { describe, expect, test } from 'bun:test';
import { DEFAULT_START_MENU_ORDER, reorderIds } from '../src/lib/appOrder';

describe('Start Menu ordering', () => {
  test('uses the product-defined default application order', () => {
    expect(DEFAULT_START_MENU_ORDER).toEqual([
      'files',
      'browser',
      'youtube-music',
      'cloud',
      'projects',
      'whatsapp',
      'telegram',
      'notes',
      'maps',
      'mail',
      'calendar',
      'editor',
      'calculator',
      'qr-gen',
      'terminal',
      'ai',
      'settings',
    ]);
  });

  test('moves an item without dropping other registered items', () => {
    expect(reorderIds(['files', 'browser', 'cloud'], 'cloud', 'files')).toEqual([
      'cloud',
      'files',
      'browser',
    ]);
  });
});
