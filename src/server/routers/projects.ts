import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { projects } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.query.projects.findMany({
      where: eq(projects.userId, ctx.userId),
      orderBy: (p, { desc }) => [desc(p.updatedAt)],
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().default(''),
        status: z.string().default('active'),
        priority: z.string().default('medium'),
        space: z.string().default('General'),
        deadline: z.string().optional(),
        tags: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await ctx.db.insert(projects).values({
        id,
        userId: ctx.userId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        space: input.space,
        deadline: input.deadline || null,
        tags: JSON.stringify(input.tags),
        tasks: '[]',
      });
      return { success: true, id };
    }),

  updateStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db
        .update(projects)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(projects.id, input.id), eq(projects.userId, ctx.userId)));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db
        .delete(projects)
        .where(and(eq(projects.id, input.id), eq(projects.userId, ctx.userId)));
      return { success: true };
    }),
});
