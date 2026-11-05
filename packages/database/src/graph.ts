import type pg from 'pg';
import {
  DependencySchema,
  ScopeSchema,
  ShaSchema,
  evaluateReadiness,
  type Dependency,
  type Scope,
} from '@cai/contracts';

export class PostgresGraphStore {
  constructor(private readonly pool: pg.Pool) {}
  async configureFeature(
    scope: Scope,
    key: string,
    headSha: string,
    dependenciesComplete: boolean,
  ): Promise<string> {
    ScopeSchema.parse(scope);
    ShaSchema.parse(headSha);
    if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(key))
      throw new Error('Invalid feature key.');
    const row = (
      await this.pool.query<{ id: string }>(
        `insert into features (organisation_id,repository_id,feature_key,head_sha,dependencies_complete) select $1,$2,$3,$4,$5 from scope_controls where organisation_id=$1 and repository_id=$2 and phase='active' on conflict (organisation_id,repository_id,feature_key) do update set head_sha=$4,dependencies_complete=$5 returning id`,
        [
          scope.organisationId,
          scope.repositoryId,
          key,
          headSha,
          dependenciesComplete,
        ],
      )
    ).rows[0];
    if (!row) throw new Error('Feature not configured.');
    return row.id;
  }
  async reviseDependency(
    scope: Scope,
    featureId: string,
    input: Dependency,
    actor: 'human-review' | 'synthetic-fixture',
  ): Promise<void> {
    ScopeSchema.parse(scope);
    const dependency = DependencySchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const feature = await client.query(
        'select id from features where organisation_id=$1 and repository_id=$2 and id=$3 for update',
        [scope.organisationId, scope.repositoryId, featureId],
      );
      if (feature.rowCount !== 1) throw new Error('Feature not found.');
      const source = (
        await client.query<{ id: string; source_record_id: string }>(
          `select v.id,v.source_record_id from source_versions v join source_records r on r.id=v.source_record_id where v.organisation_id=$1 and v.repository_id=$2 and r.source_key=$3 and v.version=$4 and v.content_hash=$5 and v.is_current and r.revoked_at is null for share of r`,
          [
            scope.organisationId,
            scope.repositoryId,
            dependency.source.sourceKey,
            dependency.source.version,
            dependency.source.contentHash,
          ],
        )
      ).rows[0];
      if (!source)
        throw new Error('Current authorised source version required.');
      const revision =
        (
          await client.query<{ next: number }>(
            'select coalesce(max(revision),0)+1 as next from dependencies where feature_id=$1 and dependency_key=$2',
            [featureId, dependency.key],
          )
        ).rows[0]?.next ?? 1;
      await client.query(
        'update dependencies set active=false where feature_id=$1 and dependency_key=$2 and active',
        [featureId, dependency.key],
      );
      await client.query(
        'insert into dependencies (organisation_id,repository_id,feature_id,dependency_key,revision,dependency,source_version_id,actor) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          scope.organisationId,
          scope.repositoryId,
          featureId,
          dependency.key,
          revision,
          dependency,
          source.id,
          actor,
        ],
      );
      await client.query(
        "insert into invalidations (organisation_id,repository_id,source_record_id,feature_id,reason) values ($1,$2,$3,$4,'dependency_revised')",
        [
          scope.organisationId,
          scope.repositoryId,
          source.source_record_id,
          featureId,
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
  async readiness(scope: Scope, featureId: string) {
    ScopeSchema.parse(scope);
    const feature = (
      await this.pool.query<{
        head_sha: string;
        dependencies_complete: boolean;
      }>(
        'select head_sha,dependencies_complete from features where organisation_id=$1 and repository_id=$2 and id=$3',
        [scope.organisationId, scope.repositoryId, featureId],
      )
    ).rows[0];
    if (!feature) return null;
    const rows = await this.pool.query<{ dependency: unknown; valid: boolean }>(
      `select d.dependency,(v.is_current and r.revoked_at is null) as valid from dependencies d join source_versions v on v.id=d.source_version_id join source_records r on r.id=v.source_record_id where d.organisation_id=$1 and d.repository_id=$2 and d.feature_id=$3 and d.active`,
      [scope.organisationId, scope.repositoryId, featureId],
    );
    return evaluateReadiness(
      feature.head_sha,
      feature.dependencies_complete,
      rows.rows.map((row) => ({
        ...DependencySchema.parse(row.dependency),
        valid: row.valid,
      })),
    );
  }
  async revokeSource(scope: Scope, sourceKey: string): Promise<string[]> {
    ScopeSchema.parse(scope);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const record = (
        await client.query<{ id: string }>(
          'update source_records set revoked_at=clock_timestamp() where organisation_id=$1 and repository_id=$2 and source_key=$3 and revoked_at is null returning id',
          [scope.organisationId, scope.repositoryId, sourceKey],
        )
      ).rows[0];
      if (!record) {
        await client.query('commit');
        return [];
      }
      await client.query(
        "insert into invalidations (organisation_id,repository_id,source_record_id,reason) values ($1,$2,$3,'access_revoked')",
        [scope.organisationId, scope.repositoryId, record.id],
      );
      await client.query(
        'update assessment_reports r set stale=true where r.organisation_id=$1 and r.repository_id=$2 and exists (select 1 from report_sources rs join source_versions v on v.id=rs.source_version_id where rs.assessment_id=r.assessment_id and v.source_record_id=$3)',
        [scope.organisationId, scope.repositoryId, record.id],
      );
      const affected = await client.query<{ feature_id: string }>(
        'select distinct d.feature_id from dependencies d join source_versions v on v.id=d.source_version_id where d.organisation_id=$1 and d.repository_id=$2 and v.source_record_id=$3 and d.active',
        [scope.organisationId, scope.repositoryId, record.id],
      );
      await client.query('commit');
      return affected.rows.map((row) => row.feature_id);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
