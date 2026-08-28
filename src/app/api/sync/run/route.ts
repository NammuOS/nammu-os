import { NextResponse } from 'next/server';
import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { isImplementedCloudProvider } from '@/server/adapters/adapterFactory';
import { syncCloudAccount } from '@/server/services/cloudSyncService';

export async function POST() {
  try {
    const accounts = await db.query.cloudAccounts.findMany({
      where: eq(cloudAccounts.userId, 'local-default-user'),
    });

    const results: Array<{ accountId: string; fileCount: number }> = [];
    const failures: Array<{ accountId: string; error: string }> = [];
    for (const acc of accounts) {
      if (isImplementedCloudProvider(acc.provider)) {
        try {
          const result = await syncCloudAccount(acc.id);
          results.push({ accountId: acc.id, fileCount: result.fileCount });
        } catch (e) {
          console.error(`Sync error for account ${acc.id}:`, e);
          failures.push({
            accountId: acc.id,
            error: e instanceof Error ? e.message : 'Unknown sync error',
          });
        }
      } else {
        failures.push({
          accountId: acc.id,
          error: `Provider ${acc.provider} is not implemented.`,
        });
      }
    }

    const files = await db.query.fileMetadata.findMany({
      where: and(eq(fileMetadata.userId, 'local-default-user'), eq(fileMetadata.isTrashed, false)),
    });

    return NextResponse.json(
      {
        success: failures.length === 0,
        message: failures.length
          ? 'Some cloud accounts could not be synchronized.'
          : 'Cloud accounts synchronized successfully',
        syncedAccounts: results.length,
        syncedFiles: files.length,
        results,
        failures,
        timestamp: new Date().toISOString(),
      },
      { status: failures.length ? 502 : 200 },
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
