import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { cloudAccounts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export async function GET() {
  try {
    const list = await db.query.cloudAccounts.findMany({
      where: eq(cloudAccounts.userId, 'local-default-user'),
    });

    const formatted = list.map((acc) => ({
      id: acc.id,
      email: acc.email,
      provider: acc.provider,
      total_space: acc.totalSpace,
      used_space: acc.usedSpace,
      free_space: Math.max(0, acc.totalSpace - acc.usedSpace),
      status: acc.status,
      created_at: acc.createdAt,
      updated_at: acc.updatedAt,
    }));

    return NextResponse.json({ data: formatted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
