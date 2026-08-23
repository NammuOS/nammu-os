import { describe, expect, test } from 'bun:test';
import {
  selectBestAccount,
  withFreeSpace,
  type SpaceAccount,
} from '../src/server/services/spaceAllocator';

describe('Multi-Cloud Space Allocator', () => {
  const mockAccounts: SpaceAccount[] = [
    withFreeSpace({
      id: 'acc-gdrive',
      provider: 'google_drive',
      email: 'user1@gmail.com',
      totalSpace: 15 * 1024 * 1024 * 1024,
      usedSpace: 5 * 1024 * 1024 * 1024,
      status: 'active',
    }),
    withFreeSpace({
      id: 'acc-onedrive',
      provider: 'onedrive',
      email: 'user2@outlook.com',
      totalSpace: 5 * 1024 * 1024 * 1024,
      usedSpace: 1 * 1024 * 1024 * 1024,
      status: 'active',
    }),
    withFreeSpace({
      id: 'acc-dropbox',
      provider: 'dropbox',
      email: 'user3@dropbox.com',
      totalSpace: 2 * 1024 * 1024 * 1024,
      usedSpace: 1.8 * 1024 * 1024 * 1024,
      status: 'active',
    }),
  ];

  test('calculates correct free space and used ratios', () => {
    const gdrive = mockAccounts[0];
    expect(gdrive.freeSpace).toBe(10 * 1024 * 1024 * 1024);
    expect(gdrive.usedRatio).toBeCloseTo(0.333, 2);
  });

  test('selects most_free account with greatest available quota', () => {
    const { selected } = selectBestAccount('test-user', mockAccounts, 'most_free', 1024);
    expect(selected.id).toBe('acc-gdrive');
  });

  test('selects least_used account with lowest utilization percentage', () => {
    const { selected } = selectBestAccount('test-user', mockAccounts, 'least_used', 1024);
    expect(selected.id).toBe('acc-onedrive'); // 20% used vs 33% gdrive
  });

  test('provides fallback chain sorted by free space', () => {
    const { selected, fallbackChain } = selectBestAccount(
      'test-user',
      mockAccounts,
      'most_free',
      1024,
    );
    expect(selected.id).toBe('acc-gdrive');
    expect(fallbackChain.length).toBe(2);
    expect(fallbackChain[0].id).toBe('acc-onedrive');
    expect(fallbackChain[1].id).toBe('acc-dropbox');
  });

  test('throws error if no accounts available', () => {
    expect(() => selectBestAccount('test-user', [], 'most_free')).toThrow(
      /No active cloud account/i,
    );
  });
});
