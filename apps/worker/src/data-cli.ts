import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ScopeSchema, type Principal } from '@cai/contracts';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import { LocalArtifactStore } from '@cai/executor';

try {
  if (process.env.MAINTENANCE_ENABLED !== 'true')
    throw new Error('Scoped data management is not enabled.');
  const scope = ScopeSchema.parse({
    organisationId: process.env.ORGANISATION_ID,
    repositoryId: process.env.REPOSITORY_ID,
  });
  const principal: Principal = {
    id: 'local-data-operator',
    scope,
    capabilities: ['assessment.read', 'data.manage'],
  };
  const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
  const store = new LocalArtifactStore('runtime-data/artifacts');
  try {
    const command = process.argv[2];
    if (command === 'export') {
      const exported = await database.lifecycle.exportScope(principal);
      await mkdir('runtime-data/exports', { recursive: true });
      const file = `runtime-data/exports/${randomUUID()}.json`;
      await writeFile(file, JSON.stringify(exported), { mode: 0o600 });
      console.info(
        `Scoped logical snapshot and artifact manifest written to ${file}. Back up object bytes separately.`,
      );
    } else if (command === 'restore') {
      if (process.env.RESTORE_ENABLED !== 'true')
        throw new Error(
          'Restore requires explicit RESTORE_ENABLED=true and an empty migrated destination scope.',
        );
      const selected = process.argv[3];
      if (!selected)
        throw new Error('Select a trusted snapshot under runtime-data.');
      const root = await realpath('runtime-data');
      const file = await realpath(selected);
      if (
        !file.startsWith(root + path.sep) ||
        (await lstat(file)).size > 5_242_880
      )
        throw new Error('Unsupported snapshot path or size.');
      const data = z
        .object({
          backup: z.unknown(),
          checksum: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(JSON.parse(await readFile(file, 'utf8')) as unknown);
      await database.lifecycle.restoreScope(
        principal,
        JSON.stringify(data.backup),
        data.checksum,
      );
      console.info(
        'Scoped logical restore completed. Jobs are fenced and approvals require fresh decisions.',
      );
    } else if (command === 'delete') {
      const confirmation = process.argv[3];
      if (!confirmation)
        throw new Error(
          'Deletion requires an exact organisation:repository confirmation.',
        );
      await database.lifecycle.deleteScope(principal, store, confirmation);
      console.info(
        'Live scope and local artifact objects deleted. Backup retention and minimal deletion receipts remain separate.',
      );
    } else if (command === 'prune') {
      const records = await database.retention.sweep(principal);
      const artifacts = await database.artifacts.expire(principal, store);
      console.info(
        `Scoped expiry completed: ${String(records)} webhook metadata records and ${String(artifacts)} artifact objects.`,
      );
    } else throw new Error('Use export, restore, delete or prune.');
  } finally {
    await database.close();
  }
} catch {
  console.error(
    'Scoped data command failed. Check command, capabilities, exact scope, holds and snapshot compatibility. No credentials or source content were logged.',
  );
  process.exitCode = 1;
}
