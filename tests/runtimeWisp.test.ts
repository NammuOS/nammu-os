import { describe, expect, test } from 'bun:test';
import { getBrowserRuntimeUrl } from '../src/components/browser/services/geckoRuntimeUrl';

describe('Gecko runtime Wisp bootstrap', () => {
  test('places the endpoint only in the non-network fragment', () => {
    const endpoint = `ws://127.0.0.1:43127/firefox-wisp/${'a'.repeat(64)}`;
    const runtimeUrl = getBrowserRuntimeUrl(2, endpoint);
    const [networkTarget, fragment] = runtimeUrl.split('#');

    expect(networkTarget).toBe(
      '/firefox-wasm/index.html?app=1&autostart=1&url=about%3Ablank&session=2',
    );
    expect(networkTarget).not.toContain('firefox-wisp');
    expect(new URLSearchParams(fragment).get('nammu-wisp')).toBe(endpoint);
  });

  test('rejects credentialed or non-WebSocket endpoints', () => {
    expect(() => getBrowserRuntimeUrl(1, 'https://example.com/firefox-wisp/secret')).toThrow(
      'invalid Wisp endpoint',
    );
    expect(() => getBrowserRuntimeUrl(1, 'wss://user:secret@example.com/wisp')).toThrow(
      'invalid Wisp endpoint',
    );
  });
});
