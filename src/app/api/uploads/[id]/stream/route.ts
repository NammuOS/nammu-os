import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: uploadId } = await params;
    const userId = 'local-default-user';
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const fileName = file.name;
    const size = file.size;
    const mimeType = file.type || 'application/octet-stream';
    const virtualPath = `/${fileName}`;

    // Get an active account
    let account = await db.query.cloudAccounts.findFirst({
      where: and(
        eq(cloudAccounts.userId, userId),
        eq(cloudAccounts.status, 'active'),
      ),
    });

    if (!account) {
      const defaultId = crypto.randomUUID();
      const defaultAccount = {
        id: defaultId,
        userId,
        email: 'local@nammu.os',
        provider: 'local',
        encryptedCredentials: Buffer.from('{}').toString('base64'),
        totalSpace: 25 * 1024 * 1024 * 1024,
        usedSpace: 0,
        status: 'active',
      };
      await db.insert(cloudAccounts).values(defaultAccount);
      account = defaultAccount as any;
    }

    const fileId = crypto.randomUUID();
    const newRecord = {
      id: fileId,
      userId,
      virtualPath,
      fileName,
      isFolder: false,
      isStarred: false,
      isTrashed: false,
      size,
      mimeType,
      cloudAccountId: account!.id,
      remoteFileId: uploadId || fileId,
    };

    await db.insert(fileMetadata).values(newRecord);

    // Update account used space
    await db
      .update(cloudAccounts)
      .set({ usedSpace: (account!.usedSpace || 0) + size, updatedAt: new Date() })
      .where(eq(cloudAccounts.id, account!.id));

    const formattedFile = {
      id: fileId,
      name: fileName,
      file_name: fileName,
      path: virtualPath,
      virtual_path: virtualPath,
      is_folder: false,
      is_starred: false,
      is_trashed: false,
      size,
      mime_type: mimeType,
      cloud_account_id: account!.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, data: formattedFile });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
