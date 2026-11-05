import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import {
  ScopeSchema,
  type ArtifactStore,
  type Principal,
} from '@cai/contracts';
import { PolicyDenied, requireCapability } from '@cai/policy';

const TABLES = [
  'scope_controls',
  'retention_policies',
  'assessments',
  'source_records',
  'source_versions',
  'features',
  'assessment_reports',
  'report_sources',
  'inbound_events',
  'audit_events',
  'dependencies',
  'test_assets',
  'assertion_mappings',
  'run_evidence',
  'test_plans',
  'approval_decisions',
  'governance_events',
  'invalidations',
  'artifact_refs',
  'budget_accounts',
  'action_runs',
  'notifications',
  'readiness_snapshots',
  'data_jobs',
] as const;
const tableSchema = z.strictObject({
  rows: z.array(z.record(z.string(), z.unknown())).max(2000),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
});
const backupSchema = z.strictObject({
  version: z.literal(1),
  scope: ScopeSchema,
  createdAt: z.iso.datetime(),
  tables: z.record(z.enum(TABLES), tableSchema),
});
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type LogicalBackup = z.infer<typeof backupSchema>;

export class PostgresLifecycle {
  constructor(private readonly pool: pg.Pool) {}
  private async job(principal: Principal, kind: string): Promise<string> {
    const id = randomUUID();
    await this.pool.query(
      "insert into data_jobs (id,organisation_id,repository_id,kind,status,actor) values ($1,$2,$3,$4,'running',$5)",
      [
        id,
        principal.scope.organisationId,
        principal.scope.repositoryId,
        kind,
        principal.id,
      ],
    );
    return id;
  }
  async exportScope(
    principal: Principal,
  ): Promise<{ backup: LogicalBackup; checksum: string; jobId: string }> {
    requireCapability(principal, principal.scope, 'data.manage');
    const jobId = await this.job(principal, 'export');
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level repeatable read read only');
      await client.query("set local time zone 'UTC'");
      const active = await client.query(
        "select id from scope_controls where organisation_id=$1 and repository_id=$2 and phase='active'",
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      if (active.rowCount !== 1) throw new PolicyDenied();
      const tables = {} as LogicalBackup['tables'];
      let bytes = 0;
      for (const table of TABLES) {
        const budget = (
          await client.query<{ count: string; bytes: string }>(
            `select count(*)::text as count,coalesce(sum(octet_length(to_jsonb(t)::text)),0)::text as bytes from (select * from "${table}" where organisation_id=$1 and repository_id=$2 limit 2001) t`,
            [principal.scope.organisationId, principal.scope.repositoryId],
          )
        ).rows[0];
        if (
          !budget ||
          Number(budget.count) > 2000 ||
          (bytes += Number(budget.bytes)) > 4_800_000
        )
          throw new Error('Scoped export row/byte budget exceeded.');
        const rows = (
          await client.query<{ data: Record<string, unknown> }>(
            `select to_jsonb(t) as data from "${table}" t where organisation_id=$1 and repository_id=$2 order by to_jsonb(t)::text`,
            [principal.scope.organisationId, principal.scope.repositoryId],
          )
        ).rows.map((row) => row.data);
        tables[table] = { rows, checksum: hash(rows) };
      }
      await client.query('commit');
      const backup = backupSchema.parse({
        version: 1,
        scope: principal.scope,
        createdAt: new Date().toISOString(),
        tables,
      });
      const checksum = hash(backup);
      if (Buffer.byteLength(JSON.stringify(backup)) > 5_242_880)
        throw new Error('Scoped export byte budget exceeded.');
      await this.pool.query(
        "update data_jobs set status='completed',result_hash=$2 where id=$1",
        [jobId, checksum],
      );
      return { backup, checksum, jobId };
    } catch (error) {
      await client.query('rollback');
      await this.pool.query(
        "update data_jobs set status='failed' where id=$1",
        [jobId],
      );
      throw error;
    } finally {
      client.release();
    }
  }
  async restoreScope(
    principal: Principal,
    raw: string,
    expectedChecksum: string,
  ): Promise<string> {
    requireCapability(principal, principal.scope, 'data.manage');
    if (Buffer.byteLength(raw) > 5_242_880) throw new PolicyDenied();
    const backup = backupSchema.parse(JSON.parse(raw) as unknown);
    if (
      hash(backup) !== expectedChecksum ||
      backup.scope.organisationId !== principal.scope.organisationId ||
      backup.scope.repositoryId !== principal.scope.repositoryId
    )
      throw new PolicyDenied();
    for (const table of TABLES) {
      const data = backup.tables[table];
      if (
        hash(data.rows) !== data.checksum ||
        data.rows.some(
          (row) =>
            row.organisation_id !== principal.scope.organisationId ||
            row.repository_id !== principal.scope.repositoryId,
        )
      )
        throw new PolicyDenied();
      for (const row of data.rows)
        if (
          table === 'approval_decisions' &&
          (!Number.isFinite(Date.parse(String(row.created_at))) ||
            !Number.isFinite(Date.parse(String(row.expires_at))))
        )
          throw new PolicyDenied();
      for (const row of data.rows)
        for (const key of [
          'report',
          'snapshot',
          'asset',
          'evidence',
          'plan',
          'reference',
        ]) {
          const value = row[key];
          if (value && typeof value === 'object' && 'scope' in value) {
            const scope = ScopeSchema.parse(value.scope);
            if (
              scope.organisationId !== principal.scope.organisationId ||
              scope.repositoryId !== principal.scope.repositoryId
            )
              throw new PolicyDenied();
          }
        }
    }
    const jobId = await this.job(principal, 'restore');
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level serializable');
      for (const table of TABLES) {
        const existing = await client.query(
          `select 1 from "${table}" where organisation_id=$1 and repository_id=$2 ${table === 'data_jobs' ? 'and id<>$3' : ''} limit 1`,
          table === 'data_jobs'
            ? [
                principal.scope.organisationId,
                principal.scope.repositoryId,
                jobId,
              ]
            : [principal.scope.organisationId, principal.scope.repositoryId],
        );
        if (existing.rowCount)
          throw new Error(
            'Restore requires an empty destination scope; no rows will be overwritten.',
          );
        const columns = (
          await client.query<{ column_name: string }>(
            "select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",
            [table],
          )
        ).rows.map((row) => row.column_name);
        if (columns.some((column) => !/^[a-z_]+$/.test(column)))
          throw new PolicyDenied();
        const list = columns.map((column) => `"${column}"`).join(',');
        for (const row of backup.tables[table].rows) {
          if (
            Object.keys(row).length !== columns.length ||
            Object.keys(row).some((key) => !columns.includes(key))
          )
            throw new PolicyDenied();
          await client.query(
            `insert into "${table}" (${list}) select ${list} from jsonb_populate_record(null::"${table}",$1::jsonb)`,
            [JSON.stringify(row)],
          );
        }
      }
      await client.query(
        "update scope_controls set phase='active' where organisation_id=$1 and repository_id=$2",
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      await client.query(
        "update assessments set status='dead_letter',last_error='lease_expired',lease_token=null,lease_until=null where organisation_id=$1 and repository_id=$2 and status in ('queued','running')",
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      await client.query(
        "update action_runs set status='cancelled',token=gen_random_uuid() where organisation_id=$1 and repository_id=$2 and status='reserved'",
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      await client.query(
        'update budget_accounts set used_runner_ms=used_runner_ms+reserved_runner_ms,reserved_runner_ms=0 where organisation_id=$1 and repository_id=$2',
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      await client.query(
        `insert into approval_decisions (organisation_id,repository_id,plan_id,plan_hash,decision,actor,expires_at,created_at)
        select organisation_id,repository_id,id,plan_hash,'revoked',$3,clock_timestamp(),greatest(clock_timestamp(),coalesce((select max(created_at) from approval_decisions where organisation_id=$1 and repository_id=$2),clock_timestamp())+interval '1 microsecond') from test_plans where organisation_id=$1 and repository_id=$2`,
        [
          principal.scope.organisationId,
          principal.scope.repositoryId,
          'restore-safety',
        ],
      );
      await client.query(
        "insert into governance_events (organisation_id,repository_id,actor,action,target_id) values ($1,$2,$3,'logical_restore_completed',$4)",
        [
          principal.scope.organisationId,
          principal.scope.repositoryId,
          principal.id,
          jobId,
        ],
      );
      await client.query(
        "update data_jobs set status='failed' where organisation_id=$1 and repository_id=$2 and status='running' and id<>$3",
        [principal.scope.organisationId, principal.scope.repositoryId, jobId],
      );
      await client.query(
        "update data_jobs set status='completed',result_hash=$2 where id=$1",
        [jobId, expectedChecksum],
      );
      await client.query('commit');
      return jobId;
    } catch (error) {
      await client.query('rollback');
      await this.pool.query(
        "update data_jobs set status='failed' where id=$1",
        [jobId],
      );
      throw error;
    } finally {
      client.release();
    }
  }
  async deleteScope(
    principal: Principal,
    store: ArtifactStore,
    confirmation: string,
  ): Promise<string> {
    requireCapability(principal, principal.scope, 'data.manage');
    if (
      confirmation !==
        `${principal.scope.organisationId}:${principal.scope.repositoryId}` ||
      !store.purgeScope
    )
      throw new PolicyDenied();
    const jobId = await this.job(principal, 'delete');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const control = await client.query(
        'select id from scope_controls where organisation_id=$1 and repository_id=$2 for update',
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      if (control.rowCount !== 1) throw new PolicyDenied();
      const held = await client.query(
        'select id from artifact_refs where organisation_id=$1 and repository_id=$2 and legal_hold limit 1',
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      if (held.rowCount) throw new Error('Legal hold blocks scope deletion.');
      await client.query(
        "update scope_controls set phase='deleting' where organisation_id=$1 and repository_id=$2",
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      await client.query('commit');
      await store.purgeScope(principal.scope);
      await client.query('begin');
      for (const table of [...TABLES].reverse())
        if (table !== 'scope_controls' && table !== 'data_jobs')
          await client.query(
            `delete from "${table}" where organisation_id=$1 and repository_id=$2`,
            [principal.scope.organisationId, principal.scope.repositoryId],
          );
      await client.query(
        "update scope_controls set phase='deleted' where organisation_id=$1 and repository_id=$2",
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      await client.query(
        "update data_jobs set status='completed',result_hash=$2 where id=$1",
        [
          jobId,
          hash({
            scope: principal.scope,
            liveDataDeleted: true,
            backupPurge: 'subject to separately configured backup retention',
          }),
        ],
      );
      await client.query('commit');
      return jobId;
    } catch (error) {
      await client.query('rollback');
      await this.pool.query(
        "update data_jobs set status='failed' where id=$1",
        [jobId],
      );
      throw error;
    } finally {
      client.release();
    }
  }
}
