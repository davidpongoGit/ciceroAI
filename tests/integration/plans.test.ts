import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import { type TestPlan } from '@cai/contracts';
import { buildApp } from '../../apps/api/src/app.js';
import { seedReadyAssessment } from './fixtures.js';

describe('M6 persisted exact-plan approvals and server-side permissions', () => {
  const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
  beforeAll(async () => {
    await database.migrate();
  });
  afterAll(async () => {
    await database.close();
  });
  it('denies unapproved/revoked, wrong-scope and changed-head actions, and permits only approved exact refs', async () => {
    const fixture = await seedReadyAssessment(database);
    const plan: TestPlan = {
      id: randomUUID(),
      scope: fixture.scope,
      assessmentId: fixture.assessmentId,
      featureId: fixture.featureId,
      operation: 'draft',
      strategy: 'create',
      level: 'e2e',
      appSha: fixture.pr.headSha,
      testRevisionSha: fixture.pr.headSha,
      environment: 'synthetic-staging',
      criterionIds: [fixture.report.requirements[0]?.id ?? ''],
      draftHash: null,
      budget: { maxRunnerSeconds: 30, maxArtifactBytes: 1_048_576 },
      policyVersion: 'supervised-v1',
    };
    await database.plans.create(fixture.principal, plan);
    const refs = {
      appSha: plan.appSha,
      testRevisionSha: plan.testRevisionSha,
      draftHash: plan.draftHash,
    };
    await expect(
      database.plans.authorize(fixture.principal, plan.id, refs),
    ).rejects.toThrow('denied');
    await database.plans.decide(fixture.principal, plan.id, 'approved');
    expect(
      await database.plans.authorize(fixture.principal, plan.id, refs),
    ).toEqual(plan);
    await expect(
      database.plans.authorize(fixture.principal, plan.id, {
        ...refs,
        appSha: 'd'.repeat(40),
      }),
    ).rejects.toThrow('denied');
    await expect(
      database.plans.decide(
        {
          ...fixture.principal,
          scope: { ...fixture.scope, organisationId: randomUUID() },
        },
        plan.id,
        'approved',
      ),
    ).rejects.toThrow('denied');
    await database.plans.decide(fixture.principal, plan.id, 'revoked');
    await expect(
      database.plans.authorize(fixture.principal, plan.id, refs),
    ).rejects.toThrow('denied');
    await database.plans.decide(fixture.principal, plan.id, 'approved');
    await database.graph.configureFeature(
      fixture.scope,
      'checkout',
      'e'.repeat(40),
      true,
    );
    await expect(
      database.plans.authorize(fixture.principal, plan.id, refs),
    ).rejects.toThrow('denied');
  });
  it('expires approvals and denies missing capabilities and missing draft hashes', async () => {
    const fixture = await seedReadyAssessment(database);
    const plan: TestPlan = {
      id: randomUUID(),
      scope: fixture.scope,
      assessmentId: fixture.assessmentId,
      featureId: fixture.featureId,
      operation: 'draft',
      strategy: 'create',
      level: 'e2e',
      appSha: fixture.pr.headSha,
      testRevisionSha: fixture.pr.headSha,
      environment: 'synthetic-staging',
      criterionIds: [fixture.report.requirements[0]?.id ?? ''],
      draftHash: null,
      budget: { maxRunnerSeconds: 30, maxArtifactBytes: 1000 },
      policyVersion: 'supervised-v1',
    };
    await database.plans.create(fixture.principal, plan);
    await expect(
      database.plans.decide(
        { ...fixture.principal, capabilities: ['assessment.read'] },
        plan.id,
        'approved',
      ),
    ).rejects.toThrow('denied');
    await database.plans.decide(
      fixture.principal,
      plan.id,
      'approved',
      new Date(Date.now() + 200).toISOString(),
    );
    await setTimeout(250);
    await expect(
      database.plans.authorize(fixture.principal, plan.id, {
        appSha: plan.appSha,
        testRevisionSha: plan.testRevisionSha,
        draftHash: null,
      }),
    ).rejects.toThrow('denied');
    const executable = {
      ...plan,
      id: randomUUID(),
      operation: 'execute' as const,
    };
    await database.plans.create(fixture.principal, executable);
    await expect(
      database.plans.decide(fixture.principal, executable.id, 'approved'),
    ).rejects.toThrow('denied');
  });
  it('serves a CSP-protected shell and rejects unauthenticated or read-only approval requests', async () => {
    const fixture = await seedReadyAssessment(database);
    const token = 'synthetic-api-token-at-least-32-characters';
    const app = buildApp({
      workflow: {
        scope: fixture.scope,
        installationId: '99',
        webhookSecret: 'synthetic-separate-webhook-secret-32-chars',
        apiToken: token,
        store: database.workflows,
      },
      admin: {
        database,
        principal: { ...fixture.principal, capabilities: ['assessment.read'] },
        apiToken: token,
      },
    });
    try {
      const shell = await app.inject({ url: '/' });
      expect(shell.statusCode).toBe(200);
      expect(shell.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      expect(shell.body).not.toContain(token);
      expect((await app.inject({ url: '/api/overview' })).statusCode).toBe(401);
      const overview = await app.inject({
        url: '/api/overview',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(overview.statusCode).toBe(200);
      expect(overview.json<{ scope: unknown }>().scope).toEqual(fixture.scope);
      expect(
        Number(
          overview.json<{
            footprint: { knowledgePayloadEstimateBytes: string };
          }>().footprint.knowledgePayloadEstimateBytes,
        ),
      ).toBeGreaterThan(0);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/plans/${randomUUID()}/decision`,
            headers: { authorization: `Bearer ${token}` },
            payload: { decision: 'approved' },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });
});
