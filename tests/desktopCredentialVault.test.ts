import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('desktop credential vault', () => {
  test('encrypts authenticated provider records and enforces its lock lifecycle', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'nammu-vault-test-'));
    try {
      const probe = spawnSync(
        process.env.NAMMU_TEST_NODE || 'node',
        ['tests/helpers/desktopDatabaseProbe.mjs', 'vault-contract', dataDirectory],
        { cwd: process.cwd(), encoding: 'utf8', windowsHide: true },
      );
      expect(probe.status).toBe(0);
      const result = JSON.parse(probe.stdout);
      expect(result).toEqual({
        immediateRoundTripMatches: true,
        correctUnlockRoundTripMatches: true,
        restartRoundTripMatches: true,
        lockedErrors: {
          retrieve: 'CredentialVaultLockedError',
          store: 'CredentialVaultLockedError',
          delete: 'CredentialVaultLockedError',
        },
        wrongKeyRejected: true,
        tamperingRejected: true,
        deleted: true,
        missingAfterDelete: null,
        envelopeCount: 2,
        envelopesAreVersioned: true,
        plaintextAbsent: true,
      });
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });
});
