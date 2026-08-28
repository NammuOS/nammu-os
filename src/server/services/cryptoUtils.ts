import crypto from 'crypto';
import { env } from '@/lib/env';

const encryptionKey = crypto.createHash('sha256').update(env.AUTH_SECRET).digest();
const ENCRYPTED_PREFIX = 'enc:v1:';

export function encryptJson(payload: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${Buffer.concat([iv, authTag, encrypted]).toString('base64')}`;
}

function decryptEncryptedJson<T>(value: string): T {
  const encoded = value.startsWith(ENCRYPTED_PREFIX) ? value.slice(ENCRYPTED_PREFIX.length) : value;
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length < 29) throw new Error('Encrypted credential payload is too short.');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  try {
    return JSON.parse(decrypted.toString('utf8')) as T;
  } finally {
    decrypted.fill(0);
  }
}

export function decryptJson<T = Record<string, unknown>>(value: string): T {
  try {
    if (value.startsWith(ENCRYPTED_PREFIX)) return decryptEncryptedJson<T>(value);

    // Accounts created before the credential vault stored Base64-encoded JSON.
    // Keep reading them so reconnecting is not required; all subsequent writes
    // use authenticated encryption and migrate the account transparently.
    const legacy = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as T;
    if (!legacy || typeof legacy !== 'object') throw new Error('Credentials are empty.');
    return legacy;
  } catch {
    try {
      // Compatibility with the original unprefixed AES-GCM format.
      return decryptEncryptedJson<T>(value);
    } catch {
      throw new Error(
        'Cloud account credentials cannot be decrypted (encryption key changed or imported from another device). Please reconnect this provider account in Storage & Quota.',
      );
    }
  }
}
