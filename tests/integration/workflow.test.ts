import { createHash, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockModelProvider, type IntakeEvent } from '@cai/contracts';
import {
  createDatabase,
  DeliveryConflict,
  readDatabaseUrl,
} from '@cai/database';
import { processOne } from '../../apps/worker/src/worker.js';

const scope = { organisationId: randomUUID(), repositoryId: '101' };
function input(overrides: Partial<IntakeEvent> = {}): IntakeEvent {
  return {
    scope,
    installationId: '99',
    deliveryId: randomUUID(),
    sourceHash: createHash('sha256').update('synthetic').digest('hex'),
    event: {
      action: 'opened',
      installation: { id: 99 },
      repository: { id: 101, full_name: 'synthetic/demo' },
      pull_request: {
        number: 1,
        head: { sha: 'a'.repeat(40) },
        base: { sha: 'b'.repeat(40) },
        merged: false,
      },
    },
    ...overrides,
  };
}
describe('M1 real PostgreSQL durable workflow', () => {
  const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
  beforeAll(async () => {
    await database.migrate();
  });
  afterAll(async () => {
    await database.close();
  });

  it('deduplicates concurrent deliveries and logical actions with one completed result', async () => {
    const delivery = input();
    const results = await Promise.all([
      database.workflows.intake(delivery),
      database.workflows.intake(delivery),
      database.workflows.intake({ ...delivery, deliveryId: randomUUID() }),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(
      await database.workflows.intake({
        ...delivery,
        deliveryId: randomUUID(),
        sourceHash: 'd'.repeat(64),
        event: { ...delivery.event, action: 'synchronize' },
      }),
    ).toMatchObject({ id: results[0].id, duplicate: true });
    expect(
      await processOne(database.workflows, scope, new MockModelProvider()),
    ).toBe(true);
    expect(
      await processOne(database.workflows, scope, new MockModelProvider()),
    ).toBe(false);
    const row = await database.workflows.get(scope, results[0].id);
    expect(row?.status).toBe('completed');
    expect(row?.attempts).toBe(1);
    expect(row?.result?.state).toBe('unknown');
    await expect(
      database.workflows.intake({ ...delivery, sourceHash: 'c'.repeat(64) }),
    ).rejects.toBeInstanceOf(DeliveryConflict);
    expect(
      await database.workflows.get(
        { ...scope, organisationId: randomUUID() },
        results[0].id,
      ),
    ).toBeNull();
    expect(
      await database.workflows.get(
        { ...scope, repositoryId: '102' },
        results[0].id,
      ),
    ).toBeNull();
  });

  it('reopens after worker loss, reclaims expired leases and fences the old worker', async () => {
    const local = { ...scope, organisationId: randomUUID() };
    const queued = await database.workflows.intake(input({ scope: local }));
    const lost = await database.workflows.claim(local, 1);
    expect(lost).not.toBeNull();
    if (!lost) throw new Error('Expected lease.');
    await setTimeout(20);
    const restarted = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
    try {
      const replacement = await restarted.workflows.claim(local);
      expect(replacement?.assessment.attempts).toBe(2);
      if (!replacement) throw new Error('Expected recovery lease.');
      const output = await new MockModelProvider().analyse(
        replacement.assessment.task,
      );
      expect(await database.workflows.complete(local, lost, output)).toBe(
        false,
      );
      expect(
        await restarted.workflows.complete(local, replacement, output),
      ).toBe(true);
      expect((await restarted.workflows.get(local, queued.id))?.status).toBe(
        'completed',
      );
    } finally {
      await restarted.close();
    }
  });

  it('bounds retries, rejects mismatched output and reaches dead letter', async () => {
    const local = { ...scope, organisationId: randomUUID() };
    const queued = await database.workflows.intake(input({ scope: local }));
    for (let attempt = 1; attempt <= 3; attempt++) {
      const lease = await database.workflows.claim(local);
      if (!lease) throw new Error('Expected retry lease.');
      const output = await new MockModelProvider().analyse(
        lease.assessment.task,
      );
      await expect(
        database.workflows.complete(local, lease, {
          ...output,
          task: { ...output.task, organisationId: randomUUID() },
        }),
      ).rejects.toThrow('provenance mismatch');
      expect(
        await database.workflows.fail(local, lease, 'provider_failed', 0),
      ).toBe(true);
    }
    expect(await database.workflows.claim(local)).toBeNull();
    const row = await database.workflows.get(local, queued.id);
    expect(row?.status).toBe('dead_letter');
    expect(row?.attempts).toBe(3);
    expect(row?.lastError).toBe('provider_failed');
    const principal = {
      id: 'synthetic-replay-operator',
      scope: local,
      capabilities: ['data.manage' as const],
    };
    for (let replay = 0; replay < 3; replay++) {
      expect(await database.workflows.replay(principal, queued.id)).toBe(true);
      const lease = await database.workflows.claim(local);
      if (!lease) throw new Error('Expected manual replay lease.');
      expect(
        await database.workflows.fail(local, lease, 'retry_exceeds_policy', 0),
      ).toBe(true);
    }
    expect(await database.workflows.replay(principal, queued.id)).toBe(false);
  });

  it('allows only one concurrent worker to claim a job', async () => {
    const local = { ...scope, organisationId: randomUUID() };
    await database.workflows.intake(input({ scope: local }));
    const claims = await Promise.all([
      database.workflows.claim(local),
      database.workflows.claim(local),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});
