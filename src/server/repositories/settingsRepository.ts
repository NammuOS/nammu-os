import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { userSettings, users } from '@/db/schema';

export const LOCAL_SETTINGS_USER_ID = 'local-default-user';

export interface SettingsRecord {
  key: string;
  value: string;
}

export interface SettingsRepository {
  get(userId: string, key: string): Promise<string | null>;
  list(userId: string): Promise<readonly SettingsRecord[]>;
  upsert(userId: string, key: string, value: string): Promise<void>;
  prependHistory(
    userId: string,
    key: string,
    entry: Record<string, unknown>,
    limit: number,
  ): Promise<Record<string, unknown>>;
}

async function ensureUser(executor: Pick<typeof db, 'insert'>, userId: string) {
  await executor
    .insert(users)
    .values({
      id: userId,
      email: userId === LOCAL_SETTINGS_USER_ID ? 'local@nammu.os' : `${userId}@local.nammu.os`,
      isLocal: true,
    })
    .onConflictDoNothing();
}

export const postgresSettingsRepository: SettingsRepository = {
  async get(userId, key) {
    const item = await db.query.userSettings.findFirst({
      where: and(eq(userSettings.userId, userId), eq(userSettings.key, key)),
    });
    return item?.value ?? null;
  },

  async list(userId) {
    return db
      .select({ key: userSettings.key, value: userSettings.value })
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
  },

  async upsert(userId, key, value) {
    await ensureUser(db, userId);
    await db
      .insert(userSettings)
      .values({ id: crypto.randomUUID(), userId, key, value })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.key],
        set: { value, updatedAt: new Date() },
      });
  },

  async prependHistory(userId, key, entry, limit) {
    return db.transaction(async (transaction) => {
      await ensureUser(transaction, userId);
      const [existing] = await transaction
        .select({ value: userSettings.value })
        .from(userSettings)
        .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
        .for('update')
        .limit(1);

      let history: Record<string, unknown>[] = [];
      try {
        const parsed = JSON.parse(existing?.value ?? '[]');
        if (Array.isArray(parsed)) history = parsed;
      } catch {}

      const created = {
        id: crypto.randomUUID(),
        ...entry,
        used_at: new Date().toISOString(),
      };
      history = [created, ...history].slice(0, limit);
      await transaction
        .insert(userSettings)
        .values({ id: crypto.randomUUID(), userId, key, value: JSON.stringify(history) })
        .onConflictDoUpdate({
          target: [userSettings.userId, userSettings.key],
          set: { value: JSON.stringify(history), updatedAt: new Date() },
        });
      return created;
    });
  },
};
