import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { fileMetadata, cloudAccounts } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { google } from 'googleapis';
import { getGoogleOAuthClient } from '@/server/services/googleDriveService';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const file = await db.query.fileMetadata.findFirst({
      where: and(
        eq(fileMetadata.id, id),
        eq(fileMetadata.userId, 'local-default-user'),
      ),
    });

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    if (file.cloudAccountId) {
      const account = await db.query.cloudAccounts.findFirst({
        where: eq(cloudAccounts.id, file.cloudAccountId),
      });

      if (account && (account.provider === 'google_drive' || account.provider === 'google')) {
        try {
          const raw = Buffer.from(account.encryptedCredentials, 'base64').toString('utf8');
          const tokens = JSON.parse(raw);
          const oauth2Client = getGoogleOAuthClient();
          oauth2Client.setCredentials(tokens);
          const drive = google.drive({ version: 'v3', auth: oauth2Client });

          const response = await drive.files.get(
            { fileId: file.remoteFileId, alt: 'media' },
            { responseType: 'arraybuffer' },
          );

          return new NextResponse(Buffer.from(response.data as ArrayBuffer), {
            headers: {
              'Content-Type': file.mimeType || 'application/octet-stream',
              'Content-Disposition': `attachment; filename="${encodeURIComponent(file.fileName)}"`,
            },
          });
        } catch (downloadErr) {
          console.error('Google Drive download error:', downloadErr);
        }
      }
    }

    const content = Buffer.from(
      `Sample content for file: ${file.fileName}\nSize: ${file.size} bytes`,
    );
    return new NextResponse(content, {
      headers: {
        'Content-Type': file.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.fileName)}"`,
        'Content-Length': content.length.toString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
