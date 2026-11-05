import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import {
  LocalArtifactStore,
  draftExpiredCardTest,
  draftRevision,
} from '@cai/executor';
import {
  GitHubDraftPublisher,
  SyntheticAutomationRepository,
} from '@cai/integrations';
import { planHash } from '@cai/policy';
import type { TestPlan } from '@cai/contracts';
import { publishApprovedTest } from '../../apps/worker/src/publication.js';
import { seedReadyAssessment } from './fixtures.js';

describe('Approved two-repository publication with real PostgreSQL and synthetic VCS', () => {
  const url = readDatabaseUrl(process.env.DATABASE_URL);
  const database = createDatabase(url);
  const audit = new pg.Pool({ connectionString: url, max: 1 });
  beforeAll(async () => database.migrate());
  afterAll(async () => {
    await database.close();
    await audit.end();
  });
  async function fixture() {
    const seeded = await seedReadyAssessment(database);
    const criterion = seeded.report.requirements[0];
    if (!criterion) throw new Error('Expected criterion.');
    const draftPlan: TestPlan = {
      id: randomUUID(),
      scope: seeded.scope,
      assessmentId: seeded.assessmentId,
      featureId: seeded.featureId,
      operation: 'draft',
      strategy: 'create',
      level: 'e2e',
      appSha: seeded.pr.headSha,
      testRevisionSha: seeded.pr.headSha,
      environment: 'synthetic-checkout',
      criterionIds: [criterion.id],
      draftHash: null,
      budget: { maxRunnerSeconds: 30, maxArtifactBytes: 1_048_576 },
      policyVersion: 'supervised-v1',
    };
    const draft = draftExpiredCardTest(draftPlan, criterion);
    const target = {
      provider: 'github' as const,
      repositoryId: '202',
      repository: 'synthetic/playwright',
      baseBranch: 'main',
      baseSha: 'd'.repeat(40),
      path: draft.path,
    };
    const plan: TestPlan = {
      ...draftPlan,
      id: randomUUID(),
      operation: 'create_pr',
      draftHash: draft.hash,
      testRevisionSha: draftRevision(draft),
      publication: target,
    };
    await database.plans.create(seeded.principal, plan);
    const store = new LocalArtifactStore(
      `runtime-data/publication-${randomUUID()}`,
    );
    const artifact = await store.put(seeded.scope, Buffer.from(draft.content), {
      mediaType: 'text/typescript',
      sensitivity: 'synthetic',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await database.artifacts.register(
      seeded.principal,
      seeded.assessmentId,
      artifact,
    );
    const remote = new SyntheticAutomationRepository(target);
    const config = {
      scope: seeded.scope,
      applicationRepository: 'synthetic/application',
      automationRepository: target,
      installationToken: 'synthetic-automation-only-token',
      approvedExternalWrites: true as const,
    };
    return {
      ...seeded,
      plan,
      store,
      artifact,
      remote,
      config,
      input: {
        database,
        principal: seeded.principal,
        planId: plan.id,
        draftArtifactId: artifact.id,
        store,
        publisher: new GitHubDraftPublisher(config, remote.transport),
        mode: 'synthetic' as const,
      },
    };
  }
  it('requires persisted approval, records scoped receipts/audit and reconciles without duplicate writes', async () => {
    const f = await fixture();
    await expect(publishApprovedTest(f.input)).rejects.toThrow('denied');
    expect(f.remote.requests).toHaveLength(0);
    await database.plans.decide(f.principal, f.plan.id, 'approved');
    const result = await publishApprovedTest(f.input);
    expect(result.receipt.externalPullRequest).toBe(false);
    expect(result.receipt.status).toBe('simulated_awaiting_review');
    expect(result.receipt.automationTarget?.repositoryId).toBe('202');
    expect(result.receipt.scope.repositoryId).toBe('101');
    expect(result.receipt.executionEvidence).toEqual([]);
    expect(JSON.stringify(f.remote.writes.at(-1)?.body)).toContain(
      'Execution evidence unavailable.',
    );
    expect(
      Buffer.from(await f.store.get(f.scope, result.reference)).toString(),
    ).toContain(planHash(f.plan));
    expect(
      await database.artifacts.reference(f.principal, result.reference.id),
    ).toEqual(result.reference);
    expect((await publishApprovedTest(f.input)).receipt.result.reused).toBe(
      true,
    );
    expect(f.remote.writes).toHaveLength(3);
    const events = await audit.query<{ action: string }>(
      'select action from governance_events where organisation_id=$1 and repository_id=$2 and (target_id=$3 or target_id=$4)',
      [
        f.scope.organisationId,
        f.scope.repositoryId,
        f.plan.id,
        result.reference.id,
      ],
    );
    expect(events.rows.map((row) => row.action)).toContain(
      'publication_started',
    );
    expect(events.rows.map((row) => row.action)).toContain(
      'publication_recorded',
    );
    await expect(
      publishApprovedTest({
        ...f.input,
        principal: {
          ...f.principal,
          scope: { ...f.scope, organisationId: randomUUID() },
        },
      }),
    ).rejects.toThrow('denied');
    await database.plans.decide(f.principal, f.plan.id, 'revoked');
    await expect(publishApprovedTest(f.input)).rejects.toThrow('denied');
    expect(f.remote.writes).toHaveLength(3);
  });
  it('binds destination/base/path into immutable approval and refuses configuration changes or legacy targets', async () => {
    const f = await fixture();
    await database.plans.decide(f.principal, f.plan.id, 'approved');
    const replacement = {
      ...f.plan,
      id: randomUUID(),
      publication: {
        ...f.config.automationRepository,
        baseSha: 'e'.repeat(40),
      },
    };
    expect(planHash(replacement)).not.toBe(planHash(f.plan));
    expect(
      planHash({
        ...f.plan,
        publication: {
          ...f.config.automationRepository,
          path: 'tests/another.spec.ts',
        },
      }),
    ).not.toBe(planHash(f.plan));
    await database.plans.create(f.principal, replacement);
    await expect(
      publishApprovedTest({ ...f.input, planId: replacement.id }),
    ).rejects.toThrow('denied');
    const wrongTarget = {
      ...f.config.automationRepository,
      repositoryId: '303',
      repository: 'synthetic/other-tests',
    };
    const other = new SyntheticAutomationRepository(wrongTarget);
    await expect(
      publishApprovedTest({
        ...f.input,
        publisher: new GitHubDraftPublisher(
          { ...f.config, automationRepository: wrongTarget },
          other.transport,
        ),
      }),
    ).rejects.toThrow('denied');
    expect(other.requests).toHaveLength(0);
    await expect(
      database.plans.create(f.principal, {
        ...f.plan,
        id: randomUUID(),
        publication: undefined,
      }),
    ).rejects.toThrow('denied');
    await database.graph.revokeSource(f.scope, 'jira:DEMO-1');
    await expect(publishApprovedTest(f.input)).rejects.toThrow('denied');
    expect(f.remote.requests).toHaveLength(0);
  });
  it('audits a receipt-storage failure and reconciles the remote outcome on retry', async () => {
    const f = await fixture();
    await database.plans.decide(f.principal, f.plan.id, 'approved');
    await expect(
      publishApprovedTest({
        ...f.input,
        store: {
          get: (scope, ref) => f.store.get(scope, ref),
          delete: (scope, ref) => f.store.delete(scope, ref),
          put: () =>
            Promise.reject(new Error('Synthetic receipt storage outage.')),
        },
      }),
    ).rejects.toThrow('storage outage');
    expect(f.remote.pr).not.toBeNull();
    const failures = await audit.query(
      'select id from governance_events where organisation_id=$1 and repository_id=$2 and target_id=$3 and action=$4',
      [
        f.scope.organisationId,
        f.scope.repositoryId,
        f.plan.id,
        'publication_failed',
      ],
    );
    expect(failures.rowCount).toBe(1);
    expect((await publishApprovedTest(f.input)).receipt.result.reused).toBe(
      true,
    );
    expect(f.remote.writes).toHaveLength(3);
  });
});
