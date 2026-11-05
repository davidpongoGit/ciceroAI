import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { requireCapability } from '@cai/policy';
import type { Principal } from '@cai/contracts';
import {
  AssessmentSchema,
  AnalysisResultSchema,
  ScopeSchema,
  type Assessment,
  type FailureReason,
  type IntakeEvent,
  type IntakeResult,
  type Lease,
  type Scope,
  type WorkflowStore,
} from '@cai/contracts';

type AssessmentRow = {
  id: string;
  organisation_id: string;
  repository_id: string;
  correlation_id: string;
  status: string;
  attempts: number;
  head_sha: string;
  task: unknown;
  result: unknown;
  last_error: string | null;
};
function parseRow(row: AssessmentRow): Assessment {
  return AssessmentSchema.parse({
    id: row.id,
    organisationId: row.organisation_id,
    repositoryId: row.repository_id,
    correlationId: row.correlation_id,
    status: row.status,
    attempts: row.attempts,
    headSha: row.head_sha,
    task: row.task,
    result: row.result,
    lastError: row.last_error,
  });
}
export class DeliveryConflict extends Error {
  constructor() {
    super('Delivery ID already refers to different content.');
  }
}

export class PostgresWorkflowStore implements WorkflowStore {
  async replay(principal: Principal, id: string): Promise<boolean> {
    requireCapability(principal, principal.scope, 'data.manage');
    const result = await this.pool.query(
      `with replayed as (
      update assessments set status='queued',attempts=0,manual_replays=manual_replays+1,last_error=null,lease_token=null,lease_until=null,available_at=clock_timestamp()
      where organisation_id=$1 and repository_id=$2 and id=$3 and status='dead_letter' and manual_replays<3 and exists(select 1 from scope_controls where organisation_id=$1 and repository_id=$2 and phase='active') returning *
    ) insert into audit_events (organisation_id,repository_id,assessment_id,correlation_id,action,actor) select organisation_id,repository_id,id,correlation_id,'manual_replay',$4 from replayed returning id`,
      [
        principal.scope.organisationId,
        principal.scope.repositoryId,
        id,
        principal.id,
      ],
    );
    return result.rowCount === 1;
  }
  constructor(private readonly pool: pg.Pool) {}

  async intake(input: IntakeEvent): Promise<IntakeResult> {
    const scope = ScopeSchema.parse(input.scope);
    const pr = input.event.pull_request;
    if (
      String(input.event.repository.id) !== scope.repositoryId ||
      String(input.event.installation.id) !== input.installationId
    )
      throw new Error('Event scope mismatch.');
    const logicalKey = createHash('sha256')
      .update(
        JSON.stringify([
          input.installationId,
          scope.repositoryId,
          pr.number,
          pr.head.sha,
          pr.base.sha,
          input.event.action === 'closed' ? 'closed' : 'assess',
          pr.merged,
        ]),
      )
      .digest('hex');
    const task = {
      kind: 'foundation_probe',
      ...scope,
      source: {
        id: `github:pr:${String(pr.number)}`,
        version: pr.head.sha,
        sha256: input.sourceHash,
      },
    };
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        'insert into scope_controls (organisation_id,repository_id) values ($1,$2) on conflict do nothing',
        [scope.organisationId, scope.repositoryId],
      );
      const control = await client.query(
        "select id from scope_controls where organisation_id=$1 and repository_id=$2 and phase='active' for share",
        [scope.organisationId, scope.repositoryId],
      );
      if (control.rowCount !== 1)
        throw new Error('Installation scope is disabled.');
      const delivered = (
        await client.query<{
          source_hash: string;
          id: string;
          correlation_id: string;
        }>(
          `select e.source_hash,a.id,a.correlation_id from inbound_events e join assessments a on a.id=e.assessment_id where e.organisation_id=$1 and e.installation_id=$2 and e.delivery_id=$3`,
          [scope.organisationId, input.installationId, input.deliveryId],
        )
      ).rows[0];
      if (delivered) {
        if (delivered.source_hash !== input.sourceHash)
          throw new DeliveryConflict();
        await client.query('commit');
        return {
          id: delivered.id,
          correlationId: delivered.correlation_id,
          duplicate: true,
        };
      }
      const inserted = await client.query<AssessmentRow>(
        `insert into assessments (organisation_id,repository_id,logical_key,head_sha,task) values ($1,$2,$3,$4,$5) on conflict (organisation_id,repository_id,logical_key) do nothing returning *`,
        [
          scope.organisationId,
          scope.repositoryId,
          logicalKey,
          pr.head.sha,
          task,
        ],
      );
      const existing =
        inserted.rows[0] ??
        (
          await client.query<AssessmentRow>(
            'select * from assessments where organisation_id=$1 and repository_id=$2 and logical_key=$3',
            [scope.organisationId, scope.repositoryId, logicalKey],
          )
        ).rows[0];
      if (!existing) throw new Error('Assessment missing.');
      const event = await client.query(
        'insert into inbound_events (organisation_id,repository_id,installation_id,delivery_id,source_hash,assessment_id,metadata) values ($1,$2,$3,$4,$5,$6,$7) on conflict (organisation_id,installation_id,delivery_id) do nothing returning id',
        [
          scope.organisationId,
          scope.repositoryId,
          input.installationId,
          input.deliveryId,
          input.sourceHash,
          existing.id,
          input.event,
        ],
      );
      if (event.rowCount === 0) {
        const previous = await client.query<{
          source_hash: string;
          assessment_id: string;
        }>(
          'select source_hash,assessment_id from inbound_events where organisation_id=$1 and installation_id=$2 and delivery_id=$3',
          [scope.organisationId, input.installationId, input.deliveryId],
        );
        if (
          previous.rows[0]?.source_hash !== input.sourceHash ||
          previous.rows[0].assessment_id !== existing.id
        )
          throw new DeliveryConflict();
      }
      if (inserted.rowCount === 1)
        await client.query(
          'insert into audit_events (organisation_id,repository_id,assessment_id,correlation_id,action,actor) values ($1,$2,$3,$4,$5,$6)',
          [
            scope.organisationId,
            scope.repositoryId,
            existing.id,
            existing.correlation_id,
            'queued',
            'webhook',
          ],
        );
      await client.query('commit');
      return {
        id: existing.id,
        correlationId: existing.correlation_id,
        duplicate: inserted.rowCount === 0,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(scope: Scope, id: string): Promise<Assessment | null> {
    ScopeSchema.parse(scope);
    const result = await this.pool.query<AssessmentRow>(
      'select * from assessments where organisation_id=$1 and repository_id=$2 and id=$3',
      [scope.organisationId, scope.repositoryId, id],
    );
    return result.rows[0] ? parseRow(result.rows[0]) : null;
  }

  async claim(scope: Scope, leaseMs = 30_000): Promise<Lease | null> {
    ScopeSchema.parse(scope);
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 60_000)
      throw new Error('Invalid lease duration.');
    const token = randomUUID();
    const result = await this.pool.query<AssessmentRow>(
      `with expired as (
      update assessments set status='dead_letter',last_error='lease_expired',lease_token=null,lease_until=null,updated_at=clock_timestamp()
      where organisation_id=$1 and repository_id=$2 and status='running' and lease_until<clock_timestamp() and attempts>=3 returning *
    ), audit_expired as (
      insert into audit_events (organisation_id,repository_id,assessment_id,correlation_id,action,actor)
      select organisation_id,repository_id,id,correlation_id,'dead_letter','recovery' from expired
    ), candidate as (
      select id from assessments where organisation_id=$1 and repository_id=$2 and attempts<3 and exists(select 1 from scope_controls where organisation_id=$1 and repository_id=$2 and phase='active') and
      ((status='queued' and available_at<=clock_timestamp()) or (status='running' and lease_until<clock_timestamp()))
      order by created_at,id for update skip locked limit 1
    ), claimed as (
      update assessments a set status='running',attempts=attempts+1,lease_token=$3,lease_until=clock_timestamp()+($4::int * interval '1 millisecond'),updated_at=clock_timestamp()
      from candidate c where a.id=c.id returning a.*
    ), audit_claimed as (
      insert into audit_events (organisation_id,repository_id,assessment_id,correlation_id,action,actor)
      select organisation_id,repository_id,id,correlation_id,'running','worker' from claimed
    ) select * from claimed`,
      [scope.organisationId, scope.repositoryId, token, leaseMs],
    );
    return result.rows[0]
      ? { assessment: parseRow(result.rows[0]), token }
      : null;
  }

  async complete(
    scope: Scope,
    lease: Lease,
    output: unknown,
  ): Promise<boolean> {
    const result = AnalysisResultSchema.parse(output);
    if (JSON.stringify(result.task) !== JSON.stringify(lease.assessment.task))
      throw new Error('Result provenance mismatch.');
    return this.finish(scope, lease, result, null, 0);
  }
  async fail(
    scope: Scope,
    lease: Lease,
    reason: FailureReason,
    delayMs = 1000,
  ): Promise<boolean> {
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 86_400_000)
      throw new Error('Invalid retry delay.');
    return this.finish(scope, lease, null, reason, delayMs);
  }
  private async finish(
    scope: Scope,
    lease: Lease,
    result: unknown,
    reason: FailureReason | null,
    delayMs: number,
  ): Promise<boolean> {
    ScopeSchema.parse(scope);
    const updated = await this.pool.query(
      `with changed as (
      update assessments set status=case when $5::jsonb is not null then 'completed' when attempts>=3 or $6='retry_exceeds_policy' then 'dead_letter' else 'queued' end,
      result=$5,last_error=$6,lease_token=null,lease_until=null,available_at=clock_timestamp()+($7::int * interval '1 millisecond'),updated_at=clock_timestamp()
      where organisation_id=$1 and repository_id=$2 and id=$3 and lease_token=$4 and status='running' and lease_until>clock_timestamp() returning *
    ) insert into audit_events (organisation_id,repository_id,assessment_id,correlation_id,action,actor)
    select organisation_id,repository_id,id,correlation_id,status,'worker' from changed returning id`,
      [
        scope.organisationId,
        scope.repositoryId,
        lease.assessment.id,
        lease.token,
        result,
        reason,
        delayMs,
      ],
    );
    return updated.rowCount === 1;
  }
}
