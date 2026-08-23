import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { userSettings } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export const settingsRouter = router({
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const list = await ctx.db.query.userSettings.findMany({
      where: eq(userSettings.userId, ctx.userId),
    });
    const map: Record<string, string> = {};
    for (const item of list) {
      map[item.key] = item.value;
    }
    return map;
  }),

  set: protectedProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.userSettings.findFirst({
        where: and(eq(userSettings.userId, ctx.userId), eq(userSettings.key, input.key)),
      });

      if (existing) {
        await ctx.db
          .update(userSettings)
          .set({ value: input.value, updatedAt: new Date() })
          .where(eq(userSettings.id, existing.id));
      } else {
        await ctx.db.insert(userSettings).values({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          key: input.key,
          value: input.value,
        });
      }

      return { success: true };
    }),
});
