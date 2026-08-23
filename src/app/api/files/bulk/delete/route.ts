import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { fileMetadata } from '@/db/schema';
import { inArray, and, eq } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: string[] = body.ids || [];

    if (ids.length > 0) {
      await db
        .delete(fileMetadata)
        .where(and(inArray(fileMetadata.id, ids), eq(fileMetadata.userId, 'local-default-user')));
    }

    return NextResponse.json({ success: true, count: ids.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
