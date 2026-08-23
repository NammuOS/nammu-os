import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { fileMetadata } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const file = await db.query.fileMetadata.findFirst({
      where: and(
        eq(fileMetadata.id, id),
        eq(fileMetadata.userId, 'local-default-user'),
      ),
    });

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: file.id,
        fileName: file.fileName,
        size: file.size,
        mimeType: file.mimeType,
        virtualPath: file.virtualPath,
        previewType: file.mimeType?.startsWith('image/') ? 'image' : 'document',
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
