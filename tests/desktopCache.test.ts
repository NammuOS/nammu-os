import { describe, expect, test } from 'bun:test';
import { createCacheClient, InMemoryCache, selectCacheBackend } from '../src/lib/redis';

describe('desktop cache selection', () => {
  test('never selects an external Redis backend for desktop-local runtime', () => {
    const environment = {
      NAMMU_RUNTIME: 'desktop-local',
      REDIS_URL: 'redis://remote.invalid:6379',
      UPSTASH_REDIS_REST_URL: 'https://remote.invalid',
      UPSTASH_REDIS_REST_TOKEN: 'should-not-be-used',
    };
    expect(selectCacheBackend(environment)).toBe('memory');
    expect(createCacheClient(environment)).toBeInstanceOf(InMemoryCache);
  });

  test('provides TTL semantics without persistence', async () => {
    let now = 1_000;
    const cache = new InMemoryCache(() => now);
    await cache.set('key', 'value', 1);
    expect(await cache.get('key')).toBe('value');
    now += 1_001;
    expect(await cache.get('key')).toBeNull();
  });
});
