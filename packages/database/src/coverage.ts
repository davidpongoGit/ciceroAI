import type pg from 'pg';
import {
  AssertionMappingSchema,
  RunEvidenceSchema,
  ScopeSchema,
  TestAssetSchema,
  type AssertionMapping,
  type Scope,
  type TestAsset,
  type RunEvidence,
} from '@cai/contracts';
import { assessCoverage, assertionHash, criterionHash } from '@cai/coverage';
import type { PostgresKnowledgeStore } from './knowledge.js';

export class PostgresCoverageStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly knowledge: PostgresKnowledgeStore,
  ) {}
  async storeInventory(scope: Scope, inputs: TestAsset[]): Promise<void> {
    ScopeSchema.parse(scope);
    if (inputs.length > 5000)
      throw new Error('Test inventory budget exceeded.');
    const tests = inputs.map((item) => TestAssetSchema.parse(item));
    if (
      tests.some(
        (item) =>
          item.scope.organisationId !== scope.organisationId ||
          item.scope.repositoryId !== scope.repositoryId,
      )
    )
      throw new Error('Test scope mismatch.');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const active = await client.query(
        "select id from scope_controls where organisation_id=$1 and repository_id=$2 and phase='active' for share",
        [scope.organisationId, scope.repositoryId],
      );
      if (active.rowCount !== 1)
        throw new Error('Installation scope is disabled.');
      for (const asset of tests)
        await client.query(
          'insert into test_assets (organisation_id,repository_id,asset_key,revision_sha,file_hash,asset) values ($1,$2,$3,$4,$5,$6) on conflict do nothing',
          [
            scope.organisationId,
            scope.repositoryId,
            asset.id,
            asset.testRevisionSha,
            asset.fileHash,
            asset,
          ],
        );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  async tests(scope: Scope, revisionSha: string): Promise<TestAsset[]> {
    ScopeSchema.parse(scope);
    const rows = await this.pool.query<{ asset: unknown }>(
      'select asset from test_assets where organisation_id=$1 and repository_id=$2 and revision_sha=$3 order by asset_key limit 5000',
      [scope.organisationId, scope.repositoryId, revisionSha],
    );
    return rows.rows.map((row) => TestAssetSchema.parse(row.asset));
  }
  async reviewMapping(
    scope: Scope,
    assessmentId: string,
    input: AssertionMapping,
    revisionSha: string,
    actor: 'human-review' | 'synthetic-fixture',
  ): Promise<void> {
    const mapping = AssertionMappingSchema.parse(input);
    const report = await this.knowledge.getReport(scope, assessmentId);
    const requirement = report?.report.requirements.find(
      (item) => item.id === mapping.criterionId,
    );
    if (
      !report ||
      report.stale ||
      !requirement ||
      requirement.status !== 'explicit' ||
      mapping.criterionHash !== criterionHash(requirement) ||
      actor !== mapping.reviewedBy
    )
      throw new Error(
        'Current explicit criterion and reviewer identity required.',
      );
    const asset = (await this.tests(scope, revisionSha)).find(
      (test) => test.id === mapping.testId,
    );
    if (
      !asset ||
      asset.skipped ||
      !asset.assertions.some(
        (assertion) =>
          assertion.supported &&
          assertionHash(assertion) === mapping.assertionHash,
      )
    )
      throw new Error('Supported meaningful assertion required.');
    await this.pool.query(
      'insert into assertion_mappings (organisation_id,repository_id,assessment_id,criterion_id,mapping) values ($1,$2,$3,$4,$5)',
      [
        scope.organisationId,
        scope.repositoryId,
        assessmentId,
        mapping.criterionId,
        mapping,
      ],
    );
  }
  async recordEvidence(
    scope: Scope,
    assessmentId: string,
    input: RunEvidence,
  ): Promise<void> {
    ScopeSchema.parse(scope);
    const evidence = RunEvidenceSchema.parse(input);
    if (
      evidence.scope.organisationId !== scope.organisationId ||
      evidence.scope.repositoryId !== scope.repositoryId ||
      !(await this.knowledge.getReport(scope, assessmentId))
    )
      throw new Error('Evidence scope mismatch or source access revoked.');
    await this.pool.query(
      'insert into run_evidence (id,organisation_id,repository_id,assessment_id,evidence) values ($1,$2,$3,$4,$5)',
      [
        evidence.id,
        scope.organisationId,
        scope.repositoryId,
        assessmentId,
        evidence,
      ],
    );
  }
  async decisions(
    scope: Scope,
    assessmentId: string,
    target: {
      appSha: string;
      environment: string;
      testRevisionSha: string;
      allowTrustedSynthetic: boolean;
    },
  ) {
    const report = await this.knowledge.getReport(scope, assessmentId);
    if (!report) return null;
    const tests = await this.tests(scope, target.testRevisionSha);
    const mappings = (
      await this.pool.query<{ mapping: unknown }>(
        'select mapping from assertion_mappings where organisation_id=$1 and repository_id=$2 and assessment_id=$3 order by created_at desc,id desc limit 5000',
        [scope.organisationId, scope.repositoryId, assessmentId],
      )
    ).rows.map((row) => AssertionMappingSchema.parse(row.mapping));
    const evidence = (
      await this.pool.query<{ evidence: unknown }>(
        'select evidence from run_evidence where organisation_id=$1 and repository_id=$2 and assessment_id=$3 order by created_at desc,id desc limit 5000',
        [scope.organisationId, scope.repositoryId, assessmentId],
      )
    ).rows.map((row) => RunEvidenceSchema.parse(row.evidence));
    return report.report.requirements.map((criterion) => {
      const mapping =
        mappings.find((item) => item.criterionId === criterion.id) ?? null;
      const run =
        evidence.find(
          (item) =>
            item.testId === mapping?.testId &&
            item.criterionHash === mapping.criterionHash,
        ) ?? null;
      return {
        criterionId: criterion.id,
        ...(report.stale
          ? {
              state: 'stale' as const,
              action: 'update' as const,
              reason: 'Source versions changed; reassessment is required.',
              testId: mapping?.testId ?? null,
            }
          : assessCoverage(criterion, tests, mapping, run, {
              scope,
              ...target,
            })),
      };
    });
  }

  async recordedRuns(
    scope: Scope,
    assessmentId: string,
  ): Promise<RunEvidence[]> {
    ScopeSchema.parse(scope);
    if (!(await this.knowledge.getReport(scope, assessmentId))) return [];
    const rows = await this.pool.query<{ evidence: unknown }>(
      'select evidence from run_evidence where organisation_id=$1 and repository_id=$2 and assessment_id=$3 order by created_at desc,id desc limit 20',
      [scope.organisationId, scope.repositoryId, assessmentId],
    );
    return rows.rows.map((row) => RunEvidenceSchema.parse(row.evidence));
  }
}
