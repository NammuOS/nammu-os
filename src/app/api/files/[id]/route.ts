import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { fileMetadata } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await db
      .delete(fileMetadata)
      .where(and(eq(fileMetadata.id, id), eq(fileMetadata.userId, 'local-default-user')));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
