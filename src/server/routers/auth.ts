import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { users, authSessions } from '../../db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export const authRouter = router({
  getSession: publicProcedure.query(async ({ ctx }) => {
    return {
      userId: ctx.userId,
      email: ctx.email,
      isLocal: ctx.userId === 'local-default-user',
    };
  }),

  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(6) }))
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.email, input.email),
      });

      if (!user) {
        // Auto register for local/desktop workflow
        const newId = crypto.randomUUID();
        const hash = crypto.createHash('sha256').update(input.password).digest('hex');
        await ctx.db.insert(users).values({
          id: newId,
          email: input.email,
          passwordHash: hash,
          isLocal: false,
        });

        const token = crypto.randomUUID();
        await ctx.redis.set(
          `session:${token}`,
          JSON.stringify({ userId: newId, email: input.email }),
          86400 * 14,
        );
        return { success: true, token, user: { id: newId, email: input.email } };
      }

      const inputHash = crypto.createHash('sha256').update(input.password).digest('hex');
      if (user.passwordHash && user.passwordHash !== inputHash) {
        throw new Error('Invalid credentials');
      }

      const token = crypto.randomUUID();
      await ctx.redis.set(
        `session:${token}`,
        JSON.stringify({ userId: user.id, email: user.email }),
        86400 * 14,
      );
      return { success: true, token, user: { id: user.id, email: user.email } };
    }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    return { success: true };
  }),
});
