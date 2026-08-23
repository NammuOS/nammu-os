import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis from 'ioredis';

class InMemoryCache {
  private store = new Map<string, { val: string; exp: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.exp) {
      this.store.delete(key);
      return null;
    }
    return item.val;
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<'OK'> {
    this.store.set(key, { val: value, exp: Date.now() + ttlSeconds * 1000 });
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

let cacheClient: CacheClient;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const upstash = new UpstashRedis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  cacheClient = {
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
} else if (process.env.REDIS_URL) {
  const ioredis = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  cacheClient = {
    get: (key: string) => ioredis.get(key),
    set: (key: string, value: string, ttlSeconds = 300) =>
      ioredis.set(key, value, 'EX', ttlSeconds),
    del: (key: string) => ioredis.del(key),
    incr: (key: string) => ioredis.incr(key),
  };
} else {
  cacheClient = new InMemoryCache();
}

export const redis = cacheClient;
