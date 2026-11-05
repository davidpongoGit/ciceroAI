import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import type { TestPlan } from '@cai/contracts';
import { LocalArtifactStore } from '@cai/executor';
import { seedReadyAssessment } from './fixtures.js';
function validateRestoreCleanup(name: string, target: URL, source: URL): void {
  if (
    target.pathname !== `/${name}` ||
    !/^cai_restore_[a-f0-9]{12}$/.test(name) ||
    target.pathname === source.pathname
  )
    throw new Error('Restore cleanup target failed validation.');
}

describe('M8 real PostgreSQL recovery, lifecycle and scoped restore', () => {
  it('expires configurable webhook metadata while retaining durable delivery hashes and replay safety', async () => {
    const fixture = await seedReadyAssessment(database);
    await database.retention.configure(fixture.principal, {
      rawEventDays: 1,
      artifactMaxDays: 7,
    });
    await direct.query(
      "update inbound_events set created_at=clock_timestamp()-interval '2 days' where organisation_id=$1",
      [fixture.scope.organisationId],
    );
    expect(await database.retention.sweep(fixture.principal)).toBe(1);
    const row = (
      await direct.query<{ metadata: unknown; source_hash: string }>(
        'select metadata,source_hash from inbound_events where organisation_id=$1',
        [fixture.scope.organisationId],
      )
    ).rows[0];
    expect(row?.metadata).toEqual({});
    expect(row?.source_hash).toBe('c'.repeat(64));
    expect(await database.retention.sweep(fixture.principal)).toBe(0);
  });
  const connectionString = readDatabaseUrl(process.env.DATABASE_URL);
  const database = createDatabase(connectionString);
  const direct = new pg.Pool({ connectionString, max: 1 });
  beforeAll(async () => {
    await database.migrate();
  });
  afterAll(async () => {
    await database.close();
    await direct.end();
  });
  async function readyPlan() {
    const fixture = await seedReadyAssessment(database);
    const plan: TestPlan = {
      id: randomUUID(),
      scope: fixture.scope,
      assessmentId: fixture.assessmentId,
      featureId: fixture.featureId,
      operation: 'execute',
      strategy: 'create',
      level: 'e2e',
      appSha: fixture.pr.headSha,
      testRevisionSha: fixture.pr.headSha,
      environment: 'synthetic-staging',
      criterionIds: [fixture.report.requirements[0]?.id ?? ''],
      draftHash: 'd'.repeat(64),
      budget: { maxRunnerSeconds: 2, maxArtifactBytes: 1000 },
      policyVersion: 'supervised-v1',
    };
    await database.plans.create(fixture.principal, plan);
    await database.plans.decide(fixture.principal, plan.id, 'approved');
    return { ...fixture, plan };
  }
  it('atomically reserves budget, denies duplicates/overruns, measures spend and fences abandoned actions', async () => {
    const fixture = await readyPlan();
    await database.actions.configureBudget(fixture.principal, 1000);
    await expect(
      database.actions.reserve(fixture.principal, fixture.plan),
    ).rejects.toThrow('denied');
    await database.actions.configureBudget(fixture.principal, 5000);
    const reservation = await database.actions.reserve(
      fixture.principal,
      fixture.plan,
    );
    await expect(
      database.actions.reserve(fixture.principal, fixture.plan),
    ).rejects.toThrow('denied');
    expect(
      await database.actions.settle(
        fixture.principal,
        reservation,
        1200,
        'completed',
      ),
    ).toBe(true);
    expect((await database.actions.usage(fixture.principal))[0]).toMatchObject({
      used_runner_ms: 1200,
      reserved_runner_ms: 0,
    });
    const next = { ...fixture.plan, id: randomUUID() };
    await database.plans.create(fixture.principal, next);
    await database.plans.decide(fixture.principal, next.id, 'approved');
    const abandoned = await database.actions.reserve(fixture.principal, next);
    await direct.query(
      "update action_runs set lease_until=clock_timestamp()-interval '1 second' where id=$1 and organisation_id=$2",
      [abandoned.id, fixture.scope.organisationId],
    );
    expect(await database.actions.recover(fixture.principal)).toBe(1);
    expect(
      await database.actions.settle(
        fixture.principal,
        abandoned,
        10,
        'completed',
      ),
    ).toBe(false);
    expect((await database.actions.usage(fixture.principal))[0]).toMatchObject({
      used_runner_ms: 3200,
      reserved_runner_ms: 0,
    });
  });
  it('targets changed features and deduplicates notifications without model execution', async () => {
    const fixture = await seedReadyAssessment(database);
    const unrelated = await database.graph.configureFeature(
      fixture.scope,
      'unrelated',
      fixture.pr.headSha,
      false,
    );
    expect(await database.monitor.reconcile(fixture.principal)).toBe(4);
    expect(await database.monitor.reconcile(fixture.principal)).toBe(0);
    const notifications = await database.monitor.notifications(
      fixture.principal,
    );
    expect(notifications).toHaveLength(4);
    expect(
      notifications.every(
        (item) =>
          item.target_id === fixture.featureId && item.target_id !== unrelated,
      ),
    ).toBe(true);
    await database.monitor.acknowledge(
      fixture.principal,
      notifications[0]?.id ?? '',
    );
    expect(
      (await database.monitor.notifications(fixture.principal)).filter(
        (item) => item.acknowledged_at,
      ),
    ).toHaveLength(1);
  });
  it('retains held artifacts, retries failed expiry and blocks held-scope deletion', async () => {
    const fixture = await seedReadyAssessment(database);
    const store = new LocalArtifactStore(
      `runtime-data/lifecycle-${randomUUID()}`,
    );
    const ref = await store.put(
      fixture.scope,
      Buffer.from('synthetic evidence'),
      {
        mediaType: 'text/plain',
        sensitivity: 'synthetic',
        expiresAt: new Date(Date.now() + 200).toISOString(),
      },
    );
    await database.artifacts.register(
      fixture.principal,
      fixture.assessmentId,
      ref,
    );
    await database.artifacts.setHold(fixture.principal, ref.id, true);
    await setTimeout(250);
    expect(await database.artifacts.expire(fixture.principal, store)).toBe(0);
    expect(
      await database.artifacts.reference(fixture.principal, ref.id),
    ).toEqual(ref);
    await expect(
      database.lifecycle.deleteScope(
        fixture.principal,
        store,
        `${fixture.scope.organisationId}:${fixture.scope.repositoryId}`,
      ),
    ).rejects.toThrow('Legal hold');
    await database.artifacts.setHold(fixture.principal, ref.id, false);
    const failing = {
      put: store.put.bind(store),
      get: store.get.bind(store),
      delete: () => Promise.reject(new Error('Synthetic storage outage')),
    };
    await expect(
      database.artifacts.expire(fixture.principal, failing),
    ).rejects.toThrow('will be retried');
    expect(
      await database.artifacts.reference(fixture.principal, ref.id),
    ).toBeNull();
    expect(await database.artifacts.expire(fixture.principal, store)).toBe(1);
    await expect(store.get(fixture.scope, ref)).rejects.toThrow();
  });
  it('exports only authorised scope, restores into a fresh real database with objects, and purges live derivations', async () => {
    const fixture = await readyPlan();
    const unrelated = await seedReadyAssessment(database);
    const sourceStore = new LocalArtifactStore(
      `runtime-data/backup-source-${randomUUID()}`,
    );
    const ref = await sourceStore.put(
      fixture.scope,
      Buffer.from('synthetic restoration evidence'),
      {
        mediaType: 'text/plain',
        sensitivity: 'synthetic',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    );
    await database.artifacts.register(
      fixture.principal,
      fixture.assessmentId,
      ref,
    );
    const exported = await database.lifecycle.exportScope(fixture.principal);
    const raw = JSON.stringify(exported.backup);
    expect(raw).not.toContain(unrelated.scope.organisationId);
    const sourceUrl = new URL(connectionString);
    if (
      !['127.0.0.1', 'localhost'].includes(sourceUrl.hostname) ||
      !['/postgres', '/cai_ci'].includes(sourceUrl.pathname)
    )
      throw new Error(
        'Restore test requires the dedicated local/CI test database.',
      );
    const name = `cai_restore_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    if (!/^cai_restore_[a-f0-9]{12}$/.test(name))
      throw new Error('Unexpected restore target.');
    await direct.query(`create database "${name}"`);
    const targetUrl = new URL(connectionString);
    targetUrl.pathname = '/' + name;
    const restored = createDatabase(targetUrl.toString());
    try {
      await restored.migrate();
      await expect(
        restored.lifecycle.restoreScope(
          { ...fixture.principal, scope: unrelated.scope },
          raw,
          exported.checksum,
        ),
      ).rejects.toThrow('denied');
      const destinationStore = new LocalArtifactStore(
        `runtime-data/backup-target-${randomUUID()}`,
      );
      await destinationStore.restoreObject(
        fixture.scope,
        ref,
        await sourceStore.get(fixture.scope, ref),
      );
      await restored.lifecycle.restoreScope(
        fixture.principal,
        raw,
        exported.checksum,
      );
      expect(
        (
          await restored.knowledge.getReport(
            fixture.scope,
            fixture.assessmentId,
          )
        )?.report,
      ).toEqual(fixture.report);
      expect(
        (await restored.graph.readiness(fixture.scope, fixture.featureId))
          ?.eligibleForPlan,
      ).toBe(true);
      expect(
        (await restored.plans.get(fixture.principal, fixture.plan.id))?.approval
          .status,
      ).toBe('revoked');
      expect(
        await restored.artifacts.reference(fixture.principal, ref.id),
      ).toEqual(ref);
      expect(
        Buffer.from(await destinationStore.get(fixture.scope, ref)).toString(),
      ).toBe('synthetic restoration evidence');
      await expect(
        restored.lifecycle.restoreScope(
          fixture.principal,
          raw,
          exported.checksum,
        ),
      ).rejects.toThrow('empty destination');
    } finally {
      await restored.close();
      validateRestoreCleanup(name, targetUrl, sourceUrl);
      await direct.query(`drop database "${name}"`);
    }
    await database.lifecycle.deleteScope(
      fixture.principal,
      sourceStore,
      `${fixture.scope.organisationId}:${fixture.scope.repositoryId}`,
    );
    expect(
      await database.knowledge.getReport(fixture.scope, fixture.assessmentId),
    ).toBeNull();
    await expect(
      database.coverage.storeInventory(fixture.scope, []),
    ).rejects.toThrow('scope is disabled');
    await expect(sourceStore.get(fixture.scope, ref)).rejects.toThrow();
    expect(
      await database.knowledge.getReport(
        unrelated.scope,
        unrelated.assessmentId,
      ),
    ).not.toBeNull();
  });
});
