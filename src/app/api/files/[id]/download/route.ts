import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { createCloudAdapter } from '@/server/adapters/adapterFactory';
import { getGoogleDriveClient, isGoogleProvider } from '@/server/services/googleDriveService';

const GOOGLE_EXPORTS: Record<string, { extension: string; mimeType: string }> = {
  'application/vnd.google-apps.document': {
    extension: '.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  'application/vnd.google-apps.spreadsheet': {
    extension: '.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  'application/vnd.google-apps.presentation': {
    extension: '.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  'application/vnd.google-apps.drawing': {
    extension: '.pdf',
    mimeType: 'application/pdf',
  },
};

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const file = await db.query.fileMetadata.findFirst({
      where: and(eq(fileMetadata.id, id), eq(fileMetadata.userId, 'local-default-user')),
    });
    if (!file) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    if (file.isFolder) {
      return NextResponse.json(
        { error: 'Folders cannot be downloaded as a single file.' },
        { status: 400 },
      );
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
          'Content-Disposition': contentDisposition(file.fileName),
          ...(file.size > 0 ? { 'Content-Length': String(file.size) } : {}),
        },
      });
    }

    const drive = await getGoogleDriveClient(account);
    const exportConfig = GOOGLE_EXPORTS[file.mimeType || ''];
    let payload: ArrayBuffer;
    let mimeType = file.mimeType || 'application/octet-stream';
    let fileName = file.fileName;

    if (exportConfig) {
      const response = await drive.files.export(
        { fileId: file.remoteFileId, mimeType: exportConfig.mimeType },
        { responseType: 'arraybuffer' },
      );
      payload = response.data as ArrayBuffer;
      mimeType = exportConfig.mimeType;
      if (!fileName.toLowerCase().endsWith(exportConfig.extension)) {
        fileName += exportConfig.extension;
      }
    } else {
      const response = await drive.files.get(
        { fileId: file.remoteFileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );
      payload = response.data as ArrayBuffer;
    }

    const content = Buffer.from(payload);
    return new NextResponse(content, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': contentDisposition(fileName),
        'Content-Length': String(content.length),
      },
    });
  } catch (error) {
    console.error('Cloud download failed:', error);
    const message = error instanceof Error ? error.message : 'Download failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
