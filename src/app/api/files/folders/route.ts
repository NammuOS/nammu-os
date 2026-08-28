import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { createCloudAdapter, isImplementedCloudProvider } from '@/server/adapters/adapterFactory';
import { normalizeVirtualPath, validateCloudFileName } from '@/server/services/googleDriveService';
import { selectMostFree, withFreeSpace } from '@/server/services/spaceAllocator';

const USER_ID = 'local-default-user';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const folderName = validateCloudFileName(String(body.folder_name || body.name || ''));
    const virtualPath = normalizeVirtualPath(body.virtual_path || body.path || '/');
    const requestedAccountId = body.account_id ? String(body.account_id) : null;
    const accounts = await db.query.cloudAccounts.findMany({
      where: and(eq(cloudAccounts.userId, USER_ID), eq(cloudAccounts.status, 'active')),
    });
    const supportedAccounts = accounts.filter((candidate) =>
      isImplementedCloudProvider(candidate.provider),
    );
    const candidateAccounts = requestedAccountId
      ? supportedAccounts.filter((candidate) => candidate.id === requestedAccountId)
      : supportedAccounts;
    const selected = candidateAccounts.length
      ? selectMostFree(candidateAccounts.map(withFreeSpace))
      : null;
    const account = selected
      ? candidateAccounts.find((candidate) => candidate.id === selected.id)
      : null;

    if (!account) {
      return NextResponse.json(
        {
          error: requestedAccountId
            ? 'The selected cloud account is not active or is no longer connected.'
            : 'Connect an active supported cloud account before creating a folder.',
        },
        { status: 409 },
      );
    }

    const remote = await createCloudAdapter(account).createFolder(virtualPath, folderName);
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(fileMetadata).values({
      id,
      userId: USER_ID,
      virtualPath,
      fileName: remote.fileName,
      isFolder: true,
      isStarred: false,
      isTrashed: false,
      size: 0,
      mimeType: remote.mimeType,
      cloudAccountId: account.id,
      remoteFileId: remote.remoteFileId,
      remoteParentId: remote.remoteParentId,
      remoteCreatedTime: remote.createdTime,
      remoteModifiedTime: remote.modifiedTime,
      createdAt: remote.createdTime ? new Date(remote.createdTime) : now,
      updatedAt: remote.modifiedTime ? new Date(remote.modifiedTime) : now,
    });

    return NextResponse.json(
      {
        data: {
          id,
          name: remote.fileName,
          file_name: remote.fileName,
          path: virtualPath,
          virtual_path: virtualPath,
          is_folder: true,
          is_starred: false,
          is_trashed: false,
          size: 0,
          mime_type: remote.mimeType,
          cloud_account_id: account.id,
          remote_file_id: remote.remoteFileId,
          remote_parent_id: remote.remoteParentId,
          created_at: remote.createdTime || now.toISOString(),
          updated_at: remote.modifiedTime || now.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create the folder.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
