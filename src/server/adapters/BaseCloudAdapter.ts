import { Readable, Transform } from 'stream';
import crypto from 'crypto';

export interface CloudAccountRecord {
  id: string;
  userId: string;
  email: string;
  provider: string;
  encryptedCredentials?: string;
  totalSpace: number;
  usedSpace: number;
  status: string;
}

export interface CloudFileItem {
  remoteFileId: string;
  remoteParentId?: string | null;
  fileName: string;
  virtualPath: string;
  isFolder: boolean;
  size: number;
  mimeType?: string | null;
  remoteCreatedTime?: string | null;
  remoteModifiedTime?: string | null;
}

export interface UploadStreamOptions {
  stream: Readable;
  size: number;
  fileName: string;
  mimeType?: string;
  virtualPath: string;
  remoteParentId?: string;
  onProgress?: (bytesUploaded: number) => void;
}

export class BaseCloudAdapter {
  protected account: CloudAccountRecord;

  constructor(account: CloudAccountRecord) {
    this.account = account;
  }

  getCapabilities() {
    return {
      starred: false,
      rename: true,
      delete: true,
    };
  }

  async fetchStructure(): Promise<CloudFileItem[]> {
    return [];
  }

  async getStorageSummary(): Promise<{ totalSpace: number; usedSpace: number }> {
    return {
      totalSpace: Number(this.account.totalSpace || 0),
      usedSpace: Number(this.account.usedSpace || 0),
    };
  }

  createProgressStream(onProgress?: (bytes: number) => void): Transform {
    let bytes = 0;
    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (onProgress) onProgress(bytes);
        callback(null, chunk);
      },
    });
  }

  async uploadStream(opts: UploadStreamOptions): Promise<{
    remoteFileId: string;
    remoteParentId: string;
    size: number;
    fileName: string;
    mimeType?: string;
  }> {
    const progressStream = this.createProgressStream(opts.onProgress);
    const passthrough = opts.stream.pipe(progressStream);

    await new Promise<void>((resolve, reject) => {
      passthrough.on('error', reject);
      passthrough.on('end', resolve);
      passthrough.resume();
    });

    return {
      remoteFileId: `${this.account.provider}-${crypto.randomUUID()}`,
      remoteParentId: opts.remoteParentId || `${this.account.provider}-${opts.virtualPath}`,
      size: opts.size,
      fileName: opts.fileName,
      mimeType: opts.mimeType,
    };
  }

  async createFolder(opts: { name: string; virtualPath: string; remoteParentId?: string }) {
    return {
      remoteFileId: `${this.account.provider}-${crypto.randomUUID()}`,
      remoteParentId: opts.remoteParentId || `${this.account.provider}-${opts.virtualPath}`,
      fileName: opts.name,
    };
  }

  async getDownloadStream(fileRecord: { fileName: string }): Promise<Readable> {
    const content = `Download payload for ${fileRecord.fileName} from ${this.account.provider}`;
    return Readable.from([content]);
  }

  async renameFile(_remoteFileId: string, _newName: string): Promise<void> {
    // Override in concrete adapter
  }

  async deleteFile(_remoteFileId: string): Promise<void> {
    // Override in concrete adapter
  }
}
