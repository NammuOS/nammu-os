import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('desktop SQLite repository', () => {
  test('uses WAL, applies a ledgered schema, and survives a clean restart', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'nammu-sqlite-test-'));
    try {
      const probe = spawnSync(
        process.env.NAMMU_TEST_NODE || 'node',
        ['tests/helpers/desktopDatabaseProbe.mjs', 'contract', dataDirectory],
        { cwd: process.cwd(), encoding: 'utf8', windowsHide: true },
      );
      expect(probe.status).toBe(0);
      const result = JSON.parse(probe.stdout);
      expect(result.path).toBe(result.expectedPath);
      expect(result.diagnostics).toEqual({
        journalMode: 'wal',
        foreignKeys: 1,
        busyTimeout: 5000,
        schemaVersion: result.schemaVersion,
      });
      expect(result.persistentValue).toBe('{"ok":true}');
      expect(result.created.tool_id).toBe('hash');
      expect(result.history).toHaveLength(1);
      expect(result.history[0].tool_id).toBe('hash');
      expect(result.migrations).toHaveLength(result.schemaVersion);
      expect(result.migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(result.cloudColumns).toContain('credential_ref');
      expect(result.cloudColumns).not.toContain('encrypted_credentials');
      expect(result.fileColumns).not.toContain('contents');
      expect(result.fileColumns).not.toContain('blob');
      expect(result.credentialColumns).toEqual([
        'credential_ref',
        'envelope',
        'created_at',
        'updated_at',
      ]);
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });

  test('fails closed without replacing a corrupted database', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'nammu-sqlite-corrupt-test-'));
    try {
      const probe = spawnSync(
        process.env.NAMMU_TEST_NODE || 'node',
        ['tests/helpers/desktopDatabaseProbe.mjs', 'corruption-contract', dataDirectory],
        { cwd: process.cwd(), encoding: 'utf8', windowsHide: true },
      );
      expect(probe.status).toBe(0);
      expect(JSON.parse(probe.stdout)).toEqual({
        rejected: true,
        originalFilePreserved: true,
      });
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });

  test('keeps migration ledger and schema version transactional on failure', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'nammu-sqlite-migration-test-'));
    try {
      const probe = spawnSync(
        process.env.NAMMU_TEST_NODE || 'node',
        ['tests/helpers/desktopDatabaseProbe.mjs', 'migration-failure-contract', dataDirectory],
        { cwd: process.cwd(), encoding: 'utf8', windowsHide: true },
      );
      expect(probe.status).toBe(0);
      expect(JSON.parse(probe.stdout)).toEqual({
        rejected: true,
        versions: [1],
        userVersion: 1,
      });
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });
});
