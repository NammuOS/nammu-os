import { Readable } from 'node:stream';
import { describe, expect, it } from 'bun:test';

import { createCloudAdapter, isImplementedCloudProvider } from '@/server/adapters/adapterFactory';
import { sliceDownloadStream, type CloudAccountRecord } from '@/server/adapters/cloudAdapter';
import { createOAuthState, verifyOAuthState } from './oauthStateService';
import { selectBestAccount, type SpaceAccount } from './spaceAllocator';
import { decryptJson, encryptJson } from './cryptoUtils';

const providers = ['google_drive', 'mega', 'onedrive', 'dropbox', 'pcloud', 'yandex', 's3'];

function account(provider: string): CloudAccountRecord {
  return {
    id: `${provider}-account`,
    userId: 'local-default-user',
    email: `${provider}@example.com`,
    provider,
    encryptedCredentials: encryptJson({}),
    totalSpace: 100,
    usedSpace: 20,
    status: 'active',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe('multi-provider contracts', () => {
  it('has a concrete adapter for every provider exposed by Cloud UI', () => {
    for (const provider of providers) {
      expect(isImplementedCloudProvider(provider)).toBe(true);
      expect(createCloudAdapter(account(provider)).account.provider).toBe(provider);
    }
  });

  it('binds OAuth state to its provider and expiry', () => {
    const state = createOAuthState('dropbox', 'local-default-user', 1_000);
    expect(verifyOAuthState(state, 'dropbox', 2_000).userId).toBe('local-default-user');
    expect(() => verifyOAuthState(state, 'onedrive', 2_000)).toThrow('invalid or expired');
    expect(() => verifyOAuthState(state, 'dropbox', 601_001)).toThrow('invalid or expired');
  });

  it('honors manual allocation and skips accounts without enough space', () => {
    const accounts: SpaceAccount[] = [
      {
        id: 'first',
        provider: 'mega',
        email: 'first@example.com',
        totalSpace: 100,
        usedSpace: 95,
        freeSpace: 5,
        usedRatio: 0.95,
        status: 'active',
      },
      {
        id: 'second',
        provider: 'google_drive',
        email: 'second@example.com',
        totalSpace: 100,
        usedSpace: 20,
        freeSpace: 80,
        usedRatio: 0.2,
        status: 'active',
      },
    ];
    const result = selectBestAccount('manual-test', accounts, 'manual', 10, ['first', 'second']);
    expect(result.selected.id).toBe('second');
  });

  it('encrypts credentials while retaining legacy account compatibility', () => {
    const encrypted = encryptJson({ accessToken: 'secret-token' });
    expect(encrypted).not.toContain('secret-token');
    expect(decryptJson<Record<string, unknown>>(encrypted)).toEqual({
      accessToken: 'secret-token',
    });

    const legacy = Buffer.from(JSON.stringify({ password: 'legacy-secret' })).toString('base64');
    expect(decryptJson<Record<string, unknown>>(legacy)).toEqual({
      password: 'legacy-secret',
    });
  });

  it('returns the exact requested bytes when a provider ignores range headers', async () => {
    const stream = sliceDownloadStream(Readable.from(Buffer.from('0123456789')), {
      start: 3,
      end: 6,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('3456');
  });

  it('limits an upstream range response to the declared byte window', async () => {
    const stream = sliceDownloadStream(
      Readable.from(Buffer.from('3456789')),
      { start: 3, end: 6 },
      true,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('3456');
  });
});
