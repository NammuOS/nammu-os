import { z } from 'zod';
import { router, publicProcedure } from '../trpc';

export const browserRouter = router({
  proxyFetch: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .query(async ({ input, ctx }) => {
      const cacheKey = `proxy:${input.url}`;
      const cached = await ctx.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      try {
        const response = await fetch(input.url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 NammuOS/4.1',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(10000),
        });

        const contentType = response.headers.get('content-type') || 'text/html';
        const body = await response.text();

        const result = {
          status: response.status,
          contentType,
          body,
        };

        // Cache for 2 minutes
        await ctx.redis.set(cacheKey, JSON.stringify(result), 120);
        return result;
      } catch (err: any) {
        return {
          status: 500,
          contentType: 'text/plain',
          body: `Error fetching URL: ${err.message}`,
        };
      }
    }),
});
