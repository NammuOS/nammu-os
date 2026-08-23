import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { userSettings } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET() {
  try {
    const list = await db.query.userSettings.findMany({
      where: eq(userSettings.userId, 'local-default-user'),
    });

    const map: Record<string, string> = {};
    for (const item of list) {
      map[item.key] = item.value;
    }

    return NextResponse.json({ data: map });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { key, value } = body;

    if (!key) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }

    const valStr = typeof value === 'string' ? value : JSON.stringify(value);
    const existing = await db.query.userSettings.findFirst({
      where: and(eq(userSettings.userId, 'local-default-user'), eq(userSettings.key, key)),
    });

    if (existing) {
      await db
        .update(userSettings)
        .set({ value: valStr, updatedAt: new Date() })
        .where(eq(userSettings.id, existing.id));
    } else {
      await db.insert(userSettings).values({
        id: crypto.randomUUID(),
        userId: 'local-default-user',
        key,
        value: valStr,
      });
    }

    return NextResponse.json({ success: true, key, value: valStr });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
