import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// 1. Users
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull().default(''),
  isLocal: boolean('is_local').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// 2. Auth Sessions
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdIdx: index('idx_auth_sessions_user_id').on(table.userId),
  }),
);

// 3. Cloud Provider Accounts (Multi-Cloud Google Drive, OneDrive, Dropbox, Mega, S3, Yandex)
export const cloudAccounts = pgTable(
  'cloud_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    provider: text('provider').notNull(), // 'google_drive' | 'onedrive' | 'dropbox' | 'mega' | 's3' | 'yandex'
    encryptedCredentials: text('encrypted_credentials').notNull(),
    totalSpace: bigint('total_space', { mode: 'number' }).notNull().default(0),
    usedSpace: bigint('used_space', { mode: 'number' }).notNull().default(0),
    status: text('status').notNull().default('active'), // 'active' | 'suspended' | 'invalid_token'
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userProviderEmailIdx: uniqueIndex('idx_cloud_accounts_user_provider_email').on(
      table.userId,
      table.provider,
      table.email,
    ),
    userIdIdx: index('idx_cloud_accounts_user_id').on(table.userId),
  }),
);

// 4. File Metadata (Unified Virtual Filesystem)
export const fileMetadata = pgTable(
  'file_metadata',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    virtualPath: text('virtual_path').notNull(),
    fileName: text('file_name').notNull(),
    isFolder: boolean('is_folder').notNull().default(false),
    isStarred: boolean('is_starred').notNull().default(false),
    isTrashed: boolean('is_trashed').notNull().default(false),
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    mimeType: text('mime_type'),
    cloudAccountId: text('cloud_account_id')
      .notNull()
      .references(() => cloudAccounts.id, { onDelete: 'cascade' }),
    remoteFileId: text('remote_file_id').notNull(),
    remoteParentId: text('remote_parent_id'),
    remoteCreatedTime: text('remote_created_time'),
    remoteModifiedTime: text('remote_modified_time'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    virtualPathIdx: index('idx_file_virtual_path').on(table.userId, table.virtualPath),
    remoteIdIdx: index('idx_file_remote_id').on(table.userId, table.remoteFileId),
    accountRemoteIdx: uniqueIndex('idx_file_account_remote_id').on(
      table.cloudAccountId,
      table.remoteFileId,
    ),
    userAccountIdx: index('idx_file_user_account_id').on(table.userId, table.cloudAccountId),
  }),
);

// 5. User Settings & Desktop Preferences
export const userSettings = pgTable(
  'user_settings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userKeyIdx: uniqueIndex('idx_user_settings_user_key').on(table.userId, table.key),
  }),
);

// 6. Notes App
export const notes = pgTable(
  'notes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    tags: text('tags').notNull().default('[]'),
    folder: text('folder').notNull().default('Notes'),
    isPinned: boolean('is_pinned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdIdx: index('idx_notes_user_id').on(table.userId),
  }),
);

// 7. Calendar Events
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    category: text('category').notNull().default('personal'),
    color: text('color').notNull().default('#3b82f6'),
    isAllDay: boolean('is_all_day').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdIdx: index('idx_calendar_events_user_id').on(table.userId),
  }),
);

// 8. Projects & Task Board
export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('active'), // 'active' | 'in-progress' | 'completed' | 'archived'
    priority: text('priority').notNull().default('medium'),
    space: text('space').notNull().default('General'),
    deadline: text('deadline'),
    tags: text('tags').notNull().default('[]'),
    tasks: text('tasks').notNull().default('[]'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdIdx: index('idx_projects_user_id').on(table.userId),
  }),
);
