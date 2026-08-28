import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import decodeHeic from 'heic-decode';
import sharp from 'sharp';

import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { createCloudAdapter } from '@/server/adapters/adapterFactory';
import type { DownloadOptions } from '@/server/adapters/cloudAdapter';
import { getGoogleDriveClient, isGoogleProvider } from '@/server/services/googleDriveService';
import { resolveMimeType } from '@/server/services/mimeUtils';

const GOOGLE_PREVIEW_EXPORTS: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
};
const BROWSER_CONVERSION_TYPES = new Set(['image/heic', 'image/heif', 'image/tiff']);
const MAX_CONVERTIBLE_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_CONVERTIBLE_IMAGE_PIXELS = 40_000_000;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

interface ByteRange extends DownloadOptions {
  end: number;
  start: number;
}

function parseByteRange(value: string | null, size: number): ByteRange | null {
  if (!value || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) throw new Error('INVALID_RANGE');

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw new Error('INVALID_RANGE');
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    throw new Error('INVALID_RANGE');
  }
  return { start, end: Math.min(end, size - 1) };
}

async function streamToBuffer(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > limit) throw new Error('This image is too large to convert for preview.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function inlineHeaders(mimeType: string, fileName: string): Record<string, string> {
  return {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=60',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Content-Type': mimeType,
    'X-Content-Type-Options': 'nosniff',
  };
}

function isTextPreviewMime(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType.endsWith('+json') ||
    mimeType.endsWith('+xml') ||
    [
      'application/json',
      'application/javascript',
      'application/rtf',
      'application/sql',
      'application/x-httpd-php',
      'application/x-sh',
      'application/x-yaml',
      'application/xml',
    ].includes(mimeType)
  );
}

async function convertImageToJpeg(source: Buffer, mimeType: string): Promise<Buffer> {
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    const decoded = await decodeHeic({ buffer: source });
    if (decoded.width * decoded.height > MAX_CONVERTIBLE_IMAGE_PIXELS) {
      throw new Error('This image is too large to convert safely for preview.');
    }
    const pixels = Buffer.from(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength,
    );
    return sharp(pixels, {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    })
      .jpeg({ quality: 88, progressive: true })
      .toBuffer();
  }

  return sharp(source).rotate().jpeg({ quality: 88, progressive: true }).toBuffer();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let fileSize = 0;
  try {
    const { id } = await params;
    const file = await db.query.fileMetadata.findFirst({
      where: and(eq(fileMetadata.id, id), eq(fileMetadata.userId, 'local-default-user')),
    });
    if (!file) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    if (file.isFolder) {
      return NextResponse.json({ error: 'Folders do not have a file preview.' }, { status: 400 });
    }
    fileSize = Number(file.size || 0);

    const account = await db.query.cloudAccounts.findFirst({
      where: eq(cloudAccounts.id, file.cloudAccountId),
    });
    if (!account) {
      return NextResponse.json(
        { error: 'This file’s storage provider is unavailable.' },
        { status: 409 },
      );
    }

    const mimeType = resolveMimeType({ mime_type: file.mimeType, file_name: file.fileName });
    const exportMimeType = isGoogleProvider(account.provider)
      ? GOOGLE_PREVIEW_EXPORTS[file.mimeType || '']
      : undefined;

    if (exportMimeType) {
      const drive = await getGoogleDriveClient(account);
      const response = await drive.files.export(
        { fileId: file.remoteFileId, mimeType: exportMimeType },
        { responseType: 'arraybuffer' },
      );
      const content = Buffer.from(response.data as ArrayBuffer);
      return new NextResponse(content, {
        headers: {
          ...inlineHeaders(exportMimeType, file.fileName),
          'Accept-Ranges': 'none',
          'Content-Length': String(content.length),
        },
      });
    }

    const adapter = createCloudAdapter(account);
    if (BROWSER_CONVERSION_TYPES.has(mimeType)) {
      if (fileSize > MAX_CONVERTIBLE_IMAGE_BYTES) {
        throw new Error('This image is too large to convert for preview. Download it instead.');
      }
      const source = await streamToBuffer(
        await adapter.download(file),
        MAX_CONVERTIBLE_IMAGE_BYTES,
      );
      const image = await convertImageToJpeg(source, mimeType);
      return new NextResponse(new Uint8Array(image), {
        headers: {
          ...inlineHeaders('image/jpeg', `${file.fileName}.jpg`),
          'Accept-Ranges': 'none',
          'Content-Length': String(image.length),
        },
      });
    }

    let range = parseByteRange(req.headers.get('range'), fileSize);
    let textWasTruncated = false;
    if (!range && fileSize > MAX_TEXT_PREVIEW_BYTES && isTextPreviewMime(mimeType)) {
      range = { start: 0, end: MAX_TEXT_PREVIEW_BYTES - 1 };
      textWasTruncated = true;
    }
    const stream = await adapter.download(file, range || undefined);
    const contentLength = range ? range.end - range.start + 1 : fileSize;
    return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: req.headers.has('range') && range ? 206 : 200,
      headers: {
        ...inlineHeaders(mimeType, file.fileName),
        ...(contentLength > 0 ? { 'Content-Length': String(contentLength) } : {}),
        ...(req.headers.has('range') && range
          ? { 'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}` }
          : {}),
        ...(textWasTruncated ? { 'X-Nammu-Preview-Truncated': 'true' } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_RANGE') {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}` },
      });
    }
    console.error('Cloud preview failed:', error);
    const message = error instanceof Error ? error.message : 'Preview failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
