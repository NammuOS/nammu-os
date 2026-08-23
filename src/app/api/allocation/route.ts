import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { userSettings } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

const DEFAULT_ALLOCATION = {
  strategy: 'round_robin',
  chunkSizeMb: 10,
  enableRedundancy: false,
  redundancyCopies: 1,
  manual_order: [],
};

export async function GET() {
  try {
    const item = await db.query.userSettings.findFirst({
      where: and(
        eq(userSettings.userId, 'local-default-user'),
        eq(userSettings.key, 'allocation_config'),
      ),
    });

    if (item && item.value) {
      return NextResponse.json({ data: JSON.parse(item.value) });
    }

    return NextResponse.json({ data: DEFAULT_ALLOCATION });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const item = await db.query.userSettings.findFirst({
      where: and(
        eq(userSettings.userId, 'local-default-user'),
        eq(userSettings.key, 'allocation_config'),
      ),
    });

    if (item) {
      await db
        .update(userSettings)
        .set({ value: JSON.stringify(body), updatedAt: new Date() })
        .where(eq(userSettings.id, item.id));
    } else {
      await db.insert(userSettings).values({
        id: crypto.randomUUID(),
        userId: 'local-default-user',
        key: 'allocation_config',
        value: JSON.stringify(body),
      });
    }

    return NextResponse.json({ success: true, data: body });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return PATCH(req);
}
