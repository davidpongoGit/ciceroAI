import type pg from 'pg';
import { z } from 'zod';
import type { Principal } from '@cai/contracts';
import { requireCapability } from '@cai/policy';
export class PostgresRetention {
  constructor(private readonly pool: pg.Pool) {}
  async configure(
    principal: Principal,
    input: { rawEventDays: number; artifactMaxDays: number },
  ): Promise<void> {
    requireCapability(principal, principal.scope, 'data.manage');
    const policy = z
      .strictObject({
        rawEventDays: z.number().int().min(1).max(365),
        artifactMaxDays: z.number().int().min(1).max(365),
      })
      .parse(input);
    await this.pool.query(
      `with changed as (insert into retention_policies (organisation_id,repository_id,raw_event_days,artifact_max_days) values ($1,$2,$3,$4) on conflict (organisation_id,repository_id) do update set raw_event_days=$3,artifact_max_days=$4 returning id)
    insert into governance_events (organisation_id,repository_id,actor,action,target_id) select $1,$2,$5,'retention_configured',id::text from changed`,
      [
        principal.scope.organisationId,
        principal.scope.repositoryId,
        policy.rawEventDays,
        policy.artifactMaxDays,
        principal.id,
      ],
    );
  }
  async sweep(principal: Principal): Promise<number> {
    requireCapability(principal, principal.scope, 'data.manage');
    const rows = await this.pool.query(
      `with policy as (
      select coalesce((select raw_event_days from retention_policies where organisation_id=$1 and repository_id=$2),14) as days
    ), eligible as (
      select id from inbound_events,policy where organisation_id=$1 and repository_id=$2 and metadata<>'{}'::jsonb and created_at<clock_timestamp()-policy.days*interval '1 day'
      and not exists(select 1 from artifact_refs where organisation_id=$1 and repository_id=$2 and legal_hold) order by created_at limit 100
    ), minimised as (update inbound_events e set metadata='{}'::jsonb from eligible x where e.id=x.id returning e.id)
    insert into governance_events (organisation_id,repository_id,actor,action,target_id) select $1,$2,$3,'webhook_metadata_expired',id::text from minimised returning id`,
      [
        principal.scope.organisationId,
        principal.scope.repositoryId,
        principal.id,
      ],
    );
    await this.pool.query(
      `update artifact_refs set expires_at=least(expires_at,created_at+coalesce((select artifact_max_days from retention_policies where organisation_id=$1 and repository_id=$2),30)*interval '1 day') where organisation_id=$1 and repository_id=$2 and state='active' and not legal_hold`,
      [principal.scope.organisationId, principal.scope.repositoryId],
    );
    return rows.rowCount ?? 0;
  }
}
