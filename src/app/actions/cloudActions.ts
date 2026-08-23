'use server';

import { db } from '@/db';
import { fileMetadata, cloudAccounts } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { redis } from '@/lib/redis';
import crypto from 'crypto';

export async function createVirtualFolderAction(
  userId: string,
  folderName: string,
  parentPath = '/',
) {
  const cleanParent = parentPath.endsWith('/') ? parentPath : `${parentPath}/`;
  const virtualPath = `${cleanParent}${folderName}/`;
  const id = crypto.randomUUID();

  await db.insert(fileMetadata).values({
    id,
    userId,
    virtualPath,
    fileName: folderName,
    isFolder: true,
    cloudAccountId: 'local-folder',
    remoteFileId: id,
  });

  return { success: true, id, virtualPath };
}

export async function toggleFileStarAction(userId: string, fileId: string, isStarred: boolean) {
  await db
    .update(fileMetadata)
    .set({ isStarred, updatedAt: new Date() })
    .where(and(eq(fileMetadata.id, fileId), eq(fileMetadata.userId, userId)));

  return { success: true };
}

export async function toggleFileTrashAction(userId: string, fileId: string, isTrashed: boolean) {
  await db
    .update(fileMetadata)
    .set({ isTrashed, updatedAt: new Date() })
    .where(and(eq(fileMetadata.id, fileId), eq(fileMetadata.userId, userId)));

  return { success: true };
}

export async function getStorageQuotaAction(userId: string) {
  const accounts = await db.query.cloudAccounts.findMany({
    where: eq(cloudAccounts.userId, userId),
  });

  let totalSpace = 0;
  let usedSpace = 0;

  for (const acc of accounts) {
    totalSpace += acc.totalSpace;
    usedSpace += acc.usedSpace;
  }

  const fallbackTotal = 15 * 1024 * 1024 * 1024; // 15 GB default local quota
  return {
    totalSpace: totalSpace || fallbackTotal,
    usedSpace,
    freeSpace: Math.max(0, (totalSpace || fallbackTotal) - usedSpace),
    accountsCount: accounts.length,
  };
}
