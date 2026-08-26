import { describe, expect, test } from 'bun:test';
import { reconcileBrowserHistoryPosition } from '../src/components/browser/services/browserEngine';

describe('browser history reconciliation', () => {
  const history = ['about:home', 'https://example.com', 'https://example.org'];

  test('moves to the previous entry without duplicating it', () => {
    expect(reconcileBrowserHistoryPosition(history, 2, 'https://example.com')).toEqual({
      history,
      historyIndex: 1,
    });
  });

  test('moves to the next entry without duplicating it', () => {
    expect(reconcileBrowserHistoryPosition(history, 1, 'https://example.org')).toEqual({
      history,
      historyIndex: 2,
    });
  });

  test('truncates forward history for a genuinely new navigation', () => {
    expect(reconcileBrowserHistoryPosition(history, 1, 'https://nammu.ai')).toEqual({
      history: ['about:home', 'https://example.com', 'https://nammu.ai'],
      historyIndex: 2,
    });
  });
});
