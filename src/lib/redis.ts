import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis from 'ioredis';

export class InMemoryCache {
  private store = new Map<string, { val: string; exp: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (this.now() > item.exp) {
      this.store.delete(key);
      return null;
    }
    return item.val;
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<'OK'> {
    this.store.set(key, { val: value, exp: this.now() + ttlSeconds * 1000 });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async flush(): Promise<'OK'> {
    this.store.clear();
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    const item = await this.get(key);
    const count = (parseInt(item || '0', 10) || 0) + 1;
    await this.set(key, String(count), 60);
    return count;
  }
}

export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | string>;
  del(key: string): Promise<number>;
  flush?(): Promise<'OK'>;
  incr?(key: string): Promise<number>;
}

export type CacheBackend = 'memory' | 'upstash' | 'redis';
type CacheEnvironment = Readonly<Record<string, string | undefined>>;

export function selectCacheBackend(environment: CacheEnvironment): CacheBackend {
  if (environment.NAMMU_RUNTIME === 'desktop-local') return 'memory';
  if (environment.UPSTASH_REDIS_REST_URL && environment.UPSTASH_REDIS_REST_TOKEN) {
    return 'upstash';
  }
  if (environment.REDIS_URL) return 'redis';
  return 'memory';
}

export function createCacheClient(environment: CacheEnvironment = process.env): CacheClient {
  const backend = selectCacheBackend(environment);
  if (backend === 'memory') return new InMemoryCache();

  if (backend === 'upstash') {
    const upstash = new UpstashRedis({
      url: environment.UPSTASH_REDIS_REST_URL!,
      token: environment.UPSTASH_REDIS_REST_TOKEN!,
    });

    return {
      get: async (key: string) => {
        const res = await upstash.get<string>(key);
        return res ? (typeof res === 'string' ? res : JSON.stringify(res)) : null;
      },
      set: async (key: string, value: string, ttlSeconds = 300) => {
        return (await upstash.set(key, value, { ex: ttlSeconds })) as any;
      },
      del: async (key: string) => {
        return await upstash.del(key);
      },
      incr: async (key: string) => {
        return await upstash.incr(key);
      },
    };
  }

  const ioredis = new IORedis(environment.REDIS_URL!, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  return {
    get: (key: string) => ioredis.get(key),
    set: (key: string, value: string, ttlSeconds = 300) =>
      ioredis.set(key, value, 'EX', ttlSeconds),
    del: (key: string) => ioredis.del(key),
    incr: (key: string) => ioredis.incr(key),
  };
}

export const cacheBackend = selectCacheBackend(process.env);
export const redis = createCacheClient(process.env);
