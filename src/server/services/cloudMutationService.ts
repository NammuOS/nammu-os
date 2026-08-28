import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { createCloudAdapter } from '@/server/adapters/adapterFactory';
import { normalizeVirtualPath, validateCloudFileName } from '@/server/services/googleDriveService';

const USER_ID = 'local-default-user';

async function getFileContext(id: string) {
  const file = await db.query.fileMetadata.findFirst({
    where: and(eq(fileMetadata.id, id), eq(fileMetadata.userId, USER_ID)),
  });
  if (!file) throw new Error('Cloud file not found.');
  const account = await db.query.cloudAccounts.findFirst({
    where: eq(cloudAccounts.id, file.cloudAccountId),
  });
  if (!account) throw new Error('The file’s cloud account is unavailable.');
  return { file, account, adapter: createCloudAdapter(account) };
}

function childPath(file: typeof fileMetadata.$inferSelect): string {
  return normalizeVirtualPath(`${normalizeVirtualPath(file.virtualPath)}${file.fileName}/`);
}

async function getDescendants(file: typeof fileMetadata.$inferSelect) {
  if (!file.isFolder) return [];
  const prefix = childPath(file);
  const accountFiles = await db.query.fileMetadata.findMany({
    where: eq(fileMetadata.cloudAccountId, file.cloudAccountId),
  });
  return accountFiles.filter((candidate) =>
    normalizeVirtualPath(candidate.virtualPath).startsWith(prefix),
  );
}

async function removeLocalTree(file: typeof fileMetadata.$inferSelect): Promise<void> {
  const descendants = await getDescendants(file);
  await Promise.all(
    [file.id, ...descendants.map((descendant) => descendant.id)].map((fileId) =>
      db.delete(fileMetadata).where(eq(fileMetadata.id, fileId)),
    ),
  );
}

export async function renameCloudFile(id: string, requestedName: string): Promise<void> {
  const { file, adapter } = await getFileContext(id);
  const newName = validateCloudFileName(requestedName);
  const oldChildPath = file.isFolder ? childPath(file) : null;
  await adapter.rename(file, newName);

  const now = new Date();
  await db
    .update(fileMetadata)
    .set({ fileName: newName, updatedAt: now })
    .where(eq(fileMetadata.id, id));
  if (oldChildPath) {
    const newChildPath = normalizeVirtualPath(`${file.virtualPath}${newName}/`);
    const descendants = await getDescendants(file);
    await Promise.all(
      descendants.map((descendant) =>
        db
          .update(fileMetadata)
          .set({
            virtualPath: normalizeVirtualPath(descendant.virtualPath).replace(
              oldChildPath,
              newChildPath,
            ),
            updatedAt: now,
          })
          .where(eq(fileMetadata.id, descendant.id)),
      ),
    );
  }
}

export async function starCloudFile(id: string, isStarred: boolean): Promise<void> {
  const { file, adapter } = await getFileContext(id);
  if (adapter.capabilities.starred) await adapter.setStarred(file, isStarred);
  await db
    .update(fileMetadata)
    .set({ isStarred, updatedAt: new Date() })
    .where(eq(fileMetadata.id, file.id));
}

export async function trashCloudFile(id: string, isTrashed = true): Promise<void> {
  const { file, adapter } = await getFileContext(id);
  if (!isTrashed) {
    if (!adapter.capabilities.restore) {
      throw new Error(`${adapter.account.provider} does not support restoring deleted items.`);
    }
    await adapter.restore(file);
  } else if (!adapter.capabilities.trash) {
    await adapter.deletePermanently(file);
    await removeLocalTree(file);
    return;
  } else {
    await adapter.trash(file);
  }

  const descendants = await getDescendants(file);
  await Promise.all(
    [file.id, ...descendants.map((descendant) => descendant.id)].map((fileId) =>
      db
        .update(fileMetadata)
        .set({ isTrashed, updatedAt: new Date() })
        .where(eq(fileMetadata.id, fileId)),
    ),
  );
}

export async function deleteCloudFilePermanently(id: string): Promise<void> {
  const { file, adapter } = await getFileContext(id);
  await adapter.deletePermanently(file);
  await removeLocalTree(file);
}

export async function emptyCloudTrash(): Promise<void> {
  const trashed = await db.query.fileMetadata.findMany({
    where: and(eq(fileMetadata.userId, USER_ID), eq(fileMetadata.isTrashed, true)),
  });
  const rootItems = trashed.filter(
    (file) =>
      !trashed.some(
        (candidate) =>
          candidate.id !== file.id &&
          candidate.cloudAccountId === file.cloudAccountId &&
          candidate.isFolder &&
          normalizeVirtualPath(file.virtualPath).startsWith(childPath(candidate)),
      ),
  );
  for (const file of rootItems) await deleteCloudFilePermanently(file.id);
}

export async function trashCloudFiles(ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  for (let index = 0; index < uniqueIds.length; index += 5) {
    await Promise.all(uniqueIds.slice(index, index + 5).map((id) => trashCloudFile(id)));
  }
}
