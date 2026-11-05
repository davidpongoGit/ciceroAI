import type pg from 'pg';
import {
  AnalysisResultSchema,
  ChangeAssessmentSchema,
  ScopeSchema,
  SourceSnapshotSchema,
  type ChangeAssessment,
  type Lease,
  type Scope,
  type SourceSnapshot,
} from '@cai/contracts';

export class PostgresKnowledgeStore {
  constructor(private readonly pool: pg.Pool) {}

  async completeAnalysis(
    scope: Scope,
    lease: Lease,
    input: { snapshots: SourceSnapshot[]; report: ChangeAssessment },
    modelResult: unknown,
  ): Promise<boolean> {
    ScopeSchema.parse(scope);
    const report = ChangeAssessmentSchema.parse(input.report);
    const sources = input.snapshots.map((item) =>
      SourceSnapshotSchema.parse(item),
    );
    const result = AnalysisResultSchema.parse(modelResult);
    if (
      report.scope.organisationId !== scope.organisationId ||
      report.scope.repositoryId !== scope.repositoryId ||
      report.headSha !== lease.assessment.headSha ||
      JSON.stringify(result.task) !== JSON.stringify(lease.assessment.task) ||
      sources.some(
        (item) =>
          item.scope.organisationId !== scope.organisationId ||
          item.scope.repositoryId !== scope.repositoryId,
      )
    )
      throw new Error('Analysis provenance mismatch.');
    const references = sources.map((source) =>
      JSON.stringify(source.reference),
    );
    if (
      report.sourceReferences.some(
        (ref) => !references.includes(JSON.stringify(ref)),
      ) ||
      report.requirements.some((req) =>
        req.sources.some((ref) => !references.includes(JSON.stringify(ref))),
      )
    )
      throw new Error('Unsupported source reference.');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const control = await client.query(
        "select id from scope_controls where organisation_id=$1 and repository_id=$2 and phase='active' for share",
        [scope.organisationId, scope.repositoryId],
      );
      if (control.rowCount !== 1)
        throw new Error('Installation scope is disabled.');
      const locked = await client.query(
        "select id from assessments where organisation_id=$1 and repository_id=$2 and id=$3 and lease_token=$4 and status='running' and lease_until>clock_timestamp() for update",
        [
          scope.organisationId,
          scope.repositoryId,
          lease.assessment.id,
          lease.token,
        ],
      );
      if (locked.rowCount !== 1) {
        await client.query('rollback');
        return false;
      }
      const versionIds: string[] = [];
      for (const source of [...sources].sort((a, b) =>
        a.reference.sourceKey.localeCompare(b.reference.sourceKey),
      )) {
        await client.query(
          'insert into source_records (organisation_id,repository_id,source_key) values ($1,$2,$3) on conflict (organisation_id,repository_id,source_key) do nothing',
          [
            scope.organisationId,
            scope.repositoryId,
            source.reference.sourceKey,
          ],
        );
        const record = (
          await client.query<{ id: string; revoked_at: Date | null }>(
            'select id,revoked_at from source_records where organisation_id=$1 and repository_id=$2 and source_key=$3 for update',
            [
              scope.organisationId,
              scope.repositoryId,
              source.reference.sourceKey,
            ],
          )
        ).rows[0];
        if (!record || record.revoked_at)
          throw new Error('Source access revoked.');
        await client.query(
          `insert into invalidations (organisation_id,repository_id,source_record_id,reason)
          select $1,$2,$3,'source_changed' where exists (select 1 from source_versions where source_record_id=$3 and is_current and (version<>$4 or content_hash<>$5))`,
          [
            scope.organisationId,
            scope.repositoryId,
            record.id,
            source.reference.version,
            source.reference.contentHash,
          ],
        );
        await client.query(
          `update assessment_reports r set stale=true where r.organisation_id=$1 and r.repository_id=$2 and exists (
          select 1 from report_sources rs join source_versions v on v.id=rs.source_version_id where rs.assessment_id=r.assessment_id and v.source_record_id=$3 and v.is_current and (v.version<>$4 or v.content_hash<>$5))`,
          [
            scope.organisationId,
            scope.repositoryId,
            record.id,
            source.reference.version,
            source.reference.contentHash,
          ],
        );
        await client.query(
          'update source_versions set is_current=false where source_record_id=$1 and is_current',
          [record.id],
        );
        const version = await client.query<{ id: string }>(
          'insert into source_versions (source_record_id,organisation_id,repository_id,version,content_hash,snapshot,observed_at) values ($1,$2,$3,$4,$5,$6,$7) on conflict (source_record_id,version,content_hash) do update set is_current=true returning id',
          [
            record.id,
            scope.organisationId,
            scope.repositoryId,
            source.reference.version,
            source.reference.contentHash,
            source,
            source.observedAt,
          ],
        );
        if (!version.rows[0]) throw new Error('Source version unavailable.');
        versionIds.push(version.rows[0].id);
      }
      await client.query(
        'insert into assessment_reports (assessment_id,organisation_id,repository_id,report) values ($1,$2,$3,$4)',
        [lease.assessment.id, scope.organisationId, scope.repositoryId, report],
      );
      for (const id of versionIds)
        await client.query(
          'insert into report_sources (organisation_id,repository_id,assessment_id,source_version_id) values ($1,$2,$3,$4) on conflict do nothing',
          [scope.organisationId, scope.repositoryId, lease.assessment.id, id],
        );
      await client.query(
        "update assessments set status='completed',result=$5,lease_token=null,lease_until=null,last_error=null,updated_at=clock_timestamp() where organisation_id=$1 and repository_id=$2 and id=$3 and lease_token=$4",
        [
          scope.organisationId,
          scope.repositoryId,
          lease.assessment.id,
          lease.token,
          result,
        ],
      );
      await client.query(
        "insert into audit_events (organisation_id,repository_id,assessment_id,correlation_id,action,actor) values ($1,$2,$3,$4,'analysis_completed','deterministic-v1')",
        [
          scope.organisationId,
          scope.repositoryId,
          lease.assessment.id,
          lease.assessment.correlationId,
        ],
      );
      await client.query('commit');
      return true;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  async getReport(
    scope: Scope,
    id: string,
  ): Promise<{ report: ChangeAssessment; stale: boolean } | null> {
    ScopeSchema.parse(scope);
    const row = (
      await this.pool.query<{ report: unknown; stale: boolean }>(
        `select report,stale from assessment_reports r where organisation_id=$1 and repository_id=$2 and assessment_id=$3 and exists (select 1 from scope_controls where organisation_id=$1 and repository_id=$2 and phase='active') and not exists (select 1 from report_sources rs join source_versions v on v.id=rs.source_version_id join source_records s on s.id=v.source_record_id where rs.assessment_id=r.assessment_id and s.revoked_at is not null)`,
        [scope.organisationId, scope.repositoryId, id],
      )
    ).rows[0];
    return row
      ? { report: ChangeAssessmentSchema.parse(row.report), stale: row.stale }
      : null;
  }
}
