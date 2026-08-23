import { NextResponse } from 'next/server';
import { db } from '@/db';
import { fileMetadata } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST() {
  try {
    await db
      .delete(fileMetadata)
      .where(
        and(
          eq(fileMetadata.userId, 'local-default-user'),
          eq(fileMetadata.isTrashed, true),
        ),
      );

    return NextResponse.json({ success: true, message: 'Trash emptied successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
