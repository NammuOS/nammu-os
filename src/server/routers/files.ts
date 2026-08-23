import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { fileMetadata } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export const filesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          path: z.string().default('/'),
          starredOnly: z.boolean().optional(),
          trashedOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const p = input?.path || '/';
      const files = await ctx.db.query.fileMetadata.findMany({
        where: eq(fileMetadata.userId, ctx.userId),
      });

      let filtered = files;
      if (input?.trashedOnly) {
        filtered = filtered.filter((f) => f.isTrashed);
      } else if (input?.starredOnly) {
        filtered = filtered.filter((f) => f.isStarred && !f.isTrashed);
      } else {
        filtered = filtered.filter((f) => !f.isTrashed && f.virtualPath.startsWith(p));
      }

      return filtered.map((f) => ({
        id: f.id,
        name: f.fileName,
        path: f.virtualPath,
        isFolder: f.isFolder,
        isStarred: f.isStarred,
        isTrashed: f.isTrashed,
        size: f.size,
        mimeType: f.mimeType,
        cloudAccountId: f.cloudAccountId,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }));
    }),

  createFolder: protectedProcedure
    .input(z.object({ name: z.string(), path: z.string().default('/') }))
    .mutation(async ({ input, ctx }) => {
      const newId = crypto.randomUUID();
      const cleanPath = input.path.endsWith('/')
        ? `${input.path}${input.name}/`
        : `${input.path}/${input.name}/`;

      await ctx.db.insert(fileMetadata).values({
        id: newId,
        userId: ctx.userId,
        virtualPath: cleanPath,
        fileName: input.name,
        isFolder: true,
        cloudAccountId: 'local-folder',
        remoteFileId: newId,
      });

      return { success: true, id: newId };
    }),

  toggleStar: protectedProcedure
    .input(z.object({ id: z.string(), isStarred: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db
        .update(fileMetadata)
        .set({ isStarred: input.isStarred })
        .where(and(eq(fileMetadata.id, input.id), eq(fileMetadata.userId, ctx.userId)));

      return { success: true };
    }),

  toggleTrash: protectedProcedure
    .input(z.object({ id: z.string(), isTrashed: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db
        .update(fileMetadata)
        .set({ isTrashed: input.isTrashed })
        .where(and(eq(fileMetadata.id, input.id), eq(fileMetadata.userId, ctx.userId)));

      return { success: true };
    }),

  deletePermanently: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db
        .delete(fileMetadata)
        .where(and(eq(fileMetadata.id, input.id), eq(fileMetadata.userId, ctx.userId)));

      return { success: true };
    }),
});
