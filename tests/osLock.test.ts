import { describe, expect, test } from 'bun:test';
import {
  createLockProfile,
  getLockDisplayName,
  normalizeLockUsername,
  verifyLockPassword,
} from '../src/lib/osLock';

describe('OS lock credentials', () => {
  test('normalizes local usernames and derives display names', () => {
    expect(normalizeLockUsername('  nav ne!@#._-  ')).toBe('navne._-');
    expect(getLockDisplayName('navne.kumar')).toBe('Navne Kumar');
  });

  test('stores a salted password hash and verifies it', async () => {
    const profile = await createLockProfile('nammu.user', 'secure-password');

    expect(profile.passwordHash).not.toContain('secure-password');
    expect(profile.passwordSalt).toHaveLength(32);
    expect(await verifyLockPassword(profile, 'secure-password')).toBe(true);
    expect(await verifyLockPassword(profile, 'wrong-password')).toBe(false);
  });

  test('rejects unusable profile credentials', async () => {
    expect(createLockProfile('n', 'secure-password')).rejects.toThrow(
      'Username must contain at least 2 characters.',
    );
    expect(createLockProfile('nammu', '123')).rejects.toThrow(
      'Password must contain at least 6 characters.',
    );
  });
});
