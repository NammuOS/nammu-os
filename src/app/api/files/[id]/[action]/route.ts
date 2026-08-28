import { NextRequest, NextResponse } from 'next/server';

import {
  deleteCloudFilePermanently,
  emptyCloudTrash,
  renameCloudFile,
  starCloudFile,
  trashCloudFile,
} from '@/server/services/cloudMutationService';

async function handleAction(req: NextRequest, params: Promise<{ id: string; action: string }>) {
  try {
    const { id, action } = await params;
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {}

    if ((id === 'trash' && action === 'empty') || action === 'empty-trash') {
      await emptyCloudTrash();
      return NextResponse.json({ success: true, message: 'Trash emptied.' });
    }
    if (action === 'restore') {
      await trashCloudFile(id, false);
      return NextResponse.json({ success: true });
    }
    if (action === 'permanent' || action === 'delete') {
      await deleteCloudFilePermanently(id);
      return NextResponse.json({ success: true });
    }
    if (action === 'rename') {
      const newName = String(body.name || body.fileName || '');
      await renameCloudFile(id, newName);
      return NextResponse.json({ success: true });
    }
    if (action === 'star') {
      await starCloudFile(id, body.is_starred === undefined ? true : Boolean(body.is_starred));
      return NextResponse.json({ success: true });
    }
    if (action === 'trash') {
      await trashCloudFile(id, body.is_trashed === undefined ? true : Boolean(body.is_trashed));
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cloud file operation failed.';
    return NextResponse.json({ error: message }, { status: 500 });
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
