import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { readDatabaseUrl } from './config.js';
import { installationMetadata } from './schema.js';

export { readDatabaseUrl } from './config.js';

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString: readDatabaseUrl(connectionString),
    max: 2,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 6000,
    idle_in_transaction_session_timeout: 5000,
  });
  // Idle-client errors must not become uncaught exceptions or disclose credentials.
  pool.on('error', () => {
    console.error('Database idle connection failed.');
  });
  const db = drizzle(pool);

  return {
    async migrate(): Promise<void> {
      await migrate(db, {
        migrationsFolder: fileURLToPath(
          new URL('../drizzle/', import.meta.url),
        ),
      });
    },
    async smoke(): Promise<void> {
      const id = randomUUID();
      const rollback = new Error('Synthetic smoke rollback');
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`select 1`);
          await tx.insert(installationMetadata).values({ id });
          const [row] = await tx
            .select()
            .from(installationMetadata)
            .where(eq(installationMetadata.id, id));
          if (row?.formatVersion !== 1 || !(row.createdAt instanceof Date)) {
            throw new Error('Installation metadata round-trip failed.');
          }
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
      const remaining = await db
        .select()
        .from(installationMetadata)
        .where(eq(installationMetadata.id, id));
      if (remaining.length !== 0)
        throw new Error('Smoke transaction did not roll back.');
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
