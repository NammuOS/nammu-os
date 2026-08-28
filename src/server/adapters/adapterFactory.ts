import { DropboxCloudAdapter } from './DropboxCloudAdapter';
import { GoogleCloudAdapter } from './GoogleCloudAdapter';
import { MegaCloudAdapter } from './MegaCloudAdapter';
import { OneDriveCloudAdapter } from './OneDriveCloudAdapter';
import { PCloudAdapter } from './PCloudAdapter';
import { S3CloudAdapter } from './S3CloudAdapter';
import { YandexCloudAdapter } from './YandexCloudAdapter';
import type { CloudAccountRecord, CloudProviderAdapter } from './cloudAdapter';

export const IMPLEMENTED_CLOUD_PROVIDERS = new Set([
  'google',
  'google_drive',
  'mega',
  'onedrive',
  'dropbox',
  'pcloud',
  's3',
  'yandex',
]);

export function isImplementedCloudProvider(provider: string): boolean {
  return IMPLEMENTED_CLOUD_PROVIDERS.has(provider);
}

export function createCloudAdapter(account: CloudAccountRecord): CloudProviderAdapter {
  switch (account.provider) {
    case 'google':
    case 'google_drive':
      return new GoogleCloudAdapter(account);
    case 'mega':
      return new MegaCloudAdapter(account);
    case 'onedrive':
      return new OneDriveCloudAdapter(account);
    case 'dropbox':
      return new DropboxCloudAdapter(account);
    case 'pcloud':
      return new PCloudAdapter(account);
    case 's3':
      return new S3CloudAdapter(account);
    case 'yandex':
      return new YandexCloudAdapter(account);
    default:
      throw new Error(`Cloud provider ${account.provider} is not implemented.`);
  }
}
