import { NextResponse } from 'next/server';
import { db } from '@/db';
import { redis } from '@/lib/redis';

export async function GET() {
  let dbStatus = 'healthy';
  let redisStatus = 'healthy';

  try {
    await db.query.users.findFirst();
  } catch (e: any) {
    dbStatus = 'degraded';
  }

  try {
    await redis.get('health_ping');
  } catch (e: any) {
    redisStatus = 'degraded';
  }

  return NextResponse.json({
    status: dbStatus === 'healthy' ? 'healthy' : 'degraded',
    version: '4.1.0',
    service: 'Nammu OS Fullstack Platform',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    db: dbStatus,
    redis: redisStatus,
  });
}
