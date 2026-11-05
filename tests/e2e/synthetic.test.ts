import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import { type TestPlan } from '@cai/contracts';
import { assertionHash, criterionHash, inventoryFile } from '@cai/coverage';
import {
  draftExpiredCardTest,
  draftRevision,
  executeTrustedSynthetic,
  syntheticBuildSha,
  LocalArtifactStore,
  draftPatch,
} from '@cai/executor';
import { seedReadyAssessment } from '../integration/fixtures.js';

describe('M7 real Playwright execution of repository-owned synthetic fixtures', () => {
  const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
  beforeAll(async () => {
    await database.migrate();
  });
  afterAll(async () => {
    await database.close();
  });
  it('passes on the fixed build, fails the unchanged assertion on the broken build, and stores exact evidence', async () => {
    const hashes: string[] = [];
    for (const broken of [false, true]) {
      const fixture = await seedReadyAssessment(
        database,
        await syntheticBuildSha(broken),
      );
      const criterion = fixture.report.requirements[0];
      if (!criterion) throw new Error('Expected fixture criterion.');
      const draftPlan: TestPlan = {
        id: randomUUID(),
        scope: fixture.scope,
        assessmentId: fixture.assessmentId,
        featureId: fixture.featureId,
        operation: 'draft',
        strategy: 'create',
        level: 'e2e',
        appSha: fixture.pr.headSha,
        testRevisionSha: fixture.pr.headSha,
        environment: 'synthetic-checkout',
        criterionIds: [criterion.id],
        draftHash: null,
        budget: { maxRunnerSeconds: 30, maxArtifactBytes: 1_048_576 },
        policyVersion: 'supervised-v1',
      };
      const draft = draftExpiredCardTest(draftPlan, criterion);
      hashes.push(draft.hash);
      const plan: TestPlan = {
        ...draftPlan,
        id: randomUUID(),
        operation: 'execute',
        draftHash: draft.hash,
        testRevisionSha: draftRevision(draft),
      };
      await database.plans.create(fixture.principal, plan);
      await database.plans.decide(fixture.principal, plan.id, 'approved');
      const assets = inventoryFile(
        fixture.scope,
        draft.path,
        draft.content,
        plan.testRevisionSha,
      );
      const asset = assets[0];
      const assertion = asset?.assertions[0];
      if (!asset || !assertion) throw new Error('Expected drafted assertion.');
      await database.coverage.storeInventory(fixture.scope, assets);
      await database.coverage.reviewMapping(
        fixture.scope,
        fixture.assessmentId,
        {
          criterionId: criterion.id,
          criterionHash: criterionHash(criterion),
          testId: asset.id,
          assertionHash: assertionHash(assertion),
          reviewedBy: 'synthetic-fixture',
        },
        plan.testRevisionSha,
        'synthetic-fixture',
      );
      const refs = {
        appSha: plan.appSha,
        testRevisionSha: plan.testRevisionSha,
        draftHash: plan.draftHash,
      };
      const reservation = await database.actions.reserve(
        fixture.principal,
        plan,
      );
      const started = performance.now();
      const result = await executeTrustedSynthetic({
        plan,
        draft,
        criterion,
        broken,
        authorize: () =>
          database.plans.authorize(fixture.principal, plan.id, refs),
      });
      expect(
        await database.actions.settle(
          fixture.principal,
          reservation,
          Math.ceil(performance.now() - started),
          result.evidence.outcome === 'passed' ? 'completed' : 'failed',
        ),
      ).toBe(true);
      const store = new LocalArtifactStore('runtime-data/artifacts');
      const reportRef = await store.put(
        fixture.scope,
        Buffer.from(JSON.stringify(result.report)),
        {
          mediaType: 'application/json',
          sensitivity: 'synthetic',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      );
      await database.artifacts.register(
        fixture.principal,
        fixture.assessmentId,
        reportRef,
      );
      expect(
        await database.artifacts.reference(fixture.principal, reportRef.id),
      ).toEqual(reportRef);
      const patchRef = await store.put(
        fixture.scope,
        Buffer.from(draftPatch(draft)),
        {
          mediaType: 'text/x-diff',
          sensitivity: 'synthetic',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      );
      await database.artifacts.register(
        fixture.principal,
        fixture.assessmentId,
        patchRef,
      );
      expect(result.evidence.outcome).toBe(broken ? 'failed' : 'passed');
      expect(result.evidence.assertionHashes).toContain(
        assertionHash(assertion),
      );
      await database.coverage.recordEvidence(
        fixture.scope,
        fixture.assessmentId,
        result.evidence,
      );
      const target = {
        appSha: plan.appSha,
        environment: plan.environment,
        testRevisionSha: plan.testRevisionSha,
        allowTrustedSynthetic: true,
      };
      expect(
        (
          await database.coverage.decisions(
            fixture.scope,
            fixture.assessmentId,
            target,
          )
        )?.[0]?.state,
      ).toBe(broken ? 'failed' : 'verified');
      expect(
        (
          await database.coverage.decisions(
            fixture.scope,
            fixture.assessmentId,
            { ...target, allowTrustedSynthetic: false },
          )
        )?.[0]?.state,
      ).toBe('unknown');
    }
    expect(hashes[0]).toBe(hashes[1]);
  });
});
