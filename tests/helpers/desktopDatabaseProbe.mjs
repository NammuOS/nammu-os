import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import {
  DESKTOP_DATABASE_FILE,
  DESKTOP_DATABASE_SCHEMA_VERSION,
  DESKTOP_SETTINGS_USER_ID,
  openDesktopDatabase,
} from '../../src/server/runtime/desktopDatabase.mjs';

const [, , operation, dataDirectory, ...args] = process.argv;
const VAULT_KEY = 'e'.repeat(64);
if (!operation || !dataDirectory) {
  throw new Error('A database probe operation and data path are required.');
}

if (operation === 'contract') {
  const first = openDesktopDatabase(dataDirectory, VAULT_KEY);
  const firstDiagnostics = first.diagnostics;
  const databasePath = first.path;
  await first.settings.upsert(DESKTOP_SETTINGS_USER_ID, 'persistent-test', '{"ok":true}');
  const created = await first.settings.prependHistory(
    DESKTOP_SETTINGS_USER_ID,
    'tool_history',
    { tool_id: 'hash', tool_name: 'Hash', category: 'Developer' },
    50,
  );
  first.close();

  const second = openDesktopDatabase(dataDirectory, VAULT_KEY);
  const persistentValue = await second.settings.get(DESKTOP_SETTINGS_USER_ID, 'persistent-test');
  const history = JSON.parse(
    (await second.settings.get(DESKTOP_SETTINGS_USER_ID, 'tool_history')) || '[]',
  );
  second.close();

  const inspection = new Database(databasePath, { readonly: true });
  const migrations = inspection
    .prepare('SELECT version, id, checksum FROM nammu_migrations ORDER BY version')
    .all();
  const cloudColumns = inspection
    .prepare('PRAGMA table_info(cloud_accounts)')
    .all()
    .map((column) => column.name);
  const fileColumns = inspection
    .prepare('PRAGMA table_info(file_metadata)')
    .all()
    .map((column) => column.name);
  const credentialColumns = inspection
    .prepare('PRAGMA table_info(credential_vault_entries)')
    .all()
    .map((column) => column.name);
  inspection.close();

  process.stdout.write(
    JSON.stringify({
      path: databasePath,
      expectedPath: resolve(dataDirectory, 'data', DESKTOP_DATABASE_FILE),
      schemaVersion: DESKTOP_DATABASE_SCHEMA_VERSION,
      diagnostics: firstDiagnostics,
      persistentValue,
      created,
      history,
      migrations,
      cloudColumns,
      fileColumns,
      credentialColumns,
    }),
  );
} else if (operation === 'vault-contract') {
  const reference = 'provider:google:test-account';
  const tamperedReference = 'provider:mega:tampered-account';
  const credential = {
    accessToken: 'provider-access-token-must-not-appear-in-sqlite',
    refreshToken: 'provider-refresh-token-must-not-appear-in-sqlite',
    expiresAt: 1_800_000_000_000,
  };
  const first = openDesktopDatabase(dataDirectory, VAULT_KEY);
  first.credentials.store(reference, credential);
  first.credentials.store(tamperedReference, credential);
  const immediateRoundTrip = first.credentials.retrieve(reference);
  first.credentials.lock();

  const lockedErrors = {};
  for (const [name, operation] of Object.entries({
    retrieve: () => first.credentials.retrieve(reference),
    store: () => first.credentials.store(reference, credential),
    delete: () => first.credentials.delete(reference),
  })) {
    try {
      operation();
    } catch (error) {
      lockedErrors[name] = error?.name;
    }
  }

  first.credentials.unlock('f'.repeat(64));
  let wrongKeyRejected = false;
  try {
    first.credentials.retrieve(reference);
  } catch {
    wrongKeyRejected = true;
  }
  first.credentials.unlock(VAULT_KEY);
  const correctUnlockRoundTrip = first.credentials.retrieve(reference);
  const databasePath = first.path;
  first.close();

  const inspection = new Database(databasePath);
  const storedRows = inspection
    .prepare(
      'SELECT credential_ref AS credentialRef, envelope FROM credential_vault_entries ORDER BY credential_ref',
    )
    .all();
  const tamperedEnvelope = JSON.parse(
    storedRows.find((row) => row.credentialRef === tamperedReference).envelope,
  );
  tamperedEnvelope.tag = `${tamperedEnvelope.tag[0] === 'A' ? 'B' : 'A'}${tamperedEnvelope.tag.slice(1)}`;
  inspection
    .prepare('UPDATE credential_vault_entries SET envelope = ? WHERE credential_ref = ?')
    .run(JSON.stringify(tamperedEnvelope), tamperedReference);
  inspection.close();

  const second = openDesktopDatabase(dataDirectory, VAULT_KEY);
  const restartRoundTrip = second.credentials.retrieve(reference);
  let tamperingRejected = false;
  try {
    second.credentials.retrieve(tamperedReference);
  } catch {
    tamperingRejected = true;
  }
  const deleted = second.credentials.delete(reference);
  const missingAfterDelete = second.credentials.retrieve(reference);
  second.credentials.delete(tamperedReference);
  second.close();

  const serializedRows = JSON.stringify(storedRows);
  process.stdout.write(
    JSON.stringify({
      immediateRoundTripMatches: JSON.stringify(immediateRoundTrip) === JSON.stringify(credential),
      correctUnlockRoundTripMatches:
        JSON.stringify(correctUnlockRoundTrip) === JSON.stringify(credential),
      restartRoundTripMatches: JSON.stringify(restartRoundTrip) === JSON.stringify(credential),
      lockedErrors,
      wrongKeyRejected,
      tamperingRejected,
      deleted,
      missingAfterDelete,
      envelopeCount: storedRows.length,
      envelopesAreVersioned: storedRows.every((row) => {
        const envelope = JSON.parse(row.envelope);
        return envelope.version === 1 && envelope.algorithm === 'aes-256-gcm';
      }),
      plaintextAbsent:
        !serializedRows.includes(credential.accessToken) &&
        !serializedRows.includes(credential.refreshToken) &&
        !serializedRows.includes(VAULT_KEY),
    }),
  );
} else if (operation === 'get-setting') {
  const [userId, key] = args;
  const database = openDesktopDatabase(dataDirectory, VAULT_KEY);
  const value = await database.settings.get(userId, key);
  database.close();
  process.stdout.write(JSON.stringify({ value }));
} else if (operation === 'corruption-contract') {
  const databaseDirectory = join(dataDirectory, 'data');
  const databasePath = join(databaseDirectory, DESKTOP_DATABASE_FILE);
  mkdirSync(databaseDirectory, { recursive: true });
  writeFileSync(databasePath, 'not-a-sqlite-database');
  const before = readFileSync(databasePath);
  let rejected = false;
  try {
    openDesktopDatabase(dataDirectory, VAULT_KEY);
  } catch {
    rejected = true;
  }
  const after = readFileSync(databasePath);
  process.stdout.write(JSON.stringify({ rejected, originalFilePreserved: before.equals(after) }));
} else if (operation === 'migration-failure-contract') {
  const initial = openDesktopDatabase(dataDirectory, VAULT_KEY);
  const databasePath = initial.path;
  initial.close();

  const staged = new Database(databasePath);
  staged.prepare('DELETE FROM nammu_migrations WHERE version > 1').run();
  staged.pragma('user_version = 1');
  staged.close();

  let rejected = false;
  try {
    openDesktopDatabase(dataDirectory, VAULT_KEY);
  } catch {
    rejected = true;
  }

  const inspection = new Database(databasePath, { readonly: true });
  const versions = inspection
    .prepare('SELECT version FROM nammu_migrations ORDER BY version')
    .all()
    .map((row) => row.version);
  const userVersion = inspection.pragma('user_version', { simple: true });
  inspection.close();
  process.stdout.write(JSON.stringify({ rejected, versions, userVersion }));
} else {
  throw new Error(`Unknown database probe operation: ${operation}`);
}
