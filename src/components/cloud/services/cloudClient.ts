import type {
  AllocationConfig,
  CloudAccount,
  CloudProvider,
  CloudFile,
  StorageStats,
} from '../types/cloudTypes';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '/api';
const CONFIGURED_WS_BASE_URL = (import.meta as any).env?.VITE_WS_BASE_URL as string | undefined;

function getWebSocketBaseUrl(): string {
  if (CONFIGURED_WS_BASE_URL) return CONFIGURED_WS_BASE_URL;
  if (typeof window === 'undefined') {
    throw new Error('Upload WebSocket URLs can only be resolved in the browser.');
  }
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  return `${protocol}${window.location.host}/ws/uploads`;
}

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
  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(n)) return 'image';
  if (m.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/.test(n)) return 'video';
  if (m.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a)$/.test(n)) return 'audio';
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (
    m.includes('text') ||
    m.includes('json') ||
    m.includes('javascript') ||
    /\.(txt|md|ts|tsx|js|jsx|json|html|css|yaml|yml|rs|py|sh|env)$/.test(n)
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

class CloudApiClient {
  private async request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });

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

  async listSharedFiles(): Promise<CloudFile[]> {
    const res = await this.request<{ data: CloudFile[] }>('/files?shared=1');
    return res.data || [];
  }

  async searchFiles(term: string): Promise<CloudFile[]> {
    const keyword = term.trim();
    if (!keyword) return [];
    const query = new URLSearchParams({ search: keyword, limit: '50' }).toString();
    const res = await this.request<{ data: CloudFile[] }>(`/files?${query}`);
    return res.data || [];
  }

  async createFolder(virtualPath: string, name: string): Promise<CloudFile> {
    const cleanPath = virtualPath.endsWith('/') ? virtualPath : `${virtualPath}/`;
    const res = await this.request<{ data: CloudFile }>('/files/folders', {
      method: 'POST',
      body: JSON.stringify({ virtual_path: cleanPath, folder_name: name }),
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
      }),
    });

    if (!init || !init.uploadId) {
      throw new Error('Failed to initiate upload');
    }

    // Connect WebSocket
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${getWebSocketBaseUrl()}?uploadId=${encodeURIComponent(init.uploadId)}`);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.progress_percentage !== undefined) {
            onProgress(data.progress_percentage);
          }
        } catch {}
      };
    } catch {}

    // Upload stream
    const formData = new FormData();
    formData.append('file', file);
    const uploadRes = await fetch(`${API_BASE_URL}/uploads/${init.uploadId}/stream`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (ws) {
      try {
        ws.close();
      } catch {}
    }

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
    const downloadUrl = this.getDownloadUrl(file.id);
    const response = await fetch(downloadUrl, { credentials: 'include' });

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

  getDownloadUrl(fileId: string): string {
    return `${API_BASE_URL}/files/${fileId}/download`;
  }

  getPreviewUrl(fileId: string): string {
    return `${API_BASE_URL}/files/${fileId}/preview`;
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
