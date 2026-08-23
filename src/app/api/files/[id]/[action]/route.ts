import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { fileMetadata } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

async function handleAction(
  req: NextRequest,
  params: Promise<{ id: string; action: string }>,
) {
  try {
    const { id, action } = await params;
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    // 1. Empty Trash: /api/files/trash/empty
    if ((id === 'trash' && action === 'empty') || action === 'empty-trash') {
      await db
        .delete(fileMetadata)
        .where(
          and(
            eq(fileMetadata.userId, 'local-default-user'),
            eq(fileMetadata.isTrashed, true),
          ),
        );
      return NextResponse.json({ success: true, message: 'Trash emptied' });
    }

    // 2. Restore file: /api/files/:id/restore
    if (action === 'restore') {
      await db
        .update(fileMetadata)
        .set({ isTrashed: false, updatedAt: new Date() })
        .where(
          and(
            eq(fileMetadata.id, id),
            eq(fileMetadata.userId, 'local-default-user'),
          ),
        );
      return NextResponse.json({ success: true });
    }

    // 3. Permanent delete: /api/files/:id/permanent
    if (action === 'permanent' || action === 'delete') {
      await db
        .delete(fileMetadata)
        .where(
          and(
            eq(fileMetadata.id, id),
            eq(fileMetadata.userId, 'local-default-user'),
          ),
        );
      return NextResponse.json({ success: true });
    }

    // 4. Rename file: /api/files/:id/rename
    if (action === 'rename') {
      const newName = body.name || body.fileName;
      if (!newName) return NextResponse.json({ error: 'name is required' }, { status: 400 });

      await db
        .update(fileMetadata)
        .set({ fileName: newName, updatedAt: new Date() })
        .where(
          and(
            eq(fileMetadata.id, id),
            eq(fileMetadata.userId, 'local-default-user'),
          ),
        );

      return NextResponse.json({ success: true });
    }

    // 5. Star / Unstar: /api/files/:id/star
    if (action === 'star') {
      const isStarred = body.is_starred !== undefined ? body.is_starred : true;
      await db
        .update(fileMetadata)
        .set({ isStarred, updatedAt: new Date() })
        .where(
          and(
            eq(fileMetadata.id, id),
            eq(fileMetadata.userId, 'local-default-user'),
          ),
        );

      return NextResponse.json({ success: true });
    }

    // 6. Trash file: /api/files/:id/trash
    if (action === 'trash') {
      const isTrashed = body.is_trashed !== undefined ? body.is_trashed : true;
      await db
        .update(fileMetadata)
        .set({ isTrashed, updatedAt: new Date() })
        .where(
          and(
            eq(fileMetadata.id, id),
            eq(fileMetadata.userId, 'local-default-user'),
          ),
        );

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  return handleAction(req, params);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  return handleAction(req, params);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  return handleAction(req, params);
}
