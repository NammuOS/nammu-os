import crypto from 'node:crypto';

import { env } from '@/lib/env';

interface OAuthState {
  expiresAt: number;
  nonce: string;
  provider: string;
  userId: string;
}

function key(): Buffer {
  return crypto
    .createHash('sha256')
    .update(process.env.OAUTH_STATE_SECRET || env.AUTH_SECRET)
    .digest();
}

export function createOAuthState(provider: string, userId: string, now = Date.now()): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const payload: OAuthState = {
    provider,
    userId,
    nonce: crypto.randomUUID(),
    expiresAt: now + 10 * 60 * 1000,
  };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function verifyOAuthState(
  token: string | null,
  expectedProvider: string,
  now = Date.now(),
): OAuthState {
  try {
    if (!token) throw new Error('missing');
    const [version, iv, tag, payload, ...extra] = token.split('.');
    if (version !== 'v1' || !iv || !tag || !payload || extra.length) throw new Error('invalid');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const state = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(payload, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    ) as OAuthState;
    if (
      state.provider !== expectedProvider ||
      state.expiresAt < now ||
      !state.userId ||
      !state.nonce
    ) {
      throw new Error('invalid');
    }
    return state;
  } catch {
    throw new Error('The OAuth session is invalid or expired. Start the connection again.');
  }
}
