/**
 * Nammu Package Format (.napp) and Manifest Specifications
 */

export const NAPP_MAGIC = 'NAPP';
export const NAPP_FORMAT_VERSION = 1;
export const CURRENT_NAMMU_VERSION = '0.8.0';

export type RuntimeClass = 'web' | 'wasm' | 'system-extension' | 'runtime' | 'integration';

export type AppState =
  | 'Installed'
  | 'Not Installed'
  | 'Disabled'
  | 'Update Available'
  | 'Incompatible'
  | 'Corrupted'
  | 'Installing'
  | 'Updating'
  | 'Activating'
  | 'Repairing';

export type ReleaseChannel = 'stable' | 'beta' | 'nightly';

export type PermissionIdentifier =
  | 'clipboard.read'
  | 'clipboard.write'
  | 'notifications.send'
  | 'filesystem.appdata.read'
  | 'filesystem.appdata.write'
  | 'filesystem.user-selected.read'
  | 'filesystem.user-selected.write'
  | 'migration.legacy-storage'
  | 'network.internet'
  | 'integration.web-surfaces'
  | 'integration.services'
  | 'window.manage'
  | 'events.system.subscribe'
  | 'events.cross-app.subscribe'
  | 'camera.capture'
  | 'microphone.capture';

export const KNOWN_PERMISSIONS: Set<PermissionIdentifier> = new Set([
  'clipboard.read',
  'clipboard.write',
  'notifications.send',
  'filesystem.appdata.read',
  'filesystem.appdata.write',
  'filesystem.user-selected.read',
  'filesystem.user-selected.write',
  'migration.legacy-storage',
  'network.internet',
  'integration.web-surfaces',
  'integration.services',
  'window.manage',
  'events.system.subscribe',
  'events.cross-app.subscribe',
  'camera.capture',
  'microphone.capture',
]);

/**
 * Safe permissions automatically granted upon install
 */
export const SAFE_PERMISSIONS: Set<PermissionIdentifier> = new Set([
  'filesystem.appdata.read',
  'filesystem.appdata.write',
  'window.manage',
]);

/**
 * Sensitive permissions requiring explicit caller / user approval
 */
export const SENSITIVE_PERMISSIONS: Set<PermissionIdentifier> = new Set([
  'clipboard.read',
  'clipboard.write',
  'notifications.send',
  'filesystem.user-selected.read',
  'filesystem.user-selected.write',
  'migration.legacy-storage',
  'network.internet',
  'integration.web-surfaces',
  'integration.services',
  'events.system.subscribe',
  'events.cross-app.subscribe',
  'camera.capture',
  'microphone.capture',
]);

export interface ProtocolCapability {
  type: 'protocol';
  scheme: string;
}

export interface FileHandlerCapability {
  type: 'file-handler';
  extensions: string[];
  mime?: string;
}

export interface ServiceCapability {
  type: 'service';
  name: string;
}

export interface WebSurfaceCapability {
  type: 'web-surface';
  /** App-local name used by the SDK. It is not a native surface identity. */
  name: string;
  /** Public browser navigation or an exact set of approved remote origins. */
  navigation: { mode: 'public-web' } | { mode: 'approved-origins'; origins: string[] };
  /** Per-instance ceiling. Core additionally applies its global ceiling. */
  maxSurfaces?: number;
  /** Whether a stable, app-isolated WebView profile may be used. */
  persistentProfile?: boolean;
  /** Allow the app to request host-validated untrusted public proxy routing. */
  untrustedProxyRouting?: boolean;
}

export type CapabilityDeclaration =
  ProtocolCapability | FileHandlerCapability | ServiceCapability | WebSurfaceCapability;

export interface NammuAppManifest {
  /** Specification version of nammu.app.json (always 1 for current spec) */
  manifestVersion: 1;
  /** Unique reverse-domain package identifier (e.g., "os.nammu.browser" or "dev.author.tool") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Application semantic version (e.g., "1.4.2") */
  version: string;
  /** Sandbox runtime classification */
  runtime: RuntimeClass;
  /** Relative path to entry point inside the package (e.g., "app/index.html") */
  entry: string;
  /** Minimum NammuOS core version required to run this package */
  minNammuVersion: string;
  /** User data schema version for automatic data migration tracking */
  dataSchemaVersion: number;
  /** Explicit granular permissions requested by the application */
  permissions: PermissionIdentifier[];
  /** Concrete capabilities provided to NammuOS (e.g. file handlers, protocol schemes) */
  capabilities?: CapabilityDeclaration[];
  /** Named capability interfaces offered to other applications */
  providesCapabilities?: string[];
  /** Optional external capability interfaces the app can consume if present */
  optionalCapabilities?: string[];
  /** Exact legacy Core localStorage keys eligible for a one-time official-app migration. */
  legacyStorageKeys?: string[];
  /** Declared publisher identifier */
  publisher?: string;
  /** Cryptographic public key ID authorized for this package */
  publisherKeyId?: string;
}

export interface NappSignatureEnvelope {
  version: 1;
  algorithm: 'Ed25519' | 'SHA256-DIGEST' | 'RSA-PSS';
  keyId: string;
  publisher: string;
  digest: string;
  signature: string;
  timestamp: string;
  publicKeyRawHex?: string;
}

export interface InstalledAppRecord {
  appId: string;
  name: string;
  version: string;
  runtime: RuntimeClass;
  entry: string;
  sourceRegistry: 'official' | 'community' | 'developer' | 'local';
  sourceUrl?: string;
  channel: ReleaseChannel;
  installedAt: number;
  lastUpdatedAt: number;
  packageHash: string;
  publisher?: string;
  publisherKeyId?: string;
  dataSchemaVersion: number;
  requestedPermissions: PermissionIdentifier[];
  grantedPermissions: PermissionIdentifier[];
  capabilities?: CapabilityDeclaration[];
  state: AppState;
  activeVersion: string;
  activeVersionDir: string;
  lastKnownGoodVersion?: string;
  downloadSize?: number;
  installedSize?: number;
  signatureVerified?: boolean;
  isOfficial?: boolean;
  legacyStorageKeys?: string[];
}

export interface InstalledVersionRecord {
  appId: string;
  version: string;
  name: string;
  runtime: RuntimeClass;
  entry: string;
  packageHash: string;
  publisher?: string;
  publisherKeyId?: string;
  dataSchemaVersion: number;
  requestedPermissions: PermissionIdentifier[];
  grantedPermissions: PermissionIdentifier[];
  capabilities?: CapabilityDeclaration[];
  activeVersionDir: string;
  installedAt: number;
  signatureVerified?: boolean;
  isOfficial?: boolean;
  legacyStorageKeys?: string[];
}
