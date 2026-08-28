import { NextRequest, NextResponse } from 'next/server';

import { trashCloudFile } from '@/server/services/cloudMutationService';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await trashCloudFile(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to move the file to trash.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
