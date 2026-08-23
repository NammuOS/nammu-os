import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { db } from '../db';
import { redis } from '../lib/redis';

export interface TRPCContext {
  userId: string;
  email: string;
  db: typeof db;
  redis: typeof redis;
  headers: Headers;
}

export async function createTRPCContext(opts: { headers: Headers }): Promise<TRPCContext> {
  // In local OS mode, default to local user
  const localUserId = 'local-default-user';
  const localUserEmail = 'local@cloud.nammu.os';

  // Read session cookie if present
  const cookie = opts.headers.get('cookie') || '';
  let userId = localUserId;
  let email = localUserEmail;

  if (cookie.includes('cloud_session=')) {
    const match = cookie.match(/cloud_session=([^;]+)/);
    if (match && match[1]) {
      const cached = await redis.get(`session:${match[1]}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          userId = parsed.userId || userId;
          email = parsed.email || email;
        } catch {}
      }
    }
  }

  return {
    userId,
    email,
    db,
    redis,
    headers: opts.headers,
  };
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const createCallerFactory = t.createCallerFactory;
export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You must be logged in.' });
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
    },
  });
});
