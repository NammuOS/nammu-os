import { NextRequest, NextResponse } from 'next/server';

import { trashCloudFiles } from '@/server/services/cloudMutationService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id: unknown): id is string => typeof id === 'string' && Boolean(id))
      : [];
    await trashCloudFiles(ids);
    return NextResponse.json({ success: true, count: ids.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete the selected files.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
