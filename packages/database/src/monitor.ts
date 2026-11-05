import type pg from 'pg';
import type { Principal } from '@cai/contracts';
import { requireCapability } from '@cai/policy';
import type { PostgresGraphStore } from './graph.js';

export class PostgresMonitor {
  constructor(
    private readonly pool: pg.Pool,
    private readonly graph: PostgresGraphStore,
  ) {}
  async reconcile(principal: Principal): Promise<number> {
    requireCapability(principal, principal.scope, 'data.manage');
    const client = await this.pool.connect();
    let count = 0;
    try {
      await client.query('begin');
      const events = await client.query<{
        id: string;
        source_record_id: string;
        feature_id: string | null;
      }>(
        'select id,source_record_id,feature_id from invalidations where organisation_id=$1 and repository_id=$2 and processed_at is null order by created_at,id for update skip locked limit 100',
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      for (const event of events.rows) {
        const features = event.feature_id
          ? [{ feature_id: event.feature_id }]
          : (
              await client.query<{ feature_id: string }>(
                'select distinct d.feature_id from dependencies d join source_versions v on v.id=d.source_version_id where d.organisation_id=$1 and d.repository_id=$2 and v.source_record_id=$3 and d.active',
                [
                  principal.scope.organisationId,
                  principal.scope.repositoryId,
                  event.source_record_id,
                ],
              )
            ).rows;
        for (const feature of features) {
          const readiness = await this.graph.readiness(
            principal.scope,
            feature.feature_id,
          );
          await client.query(
            'insert into readiness_snapshots (organisation_id,repository_id,feature_id,cause_id,readiness) values ($1,$2,$3,$4,$5) on conflict do nothing',
            [
              principal.scope.organisationId,
              principal.scope.repositoryId,
              feature.feature_id,
              event.id,
              readiness,
            ],
          );
          await client.query(
            "insert into notifications (organisation_id,repository_id,dedupe_key,kind,target_id) values ($1,$2,$3,'readiness_changed',$4) on conflict do nothing",
            [
              principal.scope.organisationId,
              principal.scope.repositoryId,
              `${event.id}:${feature.feature_id}`,
              feature.feature_id,
            ],
          );
          count++;
        }
        await client.query(
          'update invalidations set processed_at=clock_timestamp() where id=$1',
          [event.id],
        );
      }
      await client.query(
        `insert into notifications (organisation_id,repository_id,dedupe_key,kind,target_id)
        select organisation_id,repository_id,'dead_letter:'||id::text,'dead_letter',id::text from assessments where organisation_id=$1 and repository_id=$2 and status='dead_letter' on conflict do nothing`,
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      await client.query('commit');
      return count;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  async notifications(principal: Principal) {
    requireCapability(principal, principal.scope, 'assessment.read');
    return (
      await this.pool.query<{
        id: string;
        kind: string;
        target_id: string;
        acknowledged_at: Date | null;
      }>(
        'select id,kind,target_id,acknowledged_at from notifications where organisation_id=$1 and repository_id=$2 order by created_at desc limit 100',
        [principal.scope.organisationId, principal.scope.repositoryId],
      )
    ).rows;
  }
  async acknowledge(principal: Principal, id: string): Promise<void> {
    requireCapability(principal, principal.scope, 'assessment.read');
    await this.pool.query(
      'update notifications set acknowledged_at=clock_timestamp() where organisation_id=$1 and repository_id=$2 and id=$3',
      [principal.scope.organisationId, principal.scope.repositoryId, id],
    );
  }
}
