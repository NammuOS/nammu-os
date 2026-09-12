import { unpackNapp } from '../nmu/nappArchive';
import { validateNammuAppManifest } from '../nmu/manifestValidator';
import type { NammuAppManifest } from '../nmu/nappSpec';
import type { NammuStoreApp } from './storeRegistry';

const MAX_STORE_PACKAGE_BYTES = 64 * 1024 * 1024;

export interface PreparedStorePackage {
  app: NammuStoreApp;
  bytes: Uint8Array;
  manifest: NammuAppManifest;
  sha256: string;
}

export type StorePackageFetcher = (input: URL, init: RequestInit) => Promise<Response>;

function assertPackageUrl(value: string): URL {
  const url = new URL(value);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error('Store packages must use HTTPS (or loopback HTTP during development).');
  }
  if (url.username || url.password || url.hash) {
    throw new Error('Store package URLs cannot contain credentials or fragments.');
  }
  return url;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = Uint8Array.from(bytes).buffer;
  const digest = await crypto.subtle.digest('SHA-256', digestInput);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function prepareStorePackage(
  app: NammuStoreApp,
  fetchPackage: StorePackageFetcher = (input, init) => fetch(input, init),
): Promise<PreparedStorePackage> {
  const url = assertPackageUrl(app.release.packageUrl);
  const response = await fetchPackage(url, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(`Package download failed (${response.status}).`);
  if (response.url) assertPackageUrl(response.url);

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_STORE_PACKAGE_BYTES) {
    throw new Error('Package exceeds the 64 MiB Store download limit.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_STORE_PACKAGE_BYTES) {
    throw new Error('Downloaded package is empty or exceeds the 64 MiB Store download limit.');
  }

  const sha256 = await sha256Hex(bytes);
  if (sha256 !== app.release.sha256.toLowerCase()) {
    throw new Error('Package integrity check failed. The download was not installed.');
  }

  const archive = await unpackNapp(bytes);
  const validation = validateNammuAppManifest(archive.manifest, { allowOfficialNamespace: true });
  if (!validation.valid || !validation.manifest) {
    throw new Error(`Package manifest is invalid: ${validation.errors.join('; ')}`);
  }
  if (validation.manifest.id !== app.id || validation.manifest.version !== app.release.version) {
    throw new Error('Package identity does not match its Store release metadata.');
  }

  return { app, bytes, manifest: validation.manifest, sha256 };
}

export function formatStoreBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
