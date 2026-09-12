/**
 * Cryptographic Package Security & Trust System
 *
 * Implements canonical package digest calculation (excluding signature.json),
 * Ed25519 signature verification via Web Crypto API, and trusted publisher
 * keyring enforcement. Namespace os.nammu.* is strictly reserved for verified
 * keys authorized for official Nammu distribution.
 */

import type { NammuAppManifest, NappSignatureEnvelope } from './nappSpec';

export interface TrustedPublisherKey {
  keyId: string;
  publisher: string;
  publicKeyRawHex: string;
  authorizedNamespaces: string[]; // e.g. ["os.nammu.*"] or ["*"]
  revoked?: boolean;
}

export interface PackageTrustResult {
  verified: boolean;
  isOfficial: boolean;
  keyId?: string;
  publisher?: string;
  error?: string;
}

// Official release verification material is intentionally public. The matching
// private key is generated and retained outside this repository by the release-
// signing environment and must never be bundled with NammuOS.
export const OFFICIAL_NAMMU_KEY_ID = 'nammu-official-2026-09';
export const OFFICIAL_NAMMU_PUBLIC_KEY_HEX =
  '37ca9ad8e5dd8b6ac61baa335893ca9c55e1c02d538cb180e3e64f2f222d95ac';

export const OFFICIAL_NAMMU_PUBLISHER_KEY: TrustedPublisherKey = {
  keyId: OFFICIAL_NAMMU_KEY_ID,
  publisher: 'nammu-official',
  publicKeyRawHex: OFFICIAL_NAMMU_PUBLIC_KEY_HEX,
  authorizedNamespaces: ['os.nammu.*'],
};

/**
 * Computes canonical digest of archive files EXCLUDING signature.json.
 * Files are sorted by path in deterministic ordinal ASCII order.
 */
export async function computeCanonicalPayloadDigest(
  files: Map<string, Uint8Array> | Array<{ path: string; data: Uint8Array }>,
): Promise<string> {
  const fileEntries: Array<{ path: string; data: Uint8Array }> = [];

  if (files instanceof Map) {
    for (const [path, data] of files.entries()) {
      if (path !== 'signature.json' && path !== '/signature.json') {
        fileEntries.push({ path, data });
      }
    }
  } else {
    for (const file of files) {
      if (file.path !== 'signature.json' && file.path !== '/signature.json') {
        fileEntries.push(file);
      }
    }
  }

  // Sort files by path deterministically
  fileEntries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const encoder = new TextEncoder();
  const totalLength = fileEntries.reduce(
    (acc, f) => acc + 4 + encoder.encode(f.path).length + 4 + f.data.length,
    0,
  );

  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  for (const f of fileEntries) {
    const pathBytes = encoder.encode(f.path);
    view.setUint32(offset, pathBytes.length, false);
    offset += 4;
    buffer.set(pathBytes, offset);
    offset += pathBytes.length;

    view.setUint32(offset, f.data.length, false);
    offset += 4;
    buffer.set(f.data, offset);
    offset += f.data.length;
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer.buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Import raw Ed25519 public key (32 bytes)
 */
export async function importEd25519PublicKey(rawHex: string): Promise<CryptoKey> {
  const rawBytes = hexToBytes(rawHex);
  return crypto.subtle.importKey(
    'raw',
    rawBytes as unknown as ArrayBuffer,
    { name: 'Ed25519' },
    true,
    ['verify'],
  );
}

/**
 * Verify an Ed25519 signature over a canonical digest
 */
export async function verifySignatureEd25519(
  publicKeyRawHex: string,
  signatureHex: string,
  digestHex: string,
): Promise<boolean> {
  try {
    const key = await importEd25519PublicKey(publicKeyRawHex);
    const signatureBytes = hexToBytes(signatureHex);
    const data = new TextEncoder().encode(digestHex);
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      signatureBytes as unknown as ArrayBuffer,
      data,
    );
  } catch {
    return false;
  }
}

/**
 * Keyring managing trusted publishers and authorized namespace patterns
 */
export class PublisherKeyring {
  private keys = new Map<string, TrustedPublisherKey>();

  constructor(initialKeys: TrustedPublisherKey[] = []) {
    for (const key of initialKeys) this.registerKey(key);
  }

  registerKey(key: TrustedPublisherKey): void {
    this.keys.set(key.keyId, { ...key });
  }

  getKey(keyId: string): TrustedPublisherKey | undefined {
    return this.keys.get(keyId);
  }

  revokeKey(keyId: string): void {
    const existing = this.keys.get(keyId);
    if (existing) {
      existing.revoked = true;
    }
  }

  isKeyAuthorizedForNamespace(keyId: string, appId: string): boolean {
    const key = this.keys.get(keyId);
    if (!key || key.revoked) return false;

    for (const pattern of key.authorizedNamespaces) {
      if (pattern === '*') return true;
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        if (appId.startsWith(prefix + '.') || appId === prefix) return true;
      } else if (pattern === appId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Performs full cryptographic signature and namespace trust verification
   */
  async verifyPackageTrust(
    manifest: NammuAppManifest,
    files: Map<string, Uint8Array>,
    signature?: NappSignatureEnvelope,
  ): Promise<PackageTrustResult> {
    const isOfficialNamespace = manifest.id.startsWith('os.nammu.');

    // 1. If unsigned:
    if (!signature) {
      if (isOfficialNamespace) {
        return {
          verified: false,
          isOfficial: true,
          error: `Untrusted package: "${manifest.id}" claims reserved namespace "os.nammu.*" but carries no cryptographic signature`,
        };
      }
      return {
        verified: false,
        isOfficial: false,
      };
    }

    // 2. Validate algorithm
    if (signature.algorithm !== 'Ed25519') {
      return {
        verified: false,
        isOfficial: isOfficialNamespace,
        error: `Unsupported signature algorithm "${signature.algorithm}". Only Ed25519 is accepted`,
      };
    }

    if (
      !manifest.publisherKeyId ||
      manifest.publisherKeyId !== signature.keyId ||
      !manifest.publisher ||
      manifest.publisher !== signature.publisher
    ) {
      return {
        verified: false,
        isOfficial: isOfficialNamespace,
        error: 'Signed package manifest publisher identity does not match its signature envelope',
      };
    }

    // 3. Compute canonical digest of package content (excluding signature.json)
    const expectedDigest = await computeCanonicalPayloadDigest(files);
    if (signature.digest !== expectedDigest) {
      return {
        verified: false,
        isOfficial: isOfficialNamespace,
        error: `Signature digest mismatch: expected canonical "${expectedDigest}", got "${signature.digest}"`,
      };
    }

    // 4. Retrieve publisher key from keyring
    const trustedKey = this.getKey(signature.keyId);

    // If key not in keyring:
    if (!trustedKey) {
      if (isOfficialNamespace) {
        return {
          verified: false,
          isOfficial: true,
          error: `Unrecognized publisher keyId "${signature.keyId}" for reserved official namespace "os.nammu.*"`,
        };
      }

      // Check if signature provides a raw public key
      const pubKey = (signature as any).publicKeyRawHex;
      if (!pubKey) {
        return {
          verified: false,
          isOfficial: false,
          error: `Unknown publisher keyId "${signature.keyId}" and no public key provided in envelope`,
        };
      }

      const validSig = await verifySignatureEd25519(pubKey, signature.signature, signature.digest);
      if (!validSig) {
        return {
          verified: false,
          isOfficial: false,
          error: `Cryptographic Ed25519 signature verification failed for keyId "${signature.keyId}"`,
        };
      }

      return {
        verified: true,
        isOfficial: false,
        keyId: signature.keyId,
        publisher: signature.publisher,
      };
    }

    if (signature.publisher !== trustedKey.publisher) {
      return {
        verified: false,
        isOfficial: isOfficialNamespace,
        error: `Signature publisher does not match trusted key identity for "${signature.keyId}"`,
      };
    }

    // 5. Key exists in keyring - check revocation
    if (trustedKey.revoked) {
      return {
        verified: false,
        isOfficial: isOfficialNamespace,
        error: `Publisher key "${signature.keyId}" has been revoked`,
      };
    }

    // 6. Verify signature against trusted key
    const validSig = await verifySignatureEd25519(
      trustedKey.publicKeyRawHex,
      signature.signature,
      signature.digest,
    );

    if (!validSig) {
      return {
        verified: false,
        isOfficial: isOfficialNamespace,
        error: `Cryptographic Ed25519 signature verification failed against trusted key "${signature.keyId}"`,
      };
    }

    // 7. Enforce namespace authorization
    const authorized = this.isKeyAuthorizedForNamespace(signature.keyId, manifest.id);
    if (!authorized) {
      return {
        verified: false,
        isOfficial: isOfficialNamespace,
        error: `Key "${signature.keyId}" is not authorized to sign packages in namespace "${manifest.id}"`,
      };
    }

    return {
      verified: true,
      isOfficial:
        isOfficialNamespace && this.isKeyAuthorizedForNamespace(signature.keyId, manifest.id),
      keyId: signature.keyId,
      publisher: trustedKey.publisher,
    };
  }
}

let defaultKeyring: PublisherKeyring | null = null;

export function getPublisherKeyring(): PublisherKeyring {
  if (!defaultKeyring) {
    defaultKeyring = new PublisherKeyring([OFFICIAL_NAMMU_PUBLISHER_KEY]);
  }
  return defaultKeyring;
}
