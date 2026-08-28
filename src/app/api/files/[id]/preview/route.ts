import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { createCloudAdapter } from '@/server/adapters/adapterFactory';
import { getGoogleDriveClient, isGoogleProvider } from '@/server/services/googleDriveService';

const GOOGLE_PREVIEW_EXPORTS: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const file = await db.query.fileMetadata.findFirst({
      where: and(eq(fileMetadata.id, id), eq(fileMetadata.userId, 'local-default-user')),
    });
    if (!file) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    if (file.isFolder) {
      return NextResponse.json({ error: 'Folders do not have a file preview.' }, { status: 400 });
    }

    const account = await db.query.cloudAccounts.findFirst({
      where: eq(cloudAccounts.id, file.cloudAccountId),
    });
    if (!account) {
      return NextResponse.json(
        { error: 'This file’s storage provider is unavailable.' },
        { status: 409 },
      );
    }

    if (!isGoogleProvider(account.provider)) {
      const stream = await createCloudAdapter(account).download(file);
      return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
        headers: {
          'Content-Type': file.mimeType || 'application/octet-stream',
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
          ...(file.size > 0 ? { 'Content-Length': String(file.size) } : {}),
        },
      });
    }

    const drive = await getGoogleDriveClient(account);
    const exportMimeType = GOOGLE_PREVIEW_EXPORTS[file.mimeType || ''];
    let data: ArrayBuffer;
    let mimeType = file.mimeType || 'application/octet-stream';
    let contentRange: string | undefined;

    if (exportMimeType) {
      const response = await drive.files.export(
        { fileId: file.remoteFileId, mimeType: exportMimeType },
        { responseType: 'arraybuffer' },
      );
      data = response.data as ArrayBuffer;
      mimeType = exportMimeType;
    } else {
      const range = req.headers.get('range') || undefined;
      const response = await drive.files.get(
        { fileId: file.remoteFileId, alt: 'media' },
        {
          responseType: 'arraybuffer',
          ...(range ? { headers: { Range: range } } : {}),
        },
      );
      data = response.data as ArrayBuffer;
      const header = response.headers['content-range'];
      contentRange = Array.isArray(header) ? header[0] : header;
    }

    const content = Buffer.from(data);
    return new NextResponse(content, {
      status: contentRange ? 206 : 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(content.length),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Accept-Ranges': 'bytes',
        ...(contentRange ? { 'Content-Range': contentRange } : {}),
      },
    });
  } catch (error) {
    console.error('Cloud preview failed:', error);
    const message = error instanceof Error ? error.message : 'Preview failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
