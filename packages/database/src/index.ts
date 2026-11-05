import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { readDatabaseUrl } from './config.js';
import { installationMetadata } from './schema.js';
import { PostgresWorkflowStore } from './workflows.js';
import { PostgresKnowledgeStore } from './knowledge.js';
import { PostgresGraphStore } from './graph.js';
import { PostgresCoverageStore } from './coverage.js';
import { PostgresPlanStore } from './plans.js';
import { PostgresArtifactCatalog } from './artifacts.js';
import { PostgresActionStore } from './actions.js';
import { PostgresMonitor } from './monitor.js';
import { PostgresLifecycle } from './lifecycle.js';
import { PostgresRetention } from './retention.js';

export { readDatabaseUrl } from './config.js';
export { DeliveryConflict } from './workflows.js';

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
  const knowledge = new PostgresKnowledgeStore(pool);
  const graph = new PostgresGraphStore(pool);
  const plans = new PostgresPlanStore(pool, knowledge, graph);

  return {
    workflows: new PostgresWorkflowStore(pool),
    knowledge,
    coverage: new PostgresCoverageStore(pool, knowledge),
    graph,
    plans,
    actions: new PostgresActionStore(pool, plans),
    monitor: new PostgresMonitor(pool, graph),
    lifecycle: new PostgresLifecycle(pool),
    retention: new PostgresRetention(pool),
    artifacts: new PostgresArtifactCatalog(pool, knowledge),
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
