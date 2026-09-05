import type {
  AllocationConfig,
  CloudAccount,
  CloudProvider,
  CloudFile,
  StorageStats,
} from '../types/cloudTypes';
import { getPlatformCapabilities } from '../../../platform';

// Utility formatting
export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '0 B';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDate(val: string | number | Date | undefined | null): string {
  if (!val) return '—';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

export function getFilePreviewType(mime?: string, name?: string): CloudFile['previewType'] {
  const m = (mime || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (
    m === 'application/vnd.google-apps.document' ||
    m === 'application/vnd.google-apps.spreadsheet'
  ) {
    return 'document';
  }
  if (
    m === 'application/vnd.google-apps.presentation' ||
    m === 'application/vnd.google-apps.drawing'
  ) {
    return 'pdf';
  }
  if (
    m.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|bmp|ico|heic|heif|tiff?|avif)$/.test(n)
  ) {
    return 'image';
  }
  if (m.startsWith('video/') || /\.(mp4|m4v|webm|mov|mkv|avi|wmv|flv|3gp)$/.test(n)) {
    return 'video';
  }
  if (m.startsWith('audio/') || /\.(mp3|wav|ogg|oga|flac|aac|m4a|opus|wma)$/.test(n)) {
    return 'audio';
  }
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (
    m.includes('text') ||
    m.includes('json') ||
    m.includes('javascript') ||
    /\.(txt|md|csv|log|ts|tsx|js|mjs|jsx|json|xml|html?|css|yaml|yml|rs|py|sh|env|sql|rtf)$/.test(n)
  ) {
    return 'document';
  }
  return 'other';
}

export function getProviderName(p?: CloudProvider | string): string {
  switch (p) {
    case 'google_drive':
      return 'Google Drive';
    case 'onedrive':
      return 'OneDrive';
    case 'dropbox':
      return 'Dropbox';
    case 'mega':
      return 'MEGA';
    case 'pcloud':
      return 'pCloud';
    case 'yandex':
      return 'Yandex Disk';
    case 's3':
      return 'S3 Storage';
    default:
      return p ? String(p) : 'Cloud';
  }
}

export function getProviderColor(p?: CloudProvider | string): string {
  switch (p) {
    case 'google_drive':
      return '#4285F4';
    case 'onedrive':
      return '#0078D4';
    case 'dropbox':
      return '#0061FF';
    case 'mega':
      return '#D9272E';
    case 'pcloud':
      return '#1EB5A9';
    case 'yandex':
      return '#FC3F1D';
    case 's3':
      return '#FF9900';
    default:
      return '#4aa3ff';
  }
}

export class CloudApiClient {
  constructor(private readonly services = () => getPlatformCapabilities().services) {}

  private async response(path: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return this.services().request(`/api${path}`, {
      ...options,
      headers,
    });
  }

  private async request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await this.response(path, options);

    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: 'API Error' }));
      throw new Error(payload.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ACCOUNTS
  async listAccounts(): Promise<CloudAccount[]> {
    const res = await this.request<{ data: CloudAccount[] }>('/accounts');
    return res.data || [];
  }

  async disconnectAccount(accountId: string): Promise<void> {
    await this.request(`/accounts/${accountId}`, { method: 'DELETE' });
  }

  async connectAccount(provider: CloudProvider, payload: any): Promise<CloudAccount> {
    const res = await this.request<{ data: CloudAccount }>(`/accounts/${provider}/connect`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  }

  async getOAuthConnectUrl(provider: CloudProvider): Promise<string> {
    const res = await this.request<any>(`/accounts/${provider}/connect`);
    const data = res?.data || res;
    const authUrl = data?.authorizationUrl || data?.url || res?.authorizationUrl || res?.url;
    if (!authUrl || authUrl === '#') {
      throw new Error(
        `Failed to generate authorization URL for ${provider}. Ensure credentials are set in .env.`,
      );
    }
    return authUrl;
  }

  async startDesktopOAuth(
    provider: 'google_drive',
    label?: string,
  ): Promise<{ attemptId: string; authorizationUrl: string; expiresAt: string }> {
    const res = await this.request<{
      data: { attemptId: string; authorizationUrl: string; expiresAt: string };
    }>(`/accounts/${provider}/connect`, {
      method: 'POST',
      body: JSON.stringify({ label: label?.trim() || undefined }),
    });
    return res.data;
  }

  async getDesktopOAuthStatus(attemptId: string): Promise<{
    attemptId: string;
    provider: 'google_drive';
    status:
      'awaiting_authorization' | 'exchanging' | 'completed' | 'cancelled' | 'expired' | 'failed';
    expiresAt: string;
    account?: CloudAccount;
    warning?: string;
    error?: { code: string; message: string };
  }> {
    const query = new URLSearchParams({ attempt_id: attemptId }).toString();
    const res = await this.request<{ data: any }>(`/accounts/google_drive/status?${query}`);
    return res.data;
  }

  async cancelDesktopOAuth(attemptId: string): Promise<void> {
    const query = new URLSearchParams({ attempt_id: attemptId }).toString();
    await this.request(`/accounts/google_drive/status?${query}`, { method: 'DELETE' });
  }

  // FILES
  async listFiles(virtualPath = '/'): Promise<CloudFile[]> {
    const normalized = virtualPath.startsWith('/') ? virtualPath : `/${virtualPath}`;
    const query = new URLSearchParams({ path: normalized }).toString();
    const res = await this.request<{ data: CloudFile[] }>(`/files?${query}`);
    return res.data || [];
  }

  async listRecentFiles(): Promise<CloudFile[]> {
    const res = await this.request<{ data: CloudFile[] }>('/files?recent=1');
    return res.data || [];
  }

  async listStarredFiles(): Promise<CloudFile[]> {
    const res = await this.request<{ data: CloudFile[] }>('/files?starred=1');
    return res.data || [];
  }

  async listSharedFiles(parentFolderId?: string): Promise<CloudFile[]> {
    const query = new URLSearchParams(
      parentFolderId ? { shared_parent: parentFolderId } : { shared: '1' },
    ).toString();
    const res = await this.request<{ data: CloudFile[] }>(`/files?${query}`);
    return res.data || [];
  }

  async searchFiles(term: string): Promise<CloudFile[]> {
    const keyword = term.trim();
    if (!keyword) return [];
    const query = new URLSearchParams({ search: keyword, limit: '50' }).toString();
    const res = await this.request<{ data: CloudFile[] }>(`/files?${query}`);
    return res.data || [];
  }

  async createFolder(
    virtualPath: string,
    name: string,
    accountId?: string,
    provider?: CloudProvider,
  ): Promise<CloudFile> {
    const cleanPath = virtualPath.endsWith('/') ? virtualPath : `${virtualPath}/`;
    const res = await this.request<{ data: CloudFile }>('/files/folders', {
      method: 'POST',
      body: JSON.stringify({
        virtual_path: cleanPath,
        folder_name: name,
        account_id: accountId,
        provider,
      }),
    });
    return res.data;
  }

  async renameFile(fileId: string, newName: string): Promise<void> {
    await this.request(`/files/${fileId}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name: newName }),
    });
  }

  async toggleStar(fileId: string, isStarred: boolean): Promise<void> {
    await this.request(`/files/${fileId}/star`, {
      method: 'PATCH',
      body: JSON.stringify({ is_starred: isStarred }),
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.request(`/files/${fileId}`, { method: 'DELETE' });
  }

  async bulkDelete(fileIds: string[]): Promise<void> {
    await this.request('/files/bulk/delete', {
      method: 'POST',
      body: JSON.stringify({ ids: fileIds }),
    });
  }

  async listTrashFiles(): Promise<CloudFile[]> {
    const res = await this.request<{ data: CloudFile[] }>('/files?trash=1');
    return res.data || [];
  }

  async restoreFile(fileId: string): Promise<void> {
    await this.request(`/files/${fileId}/restore`, { method: 'POST' });
  }

  async deleteFilePermanently(fileId: string): Promise<void> {
    await this.request(`/files/${fileId}/permanent`, { method: 'DELETE' });
  }

  async emptyTrash(): Promise<void> {
    await this.request('/files/trash/empty', { method: 'POST' });
  }

  // ALLOCATION & STATS
  async getAllocation(): Promise<AllocationConfig> {
    const res = await this.request<{ data: AllocationConfig }>('/allocation');
    return res.data || { strategy: 'round_robin', manual_order: [] };
  }

  async updateAllocation(config: AllocationConfig): Promise<void> {
    await this.request('/allocation', {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
  }

  async runSync(): Promise<void> {
    await this.request('/sync/run', { method: 'POST' });
  }

  // UPLOAD
  async initiateAndUpload(
    file: File,
    virtualPath: string,
    onProgress: (percent: number) => void,
    accountId?: string,
    provider?: CloudProvider,
  ): Promise<CloudFile> {
    const cleanPath = virtualPath.endsWith('/') ? virtualPath : `${virtualPath}/`;

    // 1. Initiate upload
    const init = await this.request<{ uploadId: string; accountId: string }>('/uploads/initiate', {
      method: 'POST',
      body: JSON.stringify({
        file_name: file.name,
        virtual_path: cleanPath,
        size: file.size,
        mime_type: file.type || 'application/octet-stream',
        account_id: accountId,
        provider,
      }),
    });

    if (!init || !init.uploadId) {
      throw new Error('Failed to initiate upload');
    }

    // The server exposes an HTTP stream, not a progress WebSocket. Keep the
    // transfer indeterminate until the HTTP request completes instead of
    // presenting fabricated byte progress.
    onProgress(0);
    const formData = new FormData();
    formData.append('file', file);
    const uploadRes = await this.response(`/uploads/${init.uploadId}/stream`, {
      method: 'POST',
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }

    const payload = await uploadRes.json();
    onProgress(100);
    return payload.data || payload;
  }

  async downloadFileWithProgress(
    file: CloudFile,
    onProgress: (percent: number, loadedBytes: number, totalBytes: number) => void,
  ): Promise<Blob> {
    const response = await this.response(`/files/${encodeURIComponent(file.id)}/download`);

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(err.error || `Download failed: HTTP ${response.status}`);
    }

    if (!response.body) {
      const blob = await response.blob();
      onProgress(100, blob.size, blob.size);
      return blob;
    }

    const contentLengthHeader = response.headers.get('Content-Length');
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : file.size || 0;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.length;
        const percent =
          totalBytes > 0
            ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100))
            : Math.min(95, Math.round(receivedBytes / 1024));
        onProgress(percent, receivedBytes, totalBytes);
      }
    }

    const mime =
      file.mime_type && file.mime_type !== 'application/octet-stream'
        ? file.mime_type
        : response.headers.get('Content-Type') || 'application/octet-stream';

    const blob = new Blob(chunks as BlobPart[], { type: mime });
    onProgress(100, blob.size, blob.size);
    return blob;
  }

  async fetchPreview(fileId: string, signal?: AbortSignal): Promise<Response> {
    const response = await this.response(`/files/${encodeURIComponent(fileId)}/preview`, {
      signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(payload.error || `Preview failed: HTTP ${response.status}`);
    }
    return response;
  }

  getStorageStats(accounts: CloudAccount[]): StorageStats {
    const totalSpace = accounts.reduce((sum, a) => sum + (a.total_space || 0), 0);
    const totalUsed = accounts.reduce((sum, a) => sum + (a.used_space || 0), 0);
    const totalFree = Math.max(0, totalSpace - totalUsed);
    const percent = totalSpace > 0 ? (totalUsed / totalSpace) * 100 : 0;
    return {
      totalSpace,
      totalUsed,
      totalFree,
      percent,
      percentRounded: Math.min(100, Math.round(percent)),
      usedFormatted: formatBytes(totalUsed),
      totalFormatted: formatBytes(totalSpace),
      freeFormatted: formatBytes(totalFree),
    };
  }
}

export const cloudApi = new CloudApiClient();
