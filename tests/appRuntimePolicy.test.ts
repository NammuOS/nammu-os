import { describe, expect, test } from 'bun:test';
import { shouldKeepWindowRuntimeAlive } from '../src/lib/appRuntimePolicy';

describe('window runtime lifecycle policy', () => {
  test('keeps stateful heavyweight runtimes mounted while minimized', () => {
    expect(shouldKeepWindowRuntimeAlive('system:browser')).toBe(true);
    expect(shouldKeepWindowRuntimeAlive('system:whatsapp')).toBe(true);
    expect(shouldKeepWindowRuntimeAlive('system:telegram')).toBe(true);
    expect(shouldKeepWindowRuntimeAlive('system:youtube-music')).toBe(true);
  });

  test('still releases ordinary application trees when minimized', () => {
    expect(shouldKeepWindowRuntimeAlive('settings')).toBe(false);
    expect(shouldKeepWindowRuntimeAlive('calculator')).toBe(false);
    expect(shouldKeepWindowRuntimeAlive('subdomain-discovery')).toBe(false);
  });
});
