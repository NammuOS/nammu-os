/**
 * .napp Package Container Format Encoder and Decoder
 *
 * Implements strict security bounds, path canonicalization, Zip-Slip
 * protection, and canonical digest calculation excluding signature.json.
 */

import {
  NAPP_FORMAT_VERSION,
  NAPP_MAGIC,
  type NammuAppManifest,
  type NappSignatureEnvelope,
} from './nappSpec';
import { computeCanonicalPayloadDigest } from './packageSecurity';

export const MAX_HEADER_LEN = 1024 * 1024; // 1MB max header table
export const MAX_FILE_COUNT = 2000; // max 2,000 files per archive
export const MAX_SINGLE_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_TOTAL_UNCOMPRESSED_SIZE = 100 * 1024 * 1024; // 100MB
export const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024; // 50MB

export interface NappArchiveFile {
  path: string;
  data: Uint8Array;
}

export interface UnpackedNapp {
  manifest: NammuAppManifest;
  signature?: NappSignatureEnvelope;
  files: Map<string, Uint8Array>;
  digest: string; // Canonical payload digest (excluding signature.json)
  packageHash: string; // SHA-256 of full archive buffer
}

export async function computeSha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validates and canonicalizes a relative file path within a .napp package.
 * Rejects path traversal tokens ("..", "."), leading slashes, Windows drive letters,
 * null bytes, control characters, and empty segments.
 */
export function validatePackageFilePath(rawPath: string): string {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error('[napp Security] Package file path cannot be empty or whitespace');
  }

  // Check for null bytes or control characters
  if (Array.from(rawPath).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  })) {
    throw new Error(`[napp Security] Illegal control character in path: "${rawPath}"`);
  }

  // Check for leading slashes
  if (rawPath.startsWith('/') || rawPath.startsWith('\\')) {
    throw new Error(`[napp Security] Absolute path prohibited: "${rawPath}"`);
  }

  // Check for Windows drive letters (e.g. "C:")
  if (/^[a-zA-Z]:/.test(rawPath)) {
    throw new Error(`[napp Security] Drive letter specification prohibited: "${rawPath}"`);
  }

  const normalized = rawPath.replace(/\\/g, '/');
  const segments = normalized.split('/');

  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new Error(`[napp Security] Directory traversal segment "${seg}" prohibited in "${rawPath}"`);
    }
    if (seg.trim().length === 0) {
      throw new Error(`[napp Security] Empty path segment prohibited in "${rawPath}"`);
    }
  }

  return segments.join('/');
}

/**
 * Packs files into a deterministic binary .napp archive.
 * Format:
 * [4B MAGIC: 'NAPP']
 * [1B FORMAT_VERSION: 0x01]
 * [4B HEADER_LEN: uint32BE]
 * [HEADER JSON (file table: path, size)]
 * [RAW FILE CONCATENATED BYTES]
 */
export function packNapp(files: NappArchiveFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const magicBytes = encoder.encode(NAPP_MAGIC); // 4 bytes

  const seenPaths = new Set<string>();
  const fileTable = files.map((f) => {
    const cleanPath = validatePackageFilePath(f.path);
    if (seenPaths.has(cleanPath)) {
      throw new Error(`[napp Pack] Duplicate file path in package: "${cleanPath}"`);
    }
    seenPaths.add(cleanPath);

    return {
      path: cleanPath,
      size: f.data.length,
    };
  });

  const tableJson = JSON.stringify(fileTable);
  const tableBytes = encoder.encode(tableJson);

  const headerLen = tableBytes.length;
  const totalPayloadSize = files.reduce((acc, f) => acc + f.data.length, 0);
  const totalArchiveSize = 4 + 1 + 4 + headerLen + totalPayloadSize;

  const result = new Uint8Array(totalArchiveSize);
  const view = new DataView(result.buffer);

  // 1. Magic
  result.set(magicBytes, 0);
  // 2. Format Version
  result[4] = NAPP_FORMAT_VERSION;
  // 3. Header Length (uint32 BE)
  view.setUint32(5, headerLen, false);
  // 4. Header JSON
  result.set(tableBytes, 9);

  // 5. File Data
  let offset = 9 + headerLen;
  for (const f of files) {
    result.set(f.data, offset);
    offset += f.data.length;
  }

  return result;
}

/**
 * Unpacks and verifies the container structure of a .napp archive.
 * Strictly checks bounds, path traversal, resource limits, and canonical digest.
 */
export async function unpackNapp(archiveBytes: Uint8Array): Promise<UnpackedNapp> {
  if (archiveBytes.length < 9) {
    throw new Error('Corrupt package: archive is too small to contain a valid .napp header');
  }

  if (archiveBytes.length > MAX_ARCHIVE_SIZE) {
    throw new Error(`Package exceeds maximum permitted size of ${MAX_ARCHIVE_SIZE / (1024 * 1024)}MB`);
  }

  const magic = new TextDecoder().decode(archiveBytes.subarray(0, 4));
  if (magic !== NAPP_MAGIC) {
    throw new Error(`Invalid package format: expected magic "${NAPP_MAGIC}", got "${magic}"`);
  }

  const version = archiveBytes[4];
  if (version !== NAPP_FORMAT_VERSION) {
    throw new Error(`Unsupported package version: expected format ${NAPP_FORMAT_VERSION}, got ${version}`);
  }

  const view = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength);
  const headerLen = view.getUint32(5, false);

  if (headerLen > MAX_HEADER_LEN) {
    throw new Error(`Corrupt package: header length ${headerLen} exceeds maximum limit of ${MAX_HEADER_LEN} bytes`);
  }

  if (9 + headerLen > archiveBytes.length) {
    throw new Error('Corrupt package: header length exceeds archive size');
  }

  const tableBytes = archiveBytes.subarray(9, 9 + headerLen);
  const tableJson = new TextDecoder().decode(tableBytes);
  let fileTable: Array<{ path: string; size: number }>;

  try {
    fileTable = JSON.parse(tableJson);
  } catch (err: any) {
    throw new Error(`Corrupt package: failed to parse archive header table JSON: ${err.message}`);
  }

  if (!Array.isArray(fileTable)) {
    throw new Error('Corrupt package: archive header file table must be an array');
  }

  if (fileTable.length > MAX_FILE_COUNT) {
    throw new Error(`Package exceeds maximum file count limit of ${MAX_FILE_COUNT} files`);
  }

  const seenPaths = new Set<string>();
  let totalPayloadSize = 0;

  // Validate all paths and sizes before unpacking
  for (const entry of fileTable) {
    if (typeof entry !== 'object' || !entry || typeof entry.path !== 'string') {
      throw new Error('Corrupt package: malformed file table entry');
    }

    const cleanPath = validatePackageFilePath(entry.path);
    if (seenPaths.has(cleanPath)) {
      throw new Error(`Corrupt package: duplicate file path "${cleanPath}" in archive`);
    }
    seenPaths.add(cleanPath);

    if (typeof entry.size !== 'number' || !Number.isInteger(entry.size) || entry.size < 0) {
      throw new Error(`Corrupt package: invalid file size for "${entry.path}"`);
    }

    if (entry.size > MAX_SINGLE_FILE_SIZE) {
      throw new Error(`File "${entry.path}" exceeds maximum size of ${MAX_SINGLE_FILE_SIZE / (1024 * 1024)}MB`);
    }

    totalPayloadSize += entry.size;
  }

  if (totalPayloadSize > MAX_TOTAL_UNCOMPRESSED_SIZE) {
    throw new Error(`Package total uncompressed size exceeds limit of ${MAX_TOTAL_UNCOMPRESSED_SIZE / (1024 * 1024)}MB`);
  }

  const expectedTotalArchiveSize = 9 + headerLen + totalPayloadSize;
  if (archiveBytes.length !== expectedTotalArchiveSize) {
    throw new Error(
      `Corrupt package: archive size mismatch. Expected ${expectedTotalArchiveSize} bytes, got ${archiveBytes.length} bytes (trailing or truncated data detected)`
    );
  }

  let offset = 9 + headerLen;
  const files = new Map<string, Uint8Array>();

  for (const entry of fileTable) {
    const cleanPath = validatePackageFilePath(entry.path);
    const fileBytes = archiveBytes.subarray(offset, offset + entry.size);
    files.set(cleanPath, new Uint8Array(fileBytes));
    offset += entry.size;
  }

  const manifestBytes = files.get('nammu.app.json');
  if (!manifestBytes) {
    throw new Error('Missing canonical manifest: .napp archive must contain nammu.app.json at root');
  }

  const manifestJson = new TextDecoder().decode(manifestBytes);
  let manifest: NammuAppManifest;
  try {
    manifest = JSON.parse(manifestJson) as NammuAppManifest;
  } catch (err: any) {
    throw new Error(`Corrupt package: invalid nammu.app.json JSON syntax: ${err.message}`);
  }

  let signature: NappSignatureEnvelope | undefined;
  const signatureBytes = files.get('signature.json');
  if (signatureBytes) {
    const signatureJson = new TextDecoder().decode(signatureBytes);
    try {
      signature = JSON.parse(signatureJson) as NappSignatureEnvelope;
    } catch (err: any) {
      throw new Error(`Corrupt package: invalid signature.json JSON syntax: ${err.message}`);
    }
  }

  // Canonical payload digest (excludes signature.json)
  const digest = await computeCanonicalPayloadDigest(files);
  const packageHash = await computeSha256Hex(archiveBytes);

  return {
    manifest,
    signature,
    files,
    digest,
    packageHash,
  };
}
