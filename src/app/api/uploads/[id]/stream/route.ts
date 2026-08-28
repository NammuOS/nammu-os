import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import Busboy from 'busboy';

import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { createCloudAdapter } from '@/server/adapters/adapterFactory';
import { readUploadTicket, type UploadTicket } from '@/server/services/uploadTicketService';

interface ReceivedUpload {
  directory: string;
  filePath: string;
}

async function receiveUpload(req: NextRequest, ticket: UploadTicket): Promise<ReceivedUpload> {
  const requestBody = req.body;
  if (!requestBody) throw new Error('No upload body was provided.');

  const directory = await mkdtemp(join(tmpdir(), 'nammu-cloud-upload-'));
  const filePath = join(directory, 'payload');
  let receivedBytes = 0;
  let fileWrite: Promise<void> | null = null;

  try {
    const parser = Busboy({
      headers: Object.fromEntries(req.headers.entries()),
      limits: { files: 1, fileSize: ticket.size + 1, fields: 0 },
    });

    await new Promise<void>((resolve, reject) => {
      let foundFile = false;
      parser.on('file', (fieldName, stream, info) => {
        if (foundFile || fieldName !== 'file') {
          stream.resume();
          return;
        }
        foundFile = true;
        if (info.filename !== ticket.fileName) {
          stream.resume();
          reject(new Error('The selected file does not match the upload session.'));
          return;
        }

        stream.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
        });
        fileWrite = pipeline(stream, createWriteStream(filePath, { flags: 'wx' }));
      });
      parser.once('error', reject);
      parser.once('finish', () => {
        if (!foundFile || !fileWrite) {
          reject(new Error('No file was provided.'));
          return;
        }
        resolve();
      });

      Readable.fromWeb(requestBody as unknown as import('node:stream/web').ReadableStream)
        .once('error', reject)
        .pipe(parser);
    });

    await fileWrite!;
    if (receivedBytes !== ticket.size) {
      throw new Error('The uploaded byte count does not match the selected file.');
    }
    return { directory, filePath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ticket = readUploadTicket(id);
    const received = await receiveUpload(req, ticket);

    try {
      const account = await db.query.cloudAccounts.findFirst({
        where: eq(cloudAccounts.id, ticket.accountId),
      });
      if (!account || account.status !== 'active') {
        throw new Error('The selected cloud account is no longer active.');
      }
      const adapter = createCloudAdapter(account);
      const uploaded = await adapter.upload({
        stream: createReadStream(/* turbopackIgnore: true */ received.filePath),
        fileName: ticket.fileName,
        mimeType: ticket.mimeType,
        size: ticket.size,
        virtualPath: ticket.virtualPath,
      });

      const fileId = crypto.randomUUID();
      const now = new Date();
      try {
        await db.insert(fileMetadata).values({
          id: fileId,
          userId: ticket.userId,
          virtualPath: ticket.virtualPath,
          fileName: uploaded.fileName,
          isFolder: false,
          isStarred: false,
          isTrashed: false,
          size: uploaded.size,
          mimeType: uploaded.mimeType,
          cloudAccountId: ticket.accountId,
          remoteFileId: uploaded.remoteFileId,
          remoteParentId: uploaded.remoteParentId,
          remoteCreatedTime: uploaded.createdTime,
          remoteModifiedTime: uploaded.modifiedTime,
          createdAt: uploaded.createdTime ? new Date(uploaded.createdTime) : now,
          updatedAt: uploaded.modifiedTime ? new Date(uploaded.modifiedTime) : now,
        });
      } catch (databaseError) {
        console.error(
          `${account.provider} upload ${uploaded.remoteFileId} succeeded but metadata persistence failed:`,
          databaseError,
        );
        throw new Error(
          'The file reached the provider, but Nammu Cloud could not refresh its index. Run Sync to recover it.',
        );
      }

      await db
        .update(cloudAccounts)
        .set({ usedSpace: account.usedSpace + uploaded.size, updatedAt: now })
        .where(eq(cloudAccounts.id, ticket.accountId));

      return NextResponse.json({
        success: true,
        data: {
          id: fileId,
          name: uploaded.fileName,
          file_name: uploaded.fileName,
          path: ticket.virtualPath,
          virtual_path: ticket.virtualPath,
          is_folder: false,
          is_starred: false,
          is_trashed: false,
          size: uploaded.size,
          mime_type: uploaded.mimeType,
          cloud_account_id: ticket.accountId,
          remote_file_id: uploaded.remoteFileId,
          remote_parent_id: uploaded.remoteParentId,
          created_at: uploaded.createdTime || now.toISOString(),
          updated_at: uploaded.modifiedTime || now.toISOString(),
        },
      });
    } finally {
      await rm(received.directory, { recursive: true, force: true });
    }
  } catch (error) {
    console.error('Cloud upload failed:', error);
    const message = error instanceof Error ? error.message : 'Upload failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
