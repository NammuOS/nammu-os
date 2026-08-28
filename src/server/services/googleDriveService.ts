import crypto from 'crypto';
import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { decryptJson, encryptJson } from '@/server/services/cryptoUtils';

const GOOGLE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const GOOGLE_PROVIDER_NAMES = new Set(['google', 'google_drive']);

type CloudAccountRecord = typeof cloudAccounts.$inferSelect;
type RemoteFile = drive_v3.Schema$File;

export interface GoogleUploadInput {
  data: Buffer | Readable;
  fileName: string;
  mimeType: string;
  size: number;
  virtualPath: string;
}

export interface GoogleUploadedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  parentId: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
}

function parseCredentials(encoded: string): Record<string, unknown> {
  try {
    const credentials = decryptJson<Record<string, unknown>>(encoded);
    if (!credentials || typeof credentials !== 'object') {
      throw new Error('Credentials are empty.');
    }
    return credentials;
  } catch {
    throw new Error('The Google Drive account credentials are invalid. Reconnect the account.');
  }
}

export function isGoogleProvider(provider: string): boolean {
  return GOOGLE_PROVIDER_NAMES.has(provider);
}

export function normalizeVirtualPath(path: string | null | undefined): string {
  const rawSegments = (path || '/').replace(/\\/g, '/').split('/').filter(Boolean);

  if (
    rawSegments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))
  ) {
    throw new Error('Invalid cloud path.');
  }

  return rawSegments.length ? `/${rawSegments.join('/')}/` : '/';
}

export function validateCloudFileName(fileName: string): string {
  const cleanName = fileName.trim();
  if (!cleanName || cleanName === '.' || cleanName === '..' || /[\0/\\]/.test(cleanName)) {
    throw new Error('The file name is invalid.');
  }
  return cleanName;
}

export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/accounts/google/callback';

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function getGoogleDriveClient(account: CloudAccountRecord) {
  if (!isGoogleProvider(account.provider)) {
    throw new Error(`Provider ${account.provider} is not a Google Drive account.`);
  }

  const credentials = parseCredentials(account.encryptedCredentials);
  const oauth2Client = getGoogleOAuthClient();
  oauth2Client.setCredentials(credentials);

  oauth2Client.on('tokens', (tokens) => {
    const nextCredentials = { ...credentials, ...tokens };
    void db
      .update(cloudAccounts)
      .set({
        encryptedCredentials: encryptJson(nextCredentials),
        updatedAt: new Date(),
      })
      .where(eq(cloudAccounts.id, account.id));
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function requireGoogleAccount(accountId: string): Promise<CloudAccountRecord> {
  const account = await db.query.cloudAccounts.findFirst({
    where: eq(cloudAccounts.id, accountId),
  });

  if (!account) throw new Error('Cloud account not found.');
  if (!isGoogleProvider(account.provider)) {
    throw new Error(`Uploads to ${account.provider} are not supported yet.`);
  }
  if (account.status !== 'active') {
    throw new Error('The Google Drive account is not active. Reconnect it and try again.');
  }
  return account;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function ensureGoogleDrivePath(
  drive: drive_v3.Drive,
  virtualPath: string,
): Promise<string> {
  const parts = normalizeVirtualPath(virtualPath).split('/').filter(Boolean);
  let parentId = 'root';

  for (const part of parts) {
    const response = await drive.files.list({
      q: `'${escapeDriveQueryValue(parentId)}' in parents and name = '${escapeDriveQueryValue(part)}' and mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and trashed = false`,
      pageSize: 2,
      spaces: 'drive',
      fields: 'files(id,name)',
    });

    const existingId = response.data.files?.[0]?.id;
    if (existingId) {
      parentId = existingId;
      continue;
    }

    const created = await drive.files.create({
      requestBody: {
        name: part,
        mimeType: GOOGLE_FOLDER_MIME_TYPE,
        parents: [parentId],
      },
      fields: 'id',
    });

    if (!created.data.id) throw new Error(`Google Drive did not create the folder “${part}”.`);
    parentId = created.data.id;
  }

  return parentId;
}

export async function uploadToGoogleDrive(
  accountId: string,
  input: GoogleUploadInput,
): Promise<GoogleUploadedFile> {
  const account = await requireGoogleAccount(accountId);
  const drive = await getGoogleDriveClient(account);
  const fileName = validateCloudFileName(input.fileName);
  const parentId = await ensureGoogleDrivePath(drive, input.virtualPath);

  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [parentId] },
    media: {
      mimeType: input.mimeType || 'application/octet-stream',
      body: Buffer.isBuffer(input.data) ? Readable.from(input.data) : input.data,
    },
    fields: 'id,name,mimeType,size,parents,createdTime,modifiedTime',
  });

  if (!response.data.id) throw new Error('Google Drive accepted the upload without a file ID.');

  return {
    id: response.data.id,
    name: response.data.name || fileName,
    mimeType: response.data.mimeType || input.mimeType || 'application/octet-stream',
    size: Number(response.data.size || input.size),
    parentId: response.data.parents?.[0] || parentId,
    createdTime: response.data.createdTime || null,
    modifiedTime: response.data.modifiedTime || null,
  };
}

export async function createGoogleDriveFolder(
  accountId: string,
  virtualPath: string,
  folderName: string,
): Promise<GoogleUploadedFile> {
  const account = await requireGoogleAccount(accountId);
  const drive = await getGoogleDriveClient(account);
  const name = validateCloudFileName(folderName);
  const parentId = await ensureGoogleDrivePath(drive, virtualPath);
  const response = await drive.files.create({
    requestBody: { name, mimeType: GOOGLE_FOLDER_MIME_TYPE, parents: [parentId] },
    fields: 'id,name,mimeType,size,parents,createdTime,modifiedTime',
  });

  if (!response.data.id) throw new Error('Google Drive did not return the new folder ID.');
  return {
    id: response.data.id,
    name: response.data.name || name,
    mimeType: GOOGLE_FOLDER_MIME_TYPE,
    size: 0,
    parentId: response.data.parents?.[0] || parentId,
    createdTime: response.data.createdTime || null,
    modifiedTime: response.data.modifiedTime || null,
  };
}

export async function updateGoogleDriveFile(
  accountId: string,
  remoteFileId: string,
  changes: { name?: string; starred?: boolean; trashed?: boolean },
): Promise<RemoteFile> {
  const account = await requireGoogleAccount(accountId);
  const drive = await getGoogleDriveClient(account);
  const requestBody = {
    ...changes,
    ...(changes.name ? { name: validateCloudFileName(changes.name) } : {}),
  };
  const response = await drive.files.update({
    fileId: remoteFileId,
    requestBody,
    fields: 'id,name,mimeType,size,starred,trashed,parents,createdTime,modifiedTime',
  });
  return response.data;
}

export async function deleteGoogleDriveFile(
  accountId: string,
  remoteFileId: string,
): Promise<void> {
  const account = await requireGoogleAccount(accountId);
  const drive = await getGoogleDriveClient(account);
  await drive.files.delete({ fileId: remoteFileId });
}

export async function emptyGoogleDriveTrash(accountId: string): Promise<void> {
  const account = await requireGoogleAccount(accountId);
  const drive = await getGoogleDriveClient(account);
  await drive.files.emptyTrash();
}

async function fetchAllDriveFiles(drive: drive_v3.Drive): Promise<RemoteFile[]> {
  const files: RemoteFile[] = [];
  let pageToken: string | undefined;

  do {
    const response = await drive.files.list({
      q: "'me' in owners",
      pageSize: 1000,
      pageToken,
      spaces: 'drive',
      orderBy: 'folder,name',
      fields:
        'nextPageToken,files(id,name,mimeType,size,starred,trashed,parents,createdTime,modifiedTime)',
    });
    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return files;
}

function buildParentPath(file: RemoteFile, byId: Map<string, RemoteFile>, rootId: string): string {
  const segments: string[] = [];
  const visited = new Set<string>();
  let parentId = file.parents?.[0];

  while (parentId && parentId !== rootId && parentId !== 'root' && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.name) segments.unshift(parent.name);
    parentId = parent.parents?.[0];
  }

  return normalizeVirtualPath(segments.length ? `/${segments.join('/')}/` : '/');
}

async function runInBatches<T>(items: T[], task: (item: T) => Promise<unknown>) {
  const batchSize = 25;
  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(task));
  }
}

export async function syncGoogleDrive(accountId: string) {
  const account = await requireGoogleAccount(accountId);
  const drive = await getGoogleDriveClient(account);

  try {
    const [aboutResponse, rootResponse, remoteFiles] = await Promise.all([
      drive.about.get({ fields: 'user(displayName,emailAddress),storageQuota(limit,usage)' }),
      drive.files.get({ fileId: 'root', fields: 'id' }),
      fetchAllDriveFiles(drive),
    ]);

    const email = aboutResponse.data.user?.emailAddress || account.email;
    const totalSpace = Number(
      aboutResponse.data.storageQuota?.limit || account.totalSpace || 15 * 1024 * 1024 * 1024,
    );
    const usedSpace = Number(aboutResponse.data.storageQuota?.usage || 0);
    const rootId = rootResponse.data.id || 'root';
    const validRemoteFiles = remoteFiles.filter(
      (file): file is RemoteFile & { id: string; name: string } => Boolean(file.id && file.name),
    );
    const byId = new Map(validRemoteFiles.map((file) => [file.id, file]));
    const existingFiles = await db.query.fileMetadata.findMany({
      where: eq(fileMetadata.cloudAccountId, account.id),
    });
    const existingByRemoteId = new Map(existingFiles.map((file) => [file.remoteFileId, file]));

    await runInBatches(validRemoteFiles, async (remoteFile) => {
      const existing = existingByRemoteId.get(remoteFile.id);
      const values = {
        virtualPath: buildParentPath(remoteFile, byId, rootId),
        fileName: remoteFile.name,
        isFolder: remoteFile.mimeType === GOOGLE_FOLDER_MIME_TYPE,
        isStarred: Boolean(remoteFile.starred),
        isTrashed: Boolean(remoteFile.trashed),
        size: Number(remoteFile.size || 0),
        mimeType: remoteFile.mimeType || 'application/octet-stream',
        remoteParentId: remoteFile.parents?.[0] || null,
        remoteCreatedTime: remoteFile.createdTime || null,
        remoteModifiedTime: remoteFile.modifiedTime || null,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(fileMetadata).set(values).where(eq(fileMetadata.id, existing.id));
      } else {
        await db.insert(fileMetadata).values({
          id: crypto.randomUUID(),
          userId: account.userId,
          cloudAccountId: account.id,
          remoteFileId: remoteFile.id,
          ...values,
        });
      }
    });

    const remoteIds = new Set(validRemoteFiles.map((file) => file.id));
    const staleIds = existingFiles
      .filter((file) => !remoteIds.has(file.remoteFileId))
      .map((file) => file.id);
    for (let index = 0; index < staleIds.length; index += 500) {
      await db
        .delete(fileMetadata)
        .where(inArray(fileMetadata.id, staleIds.slice(index, index + 500)));
    }

    await db
      .update(cloudAccounts)
      .set({ email, totalSpace, usedSpace, status: 'active', updatedAt: new Date() })
      .where(eq(cloudAccounts.id, account.id));

    return {
      email,
      totalSpace,
      usedSpace,
      fileCount: validRemoteFiles.length,
      removedStaleRecords: staleIds.length,
    };
  } catch (error) {
    const status = (error as { response?: { status?: number }; code?: number }).response?.status;
    if (status === 401 || status === 403) {
      await db
        .update(cloudAccounts)
        .set({ status: 'invalid_token', updatedAt: new Date() })
        .where(and(eq(cloudAccounts.id, account.id), eq(cloudAccounts.status, 'active')));
    }
    console.error(`Google Drive sync failed for account ${account.id}:`, error);
    throw error;
  }
}
