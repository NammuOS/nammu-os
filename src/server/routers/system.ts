import { router, publicProcedure } from '../trpc';

export const systemRouter = router({
  health: publicProcedure.query(async ({ ctx }) => {
    let dbStatus = 'ok';
    let redisStatus = 'ok';

    try {
      await ctx.db.query.users.findFirst();
    } catch {
      dbStatus = 'unreachable';
    }

    try {
      await ctx.redis.get('health_check');
    } catch {
      redisStatus = 'unreachable';
    }

    return {
      status: dbStatus === 'ok' ? 'healthy' : 'degraded',
      version: '4.1.0',
      uptime: process.uptime(),
      db: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };
  }),
});
