import crypto from 'node:crypto';

import { env } from '@/lib/env';

export interface UploadTicket {
  accountId: string;
  expiresAt: number;
  fileName: string;
  mimeType: string;
  size: number;
  userId: string;
  virtualPath: string;
}

const TICKET_VERSION = 'v1';
const TICKET_LIFETIME_MS = 15 * 60 * 1000;

function getEncryptionKey(): Buffer {
  const secret = process.env.UPLOAD_SESSION_SECRET || env.AUTH_SECRET;
  return crypto.createHash('sha256').update(secret).digest();
}

export function createUploadTicket(
  input: Omit<UploadTicket, 'expiresAt'>,
  now = Date.now(),
): string {
  const payload: UploadTicket = { ...input, expiresAt: now + TICKET_LIFETIME_MS };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    TICKET_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function readUploadTicket(token: string, now = Date.now()): UploadTicket {
  const [version, encodedIv, encodedAuthTag, encodedPayload, ...extra] = token.split('.');
  if (
    version !== TICKET_VERSION ||
    !encodedIv ||
    !encodedAuthTag ||
    !encodedPayload ||
    extra.length
  ) {
    throw new Error('The upload session is invalid. Start the upload again.');
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(encodedIv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(encodedAuthTag, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encodedPayload, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(decrypted) as UploadTicket;

    if (
      !payload.accountId ||
      !payload.userId ||
      !payload.fileName ||
      !payload.virtualPath ||
      !Number.isFinite(payload.size) ||
      !Number.isFinite(payload.expiresAt)
    ) {
      throw new Error('Malformed upload ticket.');
    }
    if (payload.expiresAt < now) {
      throw new Error('The upload session expired. Start the upload again.');
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message.includes('expired')) throw error;
    throw new Error('The upload session is invalid. Start the upload again.');
  }
}
