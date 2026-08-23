import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { cloudAccounts } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = 'local-default-user';

    // Find accounts
    let accounts = await db.query.cloudAccounts.findMany({
      where: and(
        eq(cloudAccounts.userId, userId),
        eq(cloudAccounts.status, 'active'),
      ),
    });

    // If no account exists, create a default local virtual storage account
    if (accounts.length === 0) {
      const defaultId = crypto.randomUUID();
      const defaultAccount = {
        id: defaultId,
        userId,
        email: 'local@nammu.os',
        provider: 'local',
        encryptedCredentials: Buffer.from('{}').toString('base64'),
        totalSpace: 25 * 1024 * 1024 * 1024, // 25 GB default
        usedSpace: 0,
        status: 'active',
      };
      await db.insert(cloudAccounts).values(defaultAccount);
      accounts = [defaultAccount as any];
    }

    const selectedAccount = accounts[0];
    const uploadId = crypto.randomUUID();

    return NextResponse.json({
      uploadId,
      accountId: selectedAccount.id,
      data: {
        uploadId,
        accountId: selectedAccount.id,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
