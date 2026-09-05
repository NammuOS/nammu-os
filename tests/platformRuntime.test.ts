import { describe, expect, test } from 'bun:test';
import { detectPlatformRuntime } from '../src/platform/runtime';

describe('platform runtime detection', () => {
  test('uses the web runtime during SSR', () => {
    expect(detectPlatformRuntime(undefined)).toBe('web');
    expect(detectPlatformRuntime(null)).toBe('web');
  });

  test('uses the web runtime for ordinary browser hosts', () => {
    expect(detectPlatformRuntime({ location: { href: 'https://nammu-os.vercel.app' } })).toBe(
      'web',
    );
  });

  test('requires a functional Tauri IPC bridge', () => {
    expect(detectPlatformRuntime({ __TAURI_INTERNALS__: {} })).toBe('web');
    expect(detectPlatformRuntime({ __TAURI_INTERNALS__: { invoke: true } })).toBe('web');
    expect(
      detectPlatformRuntime({
        __TAURI_INTERNALS__: { invoke: () => Promise.resolve() },
      }),
    ).toBe('tauri');
  });

  test('does not cache an SSR decision across hydration', () => {
    expect(detectPlatformRuntime(undefined)).toBe('web');
    expect(
      detectPlatformRuntime({
        __TAURI_INTERNALS__: { invoke: () => Promise.resolve() },
      }),
    ).toBe('tauri');
  });
});
