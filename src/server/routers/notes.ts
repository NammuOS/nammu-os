import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { notes } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export const notesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.query.notes.findMany({
      where: eq(notes.userId, ctx.userId),
      orderBy: (n, { desc }) => [desc(n.updatedAt)],
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        content: z.string().default(''),
        folder: z.string().default('Notes'),
        tags: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await ctx.db.insert(notes).values({
        id,
        userId: ctx.userId,
        title: input.title,
        content: input.content,
        folder: input.folder,
        tags: JSON.stringify(input.tags),
      });
      return { success: true, id };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        folder: z.string().optional(),
        tags: z.array(z.string()).optional(),
        isPinned: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const updateData: any = { updatedAt: new Date() };
      if (input.title !== undefined) updateData.title = input.title;
      if (input.content !== undefined) updateData.content = input.content;
      if (input.folder !== undefined) updateData.folder = input.folder;
      if (input.tags !== undefined) updateData.tags = JSON.stringify(input.tags);
      if (input.isPinned !== undefined) updateData.isPinned = input.isPinned;

      await ctx.db
        .update(notes)
        .set(updateData)
        .where(and(eq(notes.id, input.id), eq(notes.userId, ctx.userId)));

      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.delete(notes).where(and(eq(notes.id, input.id), eq(notes.userId, ctx.userId)));
      return { success: true };
    }),
});
