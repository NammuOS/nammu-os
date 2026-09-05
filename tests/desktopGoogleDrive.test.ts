import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('desktop Google Drive persistence', () => {
  test('commits tokens only to the vault, survives restart, refreshes with rotation, and disconnects atomically', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nammu-google-drive-test-'));
    try {
      const probe = spawnSync(
        process.env.NAMMU_TEST_NODE || 'node',
        ['tests/helpers/desktopGoogleDriveProbe.mjs', directory],
        { cwd: process.cwd(), encoding: 'utf8', windowsHide: true },
      );
      expect(probe.status).toBe(0);
      const result = JSON.parse(probe.stdout);
      expect(result.connected).toMatchObject({
        email: 'desktop@example.com',
        provider: 'google_drive',
        label: 'Primary Drive',
      });
      expect(result.serializedConnectionContainsToken).toBe(false);
      expect(result.rootFileNames).toEqual(['Documents']);
      expect(result.childFile).toMatchObject({
        file_name: 'Plan.txt',
        is_shared: false,
      });
      expect(result.sharedFileNames).toEqual(['Luxury Clips', 'Shared Brief.txt']);
      expect(result.sharedFolderChildNames).toEqual(['Edited', 'Shared Clip.mp4']);
      expect(result.nestedSharedChildNames).toEqual(['Final Cut.mp4']);
      expect(result.leakedSharedChildNames).toEqual([]);
      expect(result.accountColumnsContainToken).toBe(false);
      expect(result.restartAccountCount).toBe(1);
      expect(result.rotatedCredentials).toBe(true);
      expect(result.refreshUsesClientMetadata).toBe(true);
      expect(result.databaseContainsClientMetadata).toBe(false);
      expect(result.revokedFailureCount).toBe(1);
      expect(result.revokedStatus).toBe('invalid_token');
      expect(result.afterDisconnect).toEqual({ accounts: [], credential: null, files: [] });
      const databaseBytes = readFileSync(result.databasePath);
      expect(databaseBytes.includes(Buffer.from('initial-access-token'))).toBe(false);
      expect(databaseBytes.includes(Buffer.from('initial-refresh-token'))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
