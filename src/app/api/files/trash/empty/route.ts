import { NextResponse } from 'next/server';

import { emptyCloudTrash } from '@/server/services/cloudMutationService';

export async function POST() {
  try {
    await emptyCloudTrash();
    return NextResponse.json({ success: true, message: 'Trash emptied successfully.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to empty cloud trash.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
