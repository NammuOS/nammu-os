import { NextResponse } from 'next/server';
import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { syncGoogleDrive } from '@/server/services/googleDriveService';

export async function POST() {
  try {
    const accounts = await db.query.cloudAccounts.findMany({
      where: eq(cloudAccounts.userId, 'local-default-user'),
    });

    for (const acc of accounts) {
      if (acc.provider === 'google_drive' || acc.provider === 'google') {
        try {
          await syncGoogleDrive(acc.id);
        } catch (e) {
          console.error(`Sync error for account ${acc.id}:`, e);
        }
      }
    }

    const files = await db.query.fileMetadata.findMany({
      where: and(
        eq(fileMetadata.userId, 'local-default-user'),
        eq(fileMetadata.isTrashed, false),
      ),
    });

    return NextResponse.json({
      success: true,
      message: 'Cloud accounts synchronized successfully',
      syncedAccounts: accounts.length,
      syncedFiles: files.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
