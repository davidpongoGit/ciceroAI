import type pg from 'pg';
import {
  ArtifactRefSchema,
  type ArtifactRef,
  type ArtifactStore,
  type Principal,
} from '@cai/contracts';
import { PolicyDenied, requireCapability } from '@cai/policy';
import type { PostgresKnowledgeStore } from './knowledge.js';

export class PostgresArtifactCatalog {
  async list(
    principal: Principal,
    assessmentId: string,
  ): Promise<ArtifactRef[]> {
    requireCapability(principal, principal.scope, 'assessment.read');
    if (!(await this.knowledge.getReport(principal.scope, assessmentId)))
      return [];
    return (
      await this.pool.query<{ reference: unknown }>(
        "select reference from artifact_refs where organisation_id=$1 and repository_id=$2 and assessment_id=$3 and state='active' and (expires_at>clock_timestamp() or legal_hold) order by created_at desc limit 100",
        [
          principal.scope.organisationId,
          principal.scope.repositoryId,
          assessmentId,
        ],
      )
    ).rows.map((row) => ArtifactRefSchema.parse(row.reference));
  }
  constructor(
    private readonly pool: pg.Pool,
    private readonly knowledge: PostgresKnowledgeStore,
  ) {}
  async register(
    principal: Principal,
    assessmentId: string | null,
    input: ArtifactRef,
  ): Promise<void> {
    const reference = ArtifactRefSchema.parse(input);
    requireCapability(principal, reference.scope, 'data.manage');
    if (
      assessmentId &&
      !(await this.knowledge.getReport(reference.scope, assessmentId))
    )
      throw new PolicyDenied();
    const stored = await this.pool.query(
      `with scope as (select id from scope_controls where organisation_id=$2 and repository_id=$3 and phase='active' for share), stored as (
      insert into artifact_refs (id,organisation_id,repository_id,assessment_id,reference,expires_at) select $1,$2,$3,$4,$5,$6 from scope returning id
    ) insert into governance_events (organisation_id,repository_id,actor,action,target_id) select $2,$3,$7,'artifact_stored',id::text from stored returning id`,
      [
        reference.id,
        reference.scope.organisationId,
        reference.scope.repositoryId,
        assessmentId,
        reference,
        reference.expiresAt,
        principal.id,
      ],
    );
    if (stored.rowCount !== 1) throw new PolicyDenied();
  }
  async reference(
    principal: Principal,
    id: string,
  ): Promise<ArtifactRef | null> {
    requireCapability(principal, principal.scope, 'assessment.read');
    const row = (
      await this.pool.query<{
        reference: unknown;
        assessment_id: string | null;
        expires_at: Date;
      }>(
        "select reference,assessment_id,expires_at from artifact_refs where organisation_id=$1 and repository_id=$2 and id=$3 and state='active' and (expires_at>clock_timestamp() or legal_hold) and exists(select 1 from scope_controls where organisation_id=$1 and repository_id=$2 and phase='active')",
        [principal.scope.organisationId, principal.scope.repositoryId, id],
      )
    ).rows[0];
    if (
      !row ||
      (row.assessment_id &&
        !(await this.knowledge.getReport(principal.scope, row.assessment_id)))
    )
      return null;
    return {
      ...ArtifactRefSchema.parse(row.reference),
      expiresAt: row.expires_at.toISOString(),
    };
  }
  async setHold(
    principal: Principal,
    id: string,
    hold: boolean,
  ): Promise<void> {
    requireCapability(principal, principal.scope, 'data.manage');
    const result = await this.pool.query(
      `with scope as (select id from scope_controls where organisation_id=$1 and repository_id=$2 and phase='active' for share), changed as (update artifact_refs set legal_hold=$4 where organisation_id=$1 and repository_id=$2 and id=$3 and state='active' and exists(select 1 from scope) returning id)
      insert into governance_events (organisation_id,repository_id,actor,action,target_id) select $1,$2,$5,$6,id::text from changed returning id`,
      [
        principal.scope.organisationId,
        principal.scope.repositoryId,
        id,
        hold,
        principal.id,
        hold ? 'artifact_hold_set' : 'artifact_hold_released',
      ],
    );
    if (result.rowCount !== 1) throw new PolicyDenied();
  }
  async expire(principal: Principal, store: ArtifactStore): Promise<number> {
    requireCapability(principal, principal.scope, 'data.manage');
    const due = (
      await this.pool.query<{ id: string }>(
        "select id from artifact_refs where organisation_id=$1 and repository_id=$2 and not legal_hold and ((state='active' and expires_at<=clock_timestamp()) or state='delete_pending') order by expires_at,id limit 100",
        [principal.scope.organisationId, principal.scope.repositoryId],
      )
    ).rows;
    let count = 0;
    for (const item of due) {
      const reserved = (
        await this.pool.query<{ reference: unknown }>(
          "update artifact_refs set state='delete_pending' where organisation_id=$1 and repository_id=$2 and id=$3 and not legal_hold and state in ('active','delete_pending') returning reference",
          [
            principal.scope.organisationId,
            principal.scope.repositoryId,
            item.id,
          ],
        )
      ).rows[0];
      if (!reserved) continue;
      try {
        await store.delete(
          principal.scope,
          ArtifactRefSchema.parse(reserved.reference),
        );
      } catch {
        await this.pool.query(
          "insert into governance_events (organisation_id,repository_id,actor,action,target_id) values ($1,$2,$3,'artifact_expiry_failed',$4)",
          [
            principal.scope.organisationId,
            principal.scope.repositoryId,
            principal.id,
            item.id,
          ],
        );
        throw new Error(
          'Artifact expiry failed; pending deletion will be retried.',
        );
      }
      const completed = await this.pool.query(
        `with expired as (update artifact_refs set state='expired' where organisation_id=$1 and repository_id=$2 and id=$3 and state='delete_pending' returning id)
        insert into governance_events (organisation_id,repository_id,actor,action,target_id) select $1,$2,$4,'artifact_expired',id::text from expired returning id`,
        [
          principal.scope.organisationId,
          principal.scope.repositoryId,
          item.id,
          principal.id,
        ],
      );
      count += completed.rowCount ?? 0;
    }
    return count;
  }
}
