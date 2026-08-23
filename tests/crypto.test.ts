import { describe, expect, test } from 'bun:test';
import { encryptJson, decryptJson } from '../src/server/services/cryptoUtils';

describe('AES-256-GCM Symmetric Cryptography', () => {
  test('encrypts and decrypts complex JSON payload safely', () => {
    const payload = {
      apiKey: 'sk_live_998877665544332211',
      refreshToken: 'rt_token_abc_xyz',
      quota: 107374182400,
      nested: { provider: 'google_drive', scopes: ['drive.readonly'] },
    };

    const encrypted = encryptJson(payload);
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(32);
    expect(encrypted).not.toContain('sk_live');

    const decrypted = decryptJson<typeof payload>(encrypted);
    expect(decrypted).toEqual(payload);
  });

  test('fails gracefully on corrupted or tampered ciphertext', () => {
    const tampered = 'corrupted_base64_data_that_cannot_be_decrypted_properly';
    expect(() => decryptJson(tampered)).toThrow(/credentials cannot be decrypted/i);
  });
});
