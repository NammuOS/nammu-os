import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { calendarEvents } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export const calendarRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.query.calendarEvents.findMany({
      where: eq(calendarEvents.userId, ctx.userId),
      orderBy: (e, { asc }) => [asc(e.startDate)],
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().default(''),
        startDate: z.string(),
        endDate: z.string(),
        category: z.string().default('personal'),
        color: z.string().default('#3b82f6'),
        isAllDay: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await ctx.db.insert(calendarEvents).values({
        id,
        userId: ctx.userId,
        title: input.title,
        description: input.description,
        startDate: input.startDate,
        endDate: input.endDate,
        category: input.category,
        color: input.color,
        isAllDay: input.isAllDay,
      });
      return { success: true, id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db
        .delete(calendarEvents)
        .where(and(eq(calendarEvents.id, input.id), eq(calendarEvents.userId, ctx.userId)));
      return { success: true };
    }),
});
