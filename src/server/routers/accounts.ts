import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { cloudAccounts } from '../../db/schema';
import { eq, and } from 'drizzle-orm';

export const accountsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const list = await ctx.db.query.cloudAccounts.findMany({
      where: eq(cloudAccounts.userId, ctx.userId),
    });

    return list.map((acc) => ({
      id: acc.id,
      email: acc.email,
      provider: acc.provider,
      totalSpace: acc.totalSpace,
      usedSpace: acc.usedSpace,
      status: acc.status,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt,
    }));
  }),

  disconnect: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db
        .delete(cloudAccounts)
        .where(and(eq(cloudAccounts.id, input.id), eq(cloudAccounts.userId, ctx.userId)));
      await ctx.redis.del(`storage_summary:${ctx.userId}`);
      return { success: true };
    }),

  getStorageSummary: protectedProcedure.query(async ({ ctx }) => {
    const cacheKey = `storage_summary:${ctx.userId}`;
    const cached = await ctx.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {}
    }

    const accounts = await ctx.db.query.cloudAccounts.findMany({
      where: eq(cloudAccounts.userId, ctx.userId),
    });

    let total = 0;
    let used = 0;
    for (const a of accounts) {
      total += a.totalSpace;
      used += a.usedSpace;
    }

    const res = {
      totalSpace: total || 15 * 1024 * 1024 * 1024, // 15 GB default local quota
      usedSpace: used,
      freeSpace: Math.max(0, (total || 15 * 1024 * 1024 * 1024) - used),
      accountsCount: accounts.length,
    };

    await ctx.redis.set(cacheKey, JSON.stringify(res), 60);
    return res;
  }),
});
