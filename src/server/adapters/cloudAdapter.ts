import { Readable, Transform } from 'node:stream';

import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { decryptJson, encryptJson } from '@/server/services/cryptoUtils';
import { eq } from 'drizzle-orm';

export type CloudAccountRecord = typeof cloudAccounts.$inferSelect;
export type CloudFileRecord = typeof fileMetadata.$inferSelect;

export interface RemoteCloudItem {
  fileName: string;
  isFolder: boolean;
  isStarred?: boolean;
  mimeType?: string | null;
  remoteCreatedTime?: string | null;
  remoteFileId: string;
  remoteModifiedTime?: string | null;
  remoteParentId?: string | null;
  size: number;
  virtualPath: string;
}

export interface UploadedCloudItem {
  createdTime?: string | null;
  fileName: string;
  mimeType?: string | null;
  modifiedTime?: string | null;
  remoteFileId: string;
  remoteParentId?: string | null;
  size: number;
}

export interface UploadStreamInput {
  fileName: string;
  mimeType: string;
  onProgress?: (uploadedBytes: number) => void;
  size: number;
  stream: Readable;
  virtualPath: string;
}

export interface DownloadOptions {
  end?: number;
  start?: number;
}

export function sliceDownloadStream(
  source: Readable,
  options?: DownloadOptions,
  sourceAlreadyRanged = false,
): Readable {
  if (options?.start === undefined) return source;

  const start = options.start;
  const expectedBytes =
    options.end === undefined ? Number.POSITIVE_INFINITY : options.end - start + 1;
  return Readable.from(
    (async function* () {
      let skip = sourceAlreadyRanged ? 0 : start;
      let remaining = expectedBytes;
      try {
        for await (const chunk of source) {
          let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (skip >= buffer.length) {
            skip -= buffer.length;
            continue;
          }
          if (skip > 0) {
            buffer = buffer.subarray(skip);
            skip = 0;
          }
          if (remaining <= 0) break;
          if (buffer.length > remaining) buffer = buffer.subarray(0, remaining);
          remaining -= buffer.length;
          if (buffer.length) yield buffer;
          if (remaining <= 0) break;
        }
      } finally {
        if (!source.destroyed) source.destroy();
      }
    })(),
  );
}

export interface ProviderCapabilities {
  permanentDelete: boolean;
  restore: boolean;
  starred: boolean;
  trash: boolean;
}

export interface CloudProviderAdapter {
  readonly account: CloudAccountRecord;
  readonly capabilities: ProviderCapabilities;
  createFolder(virtualPath: string, name: string): Promise<UploadedCloudItem>;
  deletePermanently(file: CloudFileRecord): Promise<void>;
  download(file: CloudFileRecord, options?: DownloadOptions): Promise<Readable>;
  fetchStructure(): Promise<RemoteCloudItem[]>;
  getStorageSummary(): Promise<{ totalSpace: number; usedSpace: number }>;
  rename(file: CloudFileRecord, newName: string): Promise<void>;
  restore(file: CloudFileRecord): Promise<void>;
  setStarred(file: CloudFileRecord, starred: boolean): Promise<void>;
  trash(file: CloudFileRecord): Promise<void>;
  upload(input: UploadStreamInput): Promise<UploadedCloudItem>;
}

export abstract class BaseCloudAdapter implements CloudProviderAdapter {
  readonly capabilities: ProviderCapabilities = {
    permanentDelete: true,
    restore: false,
    starred: false,
    trash: true,
  };

  constructor(readonly account: CloudAccountRecord) {}

  abstract createFolder(virtualPath: string, name: string): Promise<UploadedCloudItem>;
  abstract deletePermanently(file: CloudFileRecord): Promise<void>;
  abstract download(file: CloudFileRecord, options?: DownloadOptions): Promise<Readable>;
  abstract fetchStructure(): Promise<RemoteCloudItem[]>;
  abstract getStorageSummary(): Promise<{ totalSpace: number; usedSpace: number }>;
  abstract rename(file: CloudFileRecord, newName: string): Promise<void>;
  abstract trash(file: CloudFileRecord): Promise<void>;
  abstract upload(input: UploadStreamInput): Promise<UploadedCloudItem>;

  async restore(_file: CloudFileRecord): Promise<void> {
    throw new Error(`${this.account.provider} does not support restoring deleted items.`);
  }

  async setStarred(_file: CloudFileRecord, _starred: boolean): Promise<void> {
    throw new Error(`${this.account.provider} does not support starred files.`);
  }

  protected progressStream(onProgress?: (uploadedBytes: number) => void): Transform {
    let uploadedBytes = 0;
    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        uploadedBytes += chunk.length;
        onProgress?.(uploadedBytes);
        callback(null, chunk);
      },
    });
  }
}

export function decodeAccountCredentials(account: CloudAccountRecord): Record<string, unknown> {
  try {
    const parsed = decryptJson<Record<string, unknown>>(account.encryptedCredentials);
    if (!parsed || typeof parsed !== 'object') throw new Error('empty credentials');
    return parsed;
  } catch {
    throw new Error(`${account.provider} credentials are invalid. Reconnect the account.`);
  }
}

export async function persistAccountCredentials(
  accountId: string,
  credentials: Record<string, unknown>,
): Promise<void> {
  await db
    .update(cloudAccounts)
    .set({
      encryptedCredentials: encryptJson(credentials),
      updatedAt: new Date(),
    })
    .where(eq(cloudAccounts.id, accountId));
}

const MIME_TYPES: Record<string, string> = {
  aac: 'audio/aac',
  avi: 'video/x-msvideo',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  flac: 'audio/flac',
  gif: 'image/gif',
  gz: 'application/gzip',
  html: 'text/html',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  md: 'text/markdown',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  m4v: 'video/mp4',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  pdf: 'application/pdf',
  png: 'image/png',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rar: 'application/vnd.rar',
  rtf: 'application/rtf',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  tar: 'application/x-tar',
  txt: 'text/plain',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

export function guessMimeType(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  return MIME_TYPES[extension] || 'application/octet-stream';
}

export function toIsoDate(value: string | number | Date | null | undefined): string | null {
  if (!value) return null;
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
