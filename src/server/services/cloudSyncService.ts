import crypto from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { createCloudAdapter } from '@/server/adapters/adapterFactory';
import {
  decodeAccountCredentials,
  persistAccountCredentials,
  type RemoteCloudItem,
} from '@/server/adapters/cloudAdapter';
import { normalizeVirtualPath } from '@/server/services/googleDriveService';
import { syncGoogleDrive } from '@/server/services/googleDriveService';

function isAuthenticationError(error: unknown): boolean {
  const status =
    (error as { status?: number; response?: { status?: number } })?.status ??
    (error as { response?: { status?: number } })?.response?.status;
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /invalid or expired user session|\bESID\b|invalid.*token|unauthori[sz]ed|incorrect.*password|credentials.*incomplete/i.test(
    message,
  );
}

async function inBatches<T>(items: T[], task: (item: T) => Promise<unknown>) {
  for (let index = 0; index < items.length; index += 25) {
    await Promise.all(items.slice(index, index + 25).map(task));
  }
}

function validateRemoteItem(item: RemoteCloudItem): RemoteCloudItem | null {
  if (!item.remoteFileId || !item.fileName) return null;
  return {
    ...item,
    virtualPath: normalizeVirtualPath(item.virtualPath),
    size: Number(item.size || 0),
  };
}

export async function syncCloudAccount(accountId: string) {
  const account = await db.query.cloudAccounts.findFirst({
    where: eq(cloudAccounts.id, accountId),
  });
  if (!account) throw new Error('Cloud account not found.');

  if (!account.encryptedCredentials.startsWith('enc:v1:')) {
    await persistAccountCredentials(account.id, decodeAccountCredentials(account));
  }

  if (account.provider === 'google' || account.provider === 'google_drive') {
    return syncGoogleDrive(account.id);
  }

  try {
    const adapter = createCloudAdapter(account);
    const [rawItems, storage] = await Promise.all([
      adapter.fetchStructure(),
      adapter.getStorageSummary(),
    ]);
    const remoteItems = rawItems
      .map(validateRemoteItem)
      .filter((item): item is RemoteCloudItem => Boolean(item));
    const existing = await db.query.fileMetadata.findMany({
      where: eq(fileMetadata.cloudAccountId, account.id),
    });
    const byRemoteId = new Map(existing.map((file) => [file.remoteFileId, file]));

    await inBatches(remoteItems, async (remote) => {
      const current = byRemoteId.get(remote.remoteFileId);
      const values = {
        virtualPath: remote.virtualPath,
        fileName: remote.fileName,
        isFolder: remote.isFolder,
        isStarred: Boolean(remote.isStarred),
        isTrashed: false,
        size: remote.size,
        mimeType:
          remote.mimeType ||
          (remote.isFolder ? 'application/x-directory' : 'application/octet-stream'),
        remoteParentId: remote.remoteParentId || null,
        remoteCreatedTime: remote.remoteCreatedTime || null,
        remoteModifiedTime: remote.remoteModifiedTime || null,
        updatedAt: new Date(),
      };
      if (current) {
        await db.update(fileMetadata).set(values).where(eq(fileMetadata.id, current.id));
      } else {
        await db.insert(fileMetadata).values({
          id: crypto.randomUUID(),
          userId: account.userId,
          cloudAccountId: account.id,
          remoteFileId: remote.remoteFileId,
          ...values,
        });
      }
    });

    const remoteIds = new Set(remoteItems.map((item) => item.remoteFileId));
    const staleIds = existing
      .filter((file) => !file.isTrashed && !remoteIds.has(file.remoteFileId))
      .map((file) => file.id);
    for (let index = 0; index < staleIds.length; index += 500) {
      await db
        .delete(fileMetadata)
        .where(inArray(fileMetadata.id, staleIds.slice(index, index + 500)));
    }

    await db
      .update(cloudAccounts)
      .set({
        totalSpace: Number(storage.totalSpace || account.totalSpace || 0),
        usedSpace: Number(storage.usedSpace || 0),
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(cloudAccounts.id, account.id));

    return {
      email: account.email,
      totalSpace: Number(storage.totalSpace || account.totalSpace || 0),
      usedSpace: Number(storage.usedSpace || 0),
      fileCount: remoteItems.length,
      removedStaleRecords: staleIds.length,
    };
  } catch (error) {
    if (isAuthenticationError(error)) {
      await db
        .update(cloudAccounts)
        .set({ status: 'invalid_token', updatedAt: new Date() })
        .where(eq(cloudAccounts.id, account.id));
    }
    console.error(`Cloud sync failed for ${account.provider} account ${account.id}:`, error);
    throw error;
  }
}
