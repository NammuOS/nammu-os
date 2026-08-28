import { Readable } from 'node:stream';

import {
  createGoogleDriveFolder,
  deleteGoogleDriveFile,
  getGoogleDriveClient,
  updateGoogleDriveFile,
  uploadToGoogleDrive,
} from '@/server/services/googleDriveService';
import {
  BaseCloudAdapter,
  sliceDownloadStream,
  type CloudFileRecord,
  type DownloadOptions,
  type RemoteCloudItem,
  type UploadedCloudItem,
  type UploadStreamInput,
} from './cloudAdapter';

const GOOGLE_EXPORTS: Record<string, string> = {
  'application/vnd.google-apps.document':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.google-apps.spreadsheet':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.presentation':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.google-apps.drawing': 'application/pdf',
};

export class GoogleCloudAdapter extends BaseCloudAdapter {
  override readonly capabilities = {
    permanentDelete: true,
    restore: true,
    starred: true,
    trash: true,
  };

  async fetchStructure(): Promise<RemoteCloudItem[]> {
    throw new Error('Google Drive snapshots are handled by the paginated Drive sync service.');
  }

  async getStorageSummary() {
    const drive = await getGoogleDriveClient(this.account);
    const response = await drive.about.get({ fields: 'storageQuota(limit,usage)' });
    return {
      totalSpace: Number(response.data.storageQuota?.limit || this.account.totalSpace || 0),
      usedSpace: Number(response.data.storageQuota?.usage || this.account.usedSpace || 0),
    };
  }

  async upload(input: UploadStreamInput): Promise<UploadedCloudItem> {
    const uploaded = await uploadToGoogleDrive(this.account.id, {
      data: input.stream,
      fileName: input.fileName,
      mimeType: input.mimeType,
      size: input.size,
      virtualPath: input.virtualPath,
    });
    return {
      remoteFileId: uploaded.id,
      remoteParentId: uploaded.parentId,
      size: uploaded.size,
      fileName: uploaded.name,
      mimeType: uploaded.mimeType,
      createdTime: uploaded.createdTime,
      modifiedTime: uploaded.modifiedTime,
    };
  }

  async createFolder(virtualPath: string, name: string): Promise<UploadedCloudItem> {
    const folder = await createGoogleDriveFolder(this.account.id, virtualPath, name);
    return {
      remoteFileId: folder.id,
      remoteParentId: folder.parentId,
      size: 0,
      fileName: folder.name,
      mimeType: folder.mimeType,
      createdTime: folder.createdTime,
      modifiedTime: folder.modifiedTime,
    };
  }

  async download(file: CloudFileRecord, options?: DownloadOptions): Promise<Readable> {
    const drive = await getGoogleDriveClient(this.account);
    const exportMimeType = GOOGLE_EXPORTS[file.mimeType || ''];
    const response = exportMimeType
      ? await drive.files.export(
          { fileId: file.remoteFileId, mimeType: exportMimeType },
          { responseType: 'arraybuffer' },
        )
      : await drive.files.get(
          { fileId: file.remoteFileId, alt: 'media' },
          {
            responseType: 'arraybuffer',
            ...(options?.start !== undefined
              ? { headers: { Range: `bytes=${options.start}-${options.end ?? ''}` } }
              : {}),
          },
        );
    const stream = Readable.from(Buffer.from(response.data as ArrayBuffer));
    return sliceDownloadStream(stream, options, Boolean(response.headers['content-range']));
  }

  async rename(file: CloudFileRecord, newName: string): Promise<void> {
    await updateGoogleDriveFile(this.account.id, file.remoteFileId, { name: newName });
  }

  async setStarred(file: CloudFileRecord, starred: boolean): Promise<void> {
    await updateGoogleDriveFile(this.account.id, file.remoteFileId, { starred });
  }

  async trash(file: CloudFileRecord): Promise<void> {
    await updateGoogleDriveFile(this.account.id, file.remoteFileId, { trashed: true });
  }

  async restore(file: CloudFileRecord): Promise<void> {
    await updateGoogleDriveFile(this.account.id, file.remoteFileId, { trashed: false });
  }

  async deletePermanently(file: CloudFileRecord): Promise<void> {
    await deleteGoogleDriveFile(this.account.id, file.remoteFileId);
  }
}
