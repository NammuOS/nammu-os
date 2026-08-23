import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { userSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const item = await db.query.userSettings.findFirst({
      where: eq(userSettings.key, 'allocation_config'),
    });

    if (item && item.value) {
      return NextResponse.json({ data: JSON.parse(item.value) });
    }

    return NextResponse.json({
      data: {
        strategy: 'round_robin', // 'round_robin' | 'fill_first' | 'spillover' | 'provider_pinned'
        chunkSizeMb: 10,
        enableRedundancy: false,
        redundancyCopies: 1,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const item = await db.query.userSettings.findFirst({
      where: eq(userSettings.key, 'allocation_config'),
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

    return NextResponse.json({ data: body });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
