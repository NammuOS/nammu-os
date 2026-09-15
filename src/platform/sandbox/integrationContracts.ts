export const PACKAGE_BINARY_LIMIT_BYTES = 32 * 1024 * 1024;
export const PACKAGE_ASSET_LIMIT_BYTES = 64 * 1024 * 1024;
export const PACKAGE_SERVICE_REQUEST_LIMIT_BYTES = 256 * 1024;
export const PACKAGE_SERVICE_RESPONSE_LIMIT_BYTES = 4 * 1024 * 1024;

export interface PackageSurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PackageSurfaceControl =
  | 'reload'
  | 'stop'
  | 'go-back'
  | 'go-forward'
  | 'mute'
  | 'unmute'
  | 'find'
  | 'find-next'
  | 'find-previous'
  | 'clear-find'
  | 'print'
  | 'save-page'
  | 'enable-tracking-protection'
  | 'disable-tracking-protection'
  | 'block-autoplay'
  | 'allow-autoplay';

export interface PackageSurfaceProxyEndpoint {
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
}

export interface PackageSurfaceSnapshot {
  /** Opaque, broker-local handle. Native surface identities never cross IPC. */
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isAudioPlaying: boolean;
  isMuted: boolean;
  visible: boolean;
}

export interface PackageSurfaceCreateRequest {
  capability: string;
  profileKey: string;
  privateSession: boolean;
  url: string;
  bounds: PackageSurfaceBounds;
  visible: boolean;
}

export type PackageLifecyclePhase = 'active' | 'background' | 'minimized' | 'suspended';

export interface PackageLifecycleState {
  phase: PackageLifecyclePhase;
  visible: boolean;
  focused: boolean;
  active: boolean;
  suspended: boolean;
}

export interface PackageBinaryFile {
  name: string;
  mimeType: string | null;
  size: number;
  bytes: Uint8Array;
}

export interface PackageServiceRequest {
  service: string;
  operation: string;
  payload?: unknown;
}

export interface PackageServiceResponse {
  status: number;
  data: unknown;
}

export function isSafePackagePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 512 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.split('/').some((segment) => segment === '..' || segment === '')
  );
}

export function isSafeSurfaceBounds(value: PackageSurfaceBounds): boolean {
  return (
    [value.x, value.y, value.width, value.height].every(Number.isFinite) &&
    value.x >= 0 &&
    value.y >= 0 &&
    value.width >= 1 &&
    value.height >= 1 &&
    value.x <= 16_384 &&
    value.y <= 16_384 &&
    value.width <= 16_384 &&
    value.height <= 16_384
  );
}
