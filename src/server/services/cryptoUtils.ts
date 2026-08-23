import crypto from 'crypto';
import { env } from '@/lib/env';

const encryptionKey = crypto.createHash('sha256').update(env.AUTH_SECRET).digest();

export function encryptJson(payload: any): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptJson<T = any>(value: string): T {
  try {
    const raw = Buffer.from(value, 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString('utf8'));
    decrypted.fill(0);
    return parsed as T;
  } catch {
    throw new Error(
      'Cloud account credentials cannot be decrypted (encryption key changed or imported from another device). Please reconnect this provider account in Storage & Quota.',
    );
  }
}
