import type pg from 'pg';
import {
  TestPlanSchema,
  type Principal,
  type Scope,
  type TestPlan,
} from '@cai/contracts';
import {
  PolicyDenied,
  planHash,
  requireCapability,
  requireReadiness,
} from '@cai/policy';
import type { PostgresKnowledgeStore } from './knowledge.js';
import type { PostgresGraphStore } from './graph.js';

export class PostgresPlanStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly knowledge: PostgresKnowledgeStore,
    private readonly graph: PostgresGraphStore,
  ) {}
  async create(principal: Principal, input: TestPlan): Promise<string> {
    const plan = TestPlanSchema.parse(input);
    requireCapability(principal, plan.scope, 'plan.create');
    await this.currentSources(plan);
    const hash = planHash(plan);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        'insert into test_plans (id,organisation_id,repository_id,assessment_id,feature_id,plan_hash,plan) values ($1,$2,$3,$4,$5,$6,$7)',
        [
          plan.id,
          plan.scope.organisationId,
          plan.scope.repositoryId,
          plan.assessmentId,
          plan.featureId,
          hash,
          plan,
        ],
      );
      await client.query(
        "insert into governance_events (organisation_id,repository_id,actor,action,target_id) values ($1,$2,$3,'plan_created',$4)",
        [
          plan.scope.organisationId,
          plan.scope.repositoryId,
          principal.id,
          plan.id,
        ],
      );
      await client.query('commit');
      return plan.id;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  private async currentSources(plan: TestPlan): Promise<void> {
    if (plan.operation === 'create_pr' && !plan.publication)
      throw new PolicyDenied();
    const report = await this.knowledge.getReport(
      plan.scope,
      plan.assessmentId,
    );
    if (
      !report ||
      report.stale ||
      report.report.state !== 'assessment_ready' ||
      report.report.headSha !== plan.appSha ||
      !plan.criterionIds.every((id) =>
        report.report.requirements.some(
          (req) => req.id === id && req.status === 'explicit',
        ),
      )
    )
      throw new PolicyDenied();
    const feature = (
      await this.pool.query<{ head_sha: string }>(
        'select head_sha from features where organisation_id=$1 and repository_id=$2 and id=$3',
        [plan.scope.organisationId, plan.scope.repositoryId, plan.featureId],
      )
    ).rows[0];
    if (feature?.head_sha !== plan.appSha) throw new PolicyDenied();
  }
  async get(principal: Principal, id: string) {
    requireCapability(principal, principal.scope, 'assessment.read');
    const row = (
      await this.pool.query<{ plan: unknown; plan_hash: string }>(
        'select plan,plan_hash from test_plans where organisation_id=$1 and repository_id=$2 and id=$3',
        [principal.scope.organisationId, principal.scope.repositoryId, id],
      )
    ).rows[0];
    if (!row) return null;
    const latest = (
      await this.pool.query<{
        decision: string;
        expires_at: Date;
        active: boolean;
        actor: string;
        plan_hash: string;
      }>(
        'select decision,plan_hash,expires_at,expires_at>clock_timestamp() as active,actor from approval_decisions where organisation_id=$1 and repository_id=$2 and plan_id=$3 order by created_at desc,id desc limit 1',
        [principal.scope.organisationId, principal.scope.repositoryId, id],
      )
    ).rows[0];
    return {
      plan: TestPlanSchema.parse(row.plan),
      hash: row.plan_hash,
      approval: latest
        ? {
            status:
              latest.plan_hash !== row.plan_hash
                ? 'superseded'
                : latest.decision === 'approved' && !latest.active
                  ? 'expired'
                  : latest.decision,
            expiresAt: latest.expires_at.toISOString(),
            actor: latest.actor,
          }
        : { status: 'awaiting_approval', expiresAt: null, actor: null },
    };
  }
  async decide(
    principal: Principal,
    id: string,
    decision: 'approved' | 'rejected' | 'revoked',
    expiresAt = new Date(Date.now() + 300_000).toISOString(),
  ): Promise<void> {
    requireCapability(
      principal,
      principal.scope,
      decision === 'revoked' ? 'plan.revoke' : 'plan.approve',
    );
    const current = await this.get(principal, id);
    if (
      !current ||
      !Number.isFinite(Date.parse(expiresAt)) ||
      Date.parse(expiresAt) <= Date.now() ||
      Date.parse(expiresAt) > Date.now() + 86_400_000
    )
      throw new PolicyDenied();
    if (decision === 'approved') {
      await this.currentSources(current.plan);
      requireReadiness(
        current.plan,
        await this.graph.readiness(principal.scope, current.plan.featureId),
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        'select id from test_plans where id=$1 and organisation_id=$2 and repository_id=$3 for update',
        [id, principal.scope.organisationId, principal.scope.repositoryId],
      );
      await client.query(
        'insert into approval_decisions (organisation_id,repository_id,plan_id,plan_hash,decision,actor,expires_at,created_at) values ($1,$2,$3,$4,$5,$6,$7,clock_timestamp())',
        [
          principal.scope.organisationId,
          principal.scope.repositoryId,
          id,
          current.hash,
          decision,
          principal.id,
          expiresAt,
        ],
      );
      await client.query(
        'insert into governance_events (organisation_id,repository_id,actor,action,target_id) values ($1,$2,$3,$4,$5)',
        [
          principal.scope.organisationId,
          principal.scope.repositoryId,
          principal.id,
          `plan_${decision}`,
          id,
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
  async authorize(
    principal: Principal,
    id: string,
    expected: {
      appSha: string;
      testRevisionSha: string;
      draftHash: string | null;
    },
  ): Promise<TestPlan> {
    const current = await this.get(principal, id);
    if (!current) throw new PolicyDenied();
    requireCapability(principal, current.plan.scope, current.plan.operation);
    if (
      current.approval.status !== 'approved' ||
      current.hash !== planHash(current.plan) ||
      current.plan.appSha !== expected.appSha ||
      current.plan.testRevisionSha !== expected.testRevisionSha ||
      current.plan.draftHash !== expected.draftHash
    )
      throw new PolicyDenied();
    await this.currentSources(current.plan);
    requireReadiness(
      current.plan,
      await this.graph.readiness(principal.scope, current.plan.featureId),
    );
    return current.plan;
  }
  async list(principal: Principal) {
    requireCapability(principal, principal.scope, 'assessment.read');
    const ids = (
      await this.pool.query<{ id: string }>(
        'select id from test_plans where organisation_id=$1 and repository_id=$2 order by created_at desc,id desc limit 100',
        [principal.scope.organisationId, principal.scope.repositoryId],
      )
    ).rows;
    return Promise.all(ids.map((row) => this.get(principal, row.id)));
  }
  async publicationEvent(
    principal: Principal,
    planId: string,
    event: 'started' | 'recorded' | 'failed',
    receiptId?: string,
  ): Promise<void> {
    requireCapability(principal, principal.scope, 'create_pr');
    const result = await this.pool.query(
      `insert into governance_events (organisation_id,repository_id,actor,action,target_id)
      select organisation_id,repository_id,$4,$5,$6 from test_plans where organisation_id=$1 and repository_id=$2 and id=$3 returning id`,
      [
        principal.scope.organisationId,
        principal.scope.repositoryId,
        planId,
        principal.id,
        `publication_${event}`,
        receiptId ?? planId,
      ],
    );
    if (result.rowCount !== 1) throw new PolicyDenied();
  }
  async overview(principal: Principal) {
    requireCapability(principal, principal.scope, 'assessment.read');
    const scope: Scope = principal.scope;
    const counts = (
      await this.pool.query<{
        assessments: string;
        reports: string;
        stale: string;
        sources: string;
        tests: string;
        dead_letters: string;
        knowledge_payload_bytes: string;
        registered_artifact_bytes: string;
      }>(
        `select
      (select count(*) from assessments where organisation_id=$1 and repository_id=$2) as assessments,
      (select count(*) from assessment_reports where organisation_id=$1 and repository_id=$2) as reports,
      (select count(*) from assessment_reports where organisation_id=$1 and repository_id=$2 and stale) as stale,
      (select count(*) from source_records where organisation_id=$1 and repository_id=$2 and revoked_at is null) as sources,
      (select count(*) from test_assets where organisation_id=$1 and repository_id=$2) as tests,
      (select count(*) from assessments where organisation_id=$1 and repository_id=$2 and status='dead_letter') as dead_letters,
      ((select coalesce(sum(octet_length(snapshot::text)),0) from source_versions where organisation_id=$1 and repository_id=$2)+(select coalesce(sum(octet_length(report::text)),0) from assessment_reports where organisation_id=$1 and repository_id=$2)+(select coalesce(sum(octet_length(asset::text)),0) from test_assets where organisation_id=$1 and repository_id=$2))::text as knowledge_payload_bytes,
      (select coalesce(sum((reference->>'bytes')::bigint),0)::text from artifact_refs where organisation_id=$1 and repository_id=$2 and state='active') as registered_artifact_bytes`,
        [scope.organisationId, scope.repositoryId],
      )
    ).rows[0];
    const reports = (
      await this.pool.query<{
        assessment_id: string;
        stale: boolean;
        head_sha: string;
        state: string;
        source_id: string;
      }>(
        `select r.assessment_id,r.stale,a.head_sha,a.task #>> '{source,id}' as source_id,r.report->>'state' as state from assessment_reports r join assessments a on a.id=r.assessment_id where r.organisation_id=$1 and r.repository_id=$2 order by r.created_at desc limit 100`,
        [scope.organisationId, scope.repositoryId],
      )
    ).rows;
    return {
      scope,
      counts,
      reports,
      footprint: {
        knowledgePayloadEstimateBytes: counts?.knowledge_payload_bytes ?? '0',
        registeredActiveArtifactBytes: counts?.registered_artifact_bytes ?? '0',
        physicalDatabaseAndIndexBytes: 'not measured',
        backupBytes: 'not measured',
      },
      verifiedCoverage: 'not measured',
      retrievalBenchmark: 'not measured',
    };
  }
}
