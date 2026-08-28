import { Readable } from 'node:stream';
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import { normalizeVirtualPath, validateCloudFileName } from '@/server/services/googleDriveService';
import {
  BaseCloudAdapter,
  decodeAccountCredentials,
  guessMimeType,
  sliceDownloadStream,
  type CloudFileRecord,
  type DownloadOptions,
  type RemoteCloudItem,
  type UploadedCloudItem,
  type UploadStreamInput,
} from './cloudAdapter';

function keyFor(virtualPath: string, name = ''): string {
  return `${normalizeVirtualPath(virtualPath).replace(/^\/+/, '')}${name}`;
}

function parentPathForKey(key: string): string {
  const clean = key.replace(/\/+$/, '');
  const slash = clean.lastIndexOf('/');
  return slash < 0 ? '/' : normalizeVirtualPath(`/${clean.slice(0, slash)}/`);
}

function nameForKey(key: string): string {
  const clean = key.replace(/\/+$/, '');
  return clean.slice(clean.lastIndexOf('/') + 1);
}

export class S3CloudAdapter extends BaseCloudAdapter {
  override readonly capabilities = {
    permanentDelete: true,
    restore: false,
    starred: false,
    trash: false,
  };

  private clientValue: S3Client | null = null;
  private bucketValue = '';

  private client() {
    if (this.clientValue) return { client: this.clientValue, bucket: this.bucketValue };
    const credentials = decodeAccountCredentials(this.account);
    if (!credentials.accessKeyId || !credentials.secretAccessKey || !credentials.bucket) {
      throw new Error('S3 credentials require an access key, secret key, and bucket.');
    }
    this.bucketValue = String(credentials.bucket);
    this.clientValue = new S3Client({
      region: String(credentials.region || 'auto'),
      endpoint: credentials.endpoint ? String(credentials.endpoint) : undefined,
      forcePathStyle: credentials.forcePathStyle !== false,
      credentials: {
        accessKeyId: String(credentials.accessKeyId),
        secretAccessKey: String(credentials.secretAccessKey),
      },
    });
    return { client: this.clientValue, bucket: this.bucketValue };
  }

  private async list(prefix?: string): Promise<_Object[]> {
    const { client, bucket } = this.client();
    const objects: _Object[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      objects.push(...(response.Contents || []));
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }

  async fetchStructure(): Promise<RemoteCloudItem[]> {
    const objects = await this.list();
    const records: RemoteCloudItem[] = [];
    const folders = new Set<string>();

    for (const object of objects) {
      const key = object.Key;
      if (!key) continue;
      const isFolder = key.endsWith('/');
      if (isFolder) folders.add(key);
      records.push({
        virtualPath: parentPathForKey(key),
        fileName: nameForKey(key),
        isFolder,
        size: isFolder ? 0 : Number(object.Size || 0),
        mimeType: isFolder ? 'application/x-directory' : guessMimeType(nameForKey(key)),
        remoteFileId: key,
        remoteParentId: parentPathForKey(key),
        remoteCreatedTime: null,
        remoteModifiedTime: object.LastModified?.toISOString() || null,
      });
    }

    for (const object of objects) {
      const parts = (object.Key || '').replace(/\/+$/, '').split('/');
      parts.pop();
      let prefix = '';
      for (const part of parts) {
        prefix += `${part}/`;
        if (folders.has(prefix)) continue;
        folders.add(prefix);
        records.push({
          virtualPath: parentPathForKey(prefix),
          fileName: nameForKey(prefix),
          isFolder: true,
          size: 0,
          mimeType: 'application/x-directory',
          remoteFileId: prefix,
          remoteParentId: parentPathForKey(prefix),
        });
      }
    }
    return records.filter((record) => record.fileName);
  }

  async getStorageSummary() {
    const objects = await this.list();
    return {
      totalSpace: Number(this.account.totalSpace || 0),
      usedSpace: objects.reduce((total, object) => total + Number(object.Size || 0), 0),
    };
  }

  async upload(input: UploadStreamInput): Promise<UploadedCloudItem> {
    const { client, bucket } = this.client();
    const key = keyFor(input.virtualPath, validateCloudFileName(input.fileName));
    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: input.stream.pipe(this.progressStream(input.onProgress)),
        ContentType: input.mimeType,
      },
    });
    await upload.done();
    return {
      remoteFileId: key,
      remoteParentId: normalizeVirtualPath(input.virtualPath),
      size: input.size,
      fileName: input.fileName,
      mimeType: input.mimeType,
      modifiedTime: new Date().toISOString(),
    };
  }

  async createFolder(virtualPath: string, name: string): Promise<UploadedCloudItem> {
    const { client, bucket } = this.client();
    const fileName = validateCloudFileName(name);
    const key = `${keyFor(virtualPath, fileName)}/`;
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: '' }));
    return {
      remoteFileId: key,
      remoteParentId: normalizeVirtualPath(virtualPath),
      size: 0,
      fileName,
      mimeType: 'application/x-directory',
      modifiedTime: new Date().toISOString(),
    };
  }

  async download(file: CloudFileRecord, options?: DownloadOptions): Promise<Readable> {
    const { client, bucket } = this.client();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: file.remoteFileId,
        Range:
          options?.start !== undefined ? `bytes=${options.start}-${options.end ?? ''}` : undefined,
      }),
    );
    if (!response.Body) throw new Error('S3 returned an empty download body.');
    const stream =
      response.Body instanceof Readable
        ? response.Body
        : Readable.fromWeb(response.Body as unknown as import('node:stream/web').ReadableStream);
    return sliceDownloadStream(stream, options, Boolean(response.ContentRange));
  }

  private async deleteKeys(keys: string[]): Promise<void> {
    const { client, bucket } = this.client();
    for (let index = 0; index < keys.length; index += 1000) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.slice(index, index + 1000).map((Key) => ({ Key })) },
        }),
      );
    }
  }

  async rename(file: CloudFileRecord, newName: string): Promise<void> {
    const { client, bucket } = this.client();
    const cleanName = validateCloudFileName(newName);
    const sourceKeys = file.isFolder
      ? (await this.list(file.remoteFileId)).flatMap((object) => (object.Key ? [object.Key] : []))
      : [file.remoteFileId];
    const targetBase = keyFor(file.virtualPath, cleanName) + (file.isFolder ? '/' : '');
    for (const sourceKey of sourceKeys) {
      const destinationKey = file.isFolder
        ? `${targetBase}${sourceKey.slice(file.remoteFileId.length)}`
        : targetBase;
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, '/')}`,
          Key: destinationKey,
        }),
      );
    }
    await this.deleteKeys(sourceKeys);
  }

  async trash(file: CloudFileRecord): Promise<void> {
    await this.deletePermanently(file);
  }

  async deletePermanently(file: CloudFileRecord): Promise<void> {
    const keys = file.isFolder
      ? (await this.list(file.remoteFileId)).flatMap((object) => (object.Key ? [object.Key] : []))
      : [file.remoteFileId];
    if (keys.length) await this.deleteKeys(keys);
  }
}
