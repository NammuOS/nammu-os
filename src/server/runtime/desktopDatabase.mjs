import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createCredentialVault } from './desktopCredentialVault.mjs';

export const DESKTOP_DATABASE_FILE = 'nammu-os.sqlite3';
export const DESKTOP_DATABASE_SCHEMA_VERSION = 3;
export const DESKTOP_SETTINGS_USER_ID = 'local-default-user';

const migrations = Object.freeze([
  Object.freeze({
    version: 1,
    id: '0001_initial_local_schema',
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL DEFAULT '',
        is_local INTEGER NOT NULL DEFAULT 0 CHECK (is_local IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_auth_sessions_user_id ON auth_sessions(user_id);

      CREATE TABLE cloud_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        provider TEXT NOT NULL,
        credential_ref TEXT NOT NULL,
        total_space INTEGER NOT NULL DEFAULT 0,
        used_space INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, provider, email)
      ) STRICT;
      CREATE INDEX idx_cloud_accounts_user_id ON cloud_accounts(user_id);

      CREATE TABLE file_metadata (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        virtual_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        is_folder INTEGER NOT NULL DEFAULT 0 CHECK (is_folder IN (0, 1)),
        is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
        is_trashed INTEGER NOT NULL DEFAULT 0 CHECK (is_trashed IN (0, 1)),
        size INTEGER NOT NULL DEFAULT 0,
        mime_type TEXT,
        cloud_account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
        remote_file_id TEXT NOT NULL,
        remote_parent_id TEXT,
        remote_created_time TEXT,
        remote_modified_time TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(cloud_account_id, remote_file_id)
      ) STRICT;
      CREATE INDEX idx_file_virtual_path ON file_metadata(user_id, virtual_path);
      CREATE INDEX idx_file_remote_id ON file_metadata(user_id, remote_file_id);
      CREATE INDEX idx_file_user_account_id ON file_metadata(user_id, cloud_account_id);

      CREATE TABLE user_settings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, key)
      ) STRICT;

      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        folder TEXT NOT NULL DEFAULT 'Notes',
        is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_notes_user_id ON notes(user_id);

      CREATE TABLE calendar_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'personal',
        color TEXT NOT NULL DEFAULT '#3b82f6',
        is_all_day INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_calendar_events_user_id ON calendar_events(user_id);

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        priority TEXT NOT NULL DEFAULT 'medium',
        space TEXT NOT NULL DEFAULT 'General',
        deadline TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        tasks TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_projects_user_id ON projects(user_id);
    `,
  }),
  Object.freeze({
    version: 2,
    id: '0002_credential_vault_envelopes',
    sql: `
      CREATE TABLE credential_vault_entries (
        credential_ref TEXT PRIMARY KEY,
        envelope TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  }),
  Object.freeze({
    version: 3,
    id: '0003_google_drive_desktop_metadata',
    sql: `
      ALTER TABLE cloud_accounts ADD COLUMN label TEXT;
      ALTER TABLE file_metadata ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0
        CHECK (is_shared IN (0, 1));
      CREATE INDEX idx_file_shared ON file_metadata(user_id, is_shared);
    `,
  }),
]);

function applyMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS nammu_migrations (
      version INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const readMigration = database.prepare(
    'SELECT id, checksum FROM nammu_migrations WHERE version = ?',
  );
  const insertMigration = database.prepare(
    'INSERT INTO nammu_migrations (version, id, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );

  for (const migration of migrations) {
    const checksum = createHash('sha256').update(migration.sql).digest('hex');
    const existing = readMigration.get(migration.version);
    if (existing) {
      if (existing.id !== migration.id || existing.checksum !== checksum) {
        throw new Error(
          `Desktop database migration ${migration.version} does not match its ledger.`,
        );
      }
      continue;
    }

    database.transaction(() => {
      database.exec(migration.sql);
      insertMigration.run(migration.version, migration.id, checksum, new Date().toISOString());
      database.pragma(`user_version = ${migration.version}`);
    })();
  }
}

export function openDesktopDatabase(dataDirectory, vaultKey) {
  const databaseDirectory = join(dataDirectory, 'data');
  mkdirSync(databaseDirectory, { recursive: true });
  const path = join(databaseDirectory, DESKTOP_DATABASE_FILE);
  const database = new Database(path, { timeout: 5_000 });

  try {
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    database.pragma('trusted_schema = OFF');
    applyMigrations(database);

    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO users (id, email, is_local, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(DESKTOP_SETTINGS_USER_ID, 'local@nammu.os', now, now);

    const getSetting = database.prepare(
      'SELECT value FROM user_settings WHERE user_id = ? AND key = ?',
    );
    const listSettings = database.prepare(
      'SELECT key, value FROM user_settings WHERE user_id = ? ORDER BY key ASC',
    );
    const upsertSetting = database.prepare(`
      INSERT INTO user_settings (id, user_id, key, value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    const historyTransaction = database.transaction((userId, key, entry, limit) => {
      const row = getSetting.get(userId, key);
      let history = [];
      try {
        const parsed = JSON.parse(row?.value ?? '[]');
        if (Array.isArray(parsed)) history = parsed;
      } catch {}
      const created = { id: randomUUID(), ...entry, used_at: new Date().toISOString() };
      history = [created, ...history].slice(0, limit);
      const timestamp = new Date().toISOString();
      upsertSetting.run(randomUUID(), userId, key, JSON.stringify(history), timestamp, timestamp);
      return created;
    });
    const credentials = createCredentialVault(database, vaultKey);

    const listCloudAccounts = database.prepare(`
      SELECT id, user_id, email, provider, credential_ref, total_space, used_space,
             status, label, created_at, updated_at
      FROM cloud_accounts
      WHERE user_id = ?
      ORDER BY created_at ASC
    `);
    const getCloudAccount = database.prepare(`
      SELECT id, user_id, email, provider, credential_ref, total_space, used_space,
             status, label, created_at, updated_at
      FROM cloud_accounts
      WHERE id = ? AND user_id = ?
    `);
    const findCloudAccount = database.prepare(`
      SELECT id, user_id, email, provider, credential_ref, total_space, used_space,
             status, label, created_at, updated_at
      FROM cloud_accounts
      WHERE user_id = ? AND provider = ? AND email = ?
    `);
    const upsertCloudAccount = database.prepare(`
      INSERT INTO cloud_accounts (
        id, user_id, email, provider, credential_ref, total_space, used_space,
        status, label, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider, email) DO UPDATE SET
        credential_ref = excluded.credential_ref,
        total_space = excluded.total_space,
        used_space = excluded.used_space,
        status = excluded.status,
        label = COALESCE(excluded.label, cloud_accounts.label),
        updated_at = excluded.updated_at
    `);
    const updateCloudAccount = database.prepare(`
      UPDATE cloud_accounts
      SET total_space = COALESCE(?, total_space),
          used_space = COALESCE(?, used_space),
          status = COALESCE(?, status),
          updated_at = ?
      WHERE id = ? AND user_id = ?
    `);
    const deleteCloudAccount = database.prepare(
      'DELETE FROM cloud_accounts WHERE id = ? AND user_id = ?',
    );
    const deleteCredentialEntry = database.prepare(
      'DELETE FROM credential_vault_entries WHERE credential_ref = ?',
    );
    const commitGoogleAccount = database.transaction((account, credential) => {
      credentials.store(account.credentialRef, credential);
      upsertCloudAccount.run(
        account.id,
        account.userId,
        account.email,
        'google_drive',
        account.credentialRef,
        account.totalSpace,
        account.usedSpace,
        'active',
        account.label,
        account.createdAt,
        account.updatedAt,
      );
      return findCloudAccount.get(account.userId, 'google_drive', account.email);
    });
    const disconnectCloudAccount = database.transaction((accountId, userId) => {
      const account = getCloudAccount.get(accountId, userId);
      if (!account) return false;
      deleteCredentialEntry.run(account.credential_ref);
      deleteCloudAccount.run(accountId, userId);
      return true;
    });

    const listCloudFiles = database.prepare(`
      SELECT f.*, a.provider, a.email
      FROM file_metadata f
      JOIN cloud_accounts a ON a.id = f.cloud_account_id
      WHERE f.user_id = ?
      ORDER BY f.is_folder DESC, f.file_name COLLATE NOCASE ASC
    `);
    const getCloudFile = database.prepare(`
      SELECT f.*, a.provider, a.email, a.credential_ref, a.status AS account_status
      FROM file_metadata f
      JOIN cloud_accounts a ON a.id = f.cloud_account_id
      WHERE f.id = ? AND f.user_id = ?
    `);
    const getCloudFileByRemote = database.prepare(`
      SELECT f.*, a.provider, a.email, a.credential_ref, a.status AS account_status
      FROM file_metadata f
      JOIN cloud_accounts a ON a.id = f.cloud_account_id
      WHERE f.cloud_account_id = ? AND f.remote_file_id = ? AND f.user_id = ?
    `);
    const deleteAccountFiles = database.prepare(
      'DELETE FROM file_metadata WHERE cloud_account_id = ?',
    );
    const insertCloudFile = database.prepare(`
      INSERT INTO file_metadata (
        id, user_id, virtual_path, file_name, is_folder, is_starred, is_trashed,
        is_shared, size, mime_type, cloud_account_id, remote_file_id, remote_parent_id,
        remote_created_time, remote_modified_time, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertCloudFile = database.prepare(`
      INSERT INTO file_metadata (
        id, user_id, virtual_path, file_name, is_folder, is_starred, is_trashed,
        is_shared, size, mime_type, cloud_account_id, remote_file_id, remote_parent_id,
        remote_created_time, remote_modified_time, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cloud_account_id, remote_file_id) DO UPDATE SET
        virtual_path = excluded.virtual_path,
        file_name = excluded.file_name,
        is_folder = excluded.is_folder,
        is_starred = excluded.is_starred,
        is_trashed = excluded.is_trashed,
        is_shared = excluded.is_shared,
        size = excluded.size,
        mime_type = excluded.mime_type,
        remote_parent_id = excluded.remote_parent_id,
        remote_created_time = excluded.remote_created_time,
        remote_modified_time = excluded.remote_modified_time,
        updated_at = excluded.updated_at
    `);
    const upsertAccountFiles = database.transaction((accountId, userId, files) => {
      for (const file of files) {
        upsertCloudFile.run(
          file.id,
          userId,
          file.virtualPath,
          file.fileName,
          file.isFolder ? 1 : 0,
          file.isStarred ? 1 : 0,
          file.isTrashed ? 1 : 0,
          file.isShared ? 1 : 0,
          file.size,
          file.mimeType,
          accountId,
          file.remoteFileId,
          file.remoteParentId,
          file.remoteCreatedTime,
          file.remoteModifiedTime,
          file.createdAt,
          file.updatedAt,
        );
      }
    });
    const replaceAccountFiles = database.transaction((accountId, userId, files) => {
      deleteAccountFiles.run(accountId);
      for (const file of files) {
        insertCloudFile.run(
          file.id,
          userId,
          file.virtualPath,
          file.fileName,
          file.isFolder ? 1 : 0,
          file.isStarred ? 1 : 0,
          file.isTrashed ? 1 : 0,
          file.isShared ? 1 : 0,
          file.size,
          file.mimeType,
          accountId,
          file.remoteFileId,
          file.remoteParentId,
          file.remoteCreatedTime,
          file.remoteModifiedTime,
          file.createdAt,
          file.updatedAt,
        );
      }
    });

    return Object.freeze({
      path,
      settings: Object.freeze({
        async get(userId, key) {
          return getSetting.get(userId, key)?.value ?? null;
        },
        async list(userId) {
          return listSettings.all(userId);
        },
        async upsert(userId, key, value) {
          const timestamp = new Date().toISOString();
          upsertSetting.run(randomUUID(), userId, key, value, timestamp, timestamp);
        },
        async prependHistory(userId, key, entry, limit) {
          return historyTransaction(userId, key, entry, limit);
        },
      }),
      credentials,
      cloudAccounts: Object.freeze({
        list(userId = DESKTOP_SETTINGS_USER_ID) {
          return listCloudAccounts.all(userId);
        },
        get(accountId, userId = DESKTOP_SETTINGS_USER_ID) {
          return getCloudAccount.get(accountId, userId) ?? null;
        },
        findGoogleByEmail(email, userId = DESKTOP_SETTINGS_USER_ID) {
          return findCloudAccount.get(userId, 'google_drive', email) ?? null;
        },
        commitGoogle(account, credential) {
          return commitGoogleAccount(account, credential);
        },
        update(accountId, changes, userId = DESKTOP_SETTINGS_USER_ID) {
          return (
            updateCloudAccount.run(
              changes.totalSpace ?? null,
              changes.usedSpace ?? null,
              changes.status ?? null,
              new Date().toISOString(),
              accountId,
              userId,
            ).changes > 0
          );
        },
        disconnect(accountId, userId = DESKTOP_SETTINGS_USER_ID) {
          return disconnectCloudAccount(accountId, userId);
        },
      }),
      cloudFiles: Object.freeze({
        list(userId = DESKTOP_SETTINGS_USER_ID) {
          return listCloudFiles.all(userId);
        },
        get(fileId, userId = DESKTOP_SETTINGS_USER_ID) {
          return getCloudFile.get(fileId, userId) ?? null;
        },
        getByRemote(accountId, remoteFileId, userId = DESKTOP_SETTINGS_USER_ID) {
          return getCloudFileByRemote.get(accountId, remoteFileId, userId) ?? null;
        },
        replaceForAccount(accountId, files, userId = DESKTOP_SETTINGS_USER_ID) {
          replaceAccountFiles(accountId, userId, files);
        },
        upsertForAccount(accountId, files, userId = DESKTOP_SETTINGS_USER_ID) {
          upsertAccountFiles(accountId, userId, files);
        },
      }),
      diagnostics: Object.freeze({
        journalMode: database.pragma('journal_mode', { simple: true }),
        foreignKeys: database.pragma('foreign_keys', { simple: true }),
        busyTimeout: database.pragma('busy_timeout', { simple: true }),
        schemaVersion: database.pragma('user_version', { simple: true }),
      }),
      close() {
        credentials.lock();
        if (database.open) database.close();
      },
    });
  } catch (error) {
    database.close();
    throw error;
  }
}
