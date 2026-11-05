import { setTimeout } from 'node:timers/promises';
import { ScopeSchema, type Principal } from '@cai/contracts';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import { LocalArtifactStore } from '@cai/executor';

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    stop.abort();
  });
try {
  if (process.env.MAINTENANCE_ENABLED !== 'true')
    throw new Error('Maintenance is not enabled.');
  const scope = ScopeSchema.parse({
    organisationId: process.env.ORGANISATION_ID,
    repositoryId: process.env.REPOSITORY_ID,
  });
  const principal: Principal = {
    id: 'maintenance-worker',
    scope,
    capabilities: ['assessment.read', 'data.manage'],
  };
  const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
  const store = new LocalArtifactStore('runtime-data/artifacts');
  try {
    do {
      try {
        await database.actions.recover(principal);
        await database.monitor.reconcile(principal);
        await database.retention.sweep(principal);
        await database.artifacts.expire(principal, store);
      } catch {
        console.error(
          'Scoped maintenance is degraded; failed work remains available for retry. No provider or object payload was logged.',
        );
      }
      if (process.argv.includes('--once')) break;
      await setTimeout(5000);
    } while (!stop.signal.aborted);
  } finally {
    await database.close();
  }
} catch {
  console.error(
    'Maintenance failed. Check explicit enablement, scope and database configuration.',
  );
  process.exitCode = 1;
}
