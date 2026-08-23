import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { userSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const item = await db.query.userSettings.findFirst({
      where: eq(userSettings.key, 'tool_history'),
    });

    if (item && item.value) {
      return NextResponse.json(JSON.parse(item.value));
    }
    return NextResponse.json([]);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const item = await db.query.userSettings.findFirst({
      where: eq(userSettings.key, 'tool_history'),
    });

    let history: any[] = [];
    if (item && item.value) {
      try {
        history = JSON.parse(item.value);
      } catch {}
    }

    history.unshift({
      id: crypto.randomUUID(),
      ...body,
      used_at: new Date().toISOString(),
    });
    history = history.slice(0, 50);

    if (item) {
      await db
        .update(userSettings)
        .set({ value: JSON.stringify(history), updatedAt: new Date() })
        .where(eq(userSettings.id, item.id));
    } else {
      await db.insert(userSettings).values({
        id: crypto.randomUUID(),
        userId: 'local-default-user',
        key: 'tool_history',
        value: JSON.stringify(history),
      });
    }

    return NextResponse.json(history[0], { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
