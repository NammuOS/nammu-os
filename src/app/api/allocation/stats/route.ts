import { NextResponse } from 'next/server';
import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const accounts = await db.query.cloudAccounts.findMany({
      where: eq(cloudAccounts.userId, 'local-default-user'),
    });

    const files = await db.query.fileMetadata.findMany({
      where: eq(fileMetadata.userId, 'local-default-user'),
    });

    let totalSpace = 0;
    let usedSpace = 0;

    for (const a of accounts) {
      totalSpace += a.totalSpace;
      usedSpace += a.usedSpace;
    }

    const fallbackTotal = 15 * 1024 * 1024 * 1024; // 15 GB
    const total = totalSpace || fallbackTotal;

    return NextResponse.json({
      data: {
        totalSpace: total,
        usedSpace,
        freeSpace: Math.max(0, total - usedSpace),
        accountsCount: accounts.length,
        filesCount: files.filter((f) => !f.isFolder).length,
        foldersCount: files.filter((f) => f.isFolder).length,
        providers: accounts.map((a) => ({
          provider: a.provider,
          email: a.email,
          totalSpace: a.totalSpace,
          usedSpace: a.usedSpace,
          status: a.status,
        })),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
