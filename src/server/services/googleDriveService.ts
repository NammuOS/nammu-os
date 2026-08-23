import { google } from 'googleapis';
import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

function parseCredentials(encrypted: string): any {
  try {
    const raw = Buffer.from(encrypted, 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/accounts/google/callback';

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function syncGoogleDrive(accountId: string) {
  const account = await db.query.cloudAccounts.findFirst({
    where: eq(cloudAccounts.id, accountId),
  });

  if (!account) return null;

  const credentials = parseCredentials(account.encryptedCredentials);
  if (!credentials) return null;

  const oauth2Client = getGoogleOAuthClient();
  oauth2Client.setCredentials(credentials);

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // 1. Get user profile and storage quota
  try {
    const aboutRes = await drive.about.get({
      fields: 'user(displayName,emailAddress),storageQuota(limit,usage)',
    });

    const email = aboutRes.data.user?.emailAddress || account.email;
    const totalSpace = Number(aboutRes.data.storageQuota?.limit || 15 * 1024 * 1024 * 1024);
    const usedSpace = Number(aboutRes.data.storageQuota?.usage || 0);

    await db
      .update(cloudAccounts)
      .set({
        email,
        totalSpace,
        usedSpace,
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(cloudAccounts.id, account.id));

    // 2. Fetch remote files and folders
    const filesRes = await drive.files.list({
      pageSize: 100,
      fields:
        'files(id, name, mimeType, size, starred, trashed, parents, createdTime, modifiedTime)',
      q: 'trashed = false',
    });

    const remoteFiles = filesRes.data.files || [];

    for (const rf of remoteFiles) {
      if (!rf.id || !rf.name) continue;

      const isFolder = rf.mimeType === 'application/vnd.google-apps.folder';
      const size = Number(rf.size || 0);
      const isStarred = Boolean(rf.starred);
      const isTrashed = Boolean(rf.trashed);
      const virtualPath = isFolder ? `/${rf.name}/` : `/${rf.name}`;

      const existing = await db.query.fileMetadata.findFirst({
        where: and(
          eq(fileMetadata.cloudAccountId, account.id),
          eq(fileMetadata.remoteFileId, rf.id),
        ),
      });

      if (existing) {
        await db
          .update(fileMetadata)
          .set({
            fileName: rf.name,
            virtualPath,
            isFolder,
            isStarred,
            isTrashed,
            size,
            mimeType: rf.mimeType || 'application/octet-stream',
            updatedAt: new Date(),
          })
          .where(eq(fileMetadata.id, existing.id));
      } else {
        await db.insert(fileMetadata).values({
          id: crypto.randomUUID(),
          userId: account.userId,
          virtualPath,
          fileName: rf.name,
          isFolder,
          isStarred,
          isTrashed,
          size,
          mimeType: rf.mimeType || 'application/octet-stream',
          cloudAccountId: account.id,
          remoteFileId: rf.id,
          remoteCreatedTime: rf.createdTime || undefined,
          remoteModifiedTime: rf.modifiedTime || undefined,
        });
      }
    }

    return {
      email,
      totalSpace,
      usedSpace,
      fileCount: remoteFiles.length,
    };
  } catch (err: any) {
    console.error('Google Drive Sync error:', err);
    return null;
  }
}
