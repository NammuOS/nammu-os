export type CloudProvider =
  'google_drive' | 'onedrive' | 'dropbox' | 'mega' | 'pcloud' | 'yandex' | 's3';

export interface CloudAccount {
  id: string;
  user_id: string;
  email: string;
  provider: CloudProvider;
  total_space: number;
  used_space: number;
  status: 'active' | 'suspended' | 'invalid_token';
  created_at: string;
  updated_at: string;
  label?: string;
}

export interface CloudFile {
  id: string;
  user_id?: string;
  virtual_path: string;
  file_name: string;
  is_folder: boolean | number;
  is_starred: boolean | number;
  size: number;
  mime_type?: string;
  cloud_account_id: string;
  remote_file_id: string;
  remote_parent_id?: string;
  remote_created_time?: string;
  remote_modified_time?: string;
  created_at: string;
  updated_at: string;
  email?: string;
  provider?: CloudProvider;
  display_name?: string;
  previewUrl?: string;
  previewType?: 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'other';
}

export type AllocationStrategy =
  'round_robin' | 'weighted_round_robin' | 'least_used' | 'most_free' | 'manual';

export interface AllocationConfig {
  strategy: AllocationStrategy;
  manual_order?: string[];
}

export interface UploadTask {
  id: string;
  batchId?: string;
  name: string;
  size?: number;
  type: 'upload' | 'download' | 'create-folder' | 'rename' | 'delete';
  status:
    'pending' | 'uploading' | 'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress_percentage: number;
  error?: string;
  targetKind?: string;
  fromName?: string;
  toName?: string;
}

export interface StorageStats {
  totalSpace: number;
  totalUsed: number;
  totalFree: number;
  percent: number;
  percentRounded: number;
  usedFormatted: string;
  totalFormatted: string;
  freeFormatted: string;
}

export type CloudNavSection =
  'home' | 'my-drive' | 'shared-with-me' | 'recent' | 'starred' | 'trash';
