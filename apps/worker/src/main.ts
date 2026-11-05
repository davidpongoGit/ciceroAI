import { setTimeout } from 'node:timers/promises';
import { MockModelProvider, ScopeSchema } from '@cai/contracts';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import { processOne } from './worker.js';

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    stop.abort();
  });
try {
  const scope = ScopeSchema.parse({
    organisationId: process.env.ORGANISATION_ID,
    repositoryId: process.env.REPOSITORY_ID,
  });
  const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
  try {
    const provider = new MockModelProvider();
    do {
      const worked = await processOne(database.workflows, scope, provider);
      if (process.argv.includes('--once')) break;
      if (!worked && !stop.signal.aborted) await setTimeout(500);
    } while (!stop.signal.aborted);
  } finally {
    await database.close();
  }
} catch {
  console.error(
    'Worker failed. Check scoped configuration, database and migrations; no credentials were logged.',
  );
  process.exitCode = 1;
}
