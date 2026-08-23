import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/nammu_os';

// Global singleton client for serverless Next.js connection caching
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const conn =
  globalForDb.conn ??
  postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== 'production') globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
export * from './schema';

export async function ensureDefaultUser() {
  try {
    await db
      .insert(schema.users)
      .values({
        id: 'local-default-user',
        email: 'local@nammu.os',
        isLocal: true,
      })
      .onConflictDoNothing();
  } catch {}
}

