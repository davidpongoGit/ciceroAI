import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Principal, TestPlan } from '@cai/contracts';
import { PolicyDenied, planHash, requireCapability } from '@cai/policy';
import type { PostgresPlanStore } from './plans.js';

export interface ActionReservation {
  id: string;
  token: string;
  reservedMs: number;
}
export class PostgresActionStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly plans: PostgresPlanStore,
  ) {}
  async configureBudget(
    principal: Principal,
    maxRunnerMs: number,
  ): Promise<void> {
    requireCapability(principal, principal.scope, 'data.manage');
    if (
      !Number.isInteger(maxRunnerMs) ||
      maxRunnerMs < 0 ||
      maxRunnerMs > 3_600_000
    )
      throw new PolicyDenied();
    await this.pool.query(
      `insert into budget_accounts (organisation_id,repository_id,period,max_runner_ms) values ($1,$2,to_char(clock_timestamp() at time zone 'UTC','YYYY-MM'),$3) on conflict (organisation_id,repository_id,period) do update set max_runner_ms=$3`,
      [
        principal.scope.organisationId,
        principal.scope.repositoryId,
        maxRunnerMs,
      ],
    );
  }
  async reserve(
    principal: Principal,
    plan: TestPlan,
  ): Promise<ActionReservation> {
    const approved = await this.plans.authorize(principal, plan.id, {
      appSha: plan.appSha,
      testRevisionSha: plan.testRevisionSha,
      draftHash: plan.draftHash,
    });
    if (planHash(approved) !== planHash(plan)) throw new PolicyDenied();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into budget_accounts (organisation_id,repository_id,period) values ($1,$2,to_char(clock_timestamp() at time zone 'UTC','YYYY-MM')) on conflict do nothing`,
        [principal.scope.organisationId, principal.scope.repositoryId],
      );
      const account = (
        await client.query<{
          period: string;
          max_runner_ms: number;
          used_runner_ms: number;
          reserved_runner_ms: number;
        }>(
          `select * from budget_accounts where organisation_id=$1 and repository_id=$2 and period=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM') for update`,
          [principal.scope.organisationId, principal.scope.repositoryId],
        )
      ).rows[0];
      const reservedMs =
        plan.operation === 'execute'
          ? plan.budget.maxRunnerSeconds * 1000
          : 1000;
      if (
        !account ||
        account.used_runner_ms + account.reserved_runner_ms + reservedMs >
          account.max_runner_ms
      )
        throw new PolicyDenied();
      const token = randomUUID();
      const row = (
        await client.query<{ id: string }>(
          `insert into action_runs (organisation_id,repository_id,plan_id,period,token,reserved_ms,lease_until) values ($1,$2,$3,$4,$5,$6,clock_timestamp()+(($6::int+10000)*interval '1 millisecond')) on conflict (plan_id) do nothing returning id`,
          [
            principal.scope.organisationId,
            principal.scope.repositoryId,
            plan.id,
            account.period,
            token,
            reservedMs,
          ],
        )
      ).rows[0];
      if (!row) throw new PolicyDenied();
      await client.query(
        'update budget_accounts set reserved_runner_ms=reserved_runner_ms+$4 where organisation_id=$1 and repository_id=$2 and period=$3',
        [
          principal.scope.organisationId,
          principal.scope.repositoryId,
          account.period,
          reservedMs,
        ],
      );
      await client.query(
        "insert into governance_events (organisation_id,repository_id,actor,action,target_id) values ($1,$2,$3,'action_reserved',$4)",
        [
          principal.scope.organisationId,
          principal.scope.repositoryId,
          principal.id,
          row.id,
        ],
      );
      await client.query('commit');
      return { id: row.id, token, reservedMs };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  async settle(
    principal: Principal,
    reservation: ActionReservation,
    actualMs: number,
    outcome: 'completed' | 'failed',
  ): Promise<boolean> {
    requireCapability(principal, principal.scope, 'assessment.read');
    if (!Number.isInteger(actualMs) || actualMs < 0 || actualMs > 120000)
      throw new PolicyDenied();
    const result = await this.pool.query(
      `with finished as (
      update action_runs set status=$5,actual_ms=$4 where organisation_id=$1 and repository_id=$2 and id=$3 and token=$6 and status='reserved' and lease_until>clock_timestamp() returning *
    ), metered as (update budget_accounts b set reserved_runner_ms=reserved_runner_ms-f.reserved_ms,used_runner_ms=used_runner_ms+$4 from finished f where b.organisation_id=f.organisation_id and b.repository_id=f.repository_id and b.period=f.period)
    insert into governance_events (organisation_id,repository_id,actor,action,target_id) select $1,$2,$7,$5,id::text from finished returning id`,
      [
        principal.scope.organisationId,
        principal.scope.repositoryId,
        reservation.id,
        actualMs,
        outcome,
        reservation.token,
        principal.id,
      ],
    );
    return result.rowCount === 1;
  }
  async recover(principal: Principal): Promise<number> {
    requireCapability(principal, principal.scope, 'data.manage');
    const result = await this.pool.query(
      `with expired as (
      update action_runs set status='cancelled',actual_ms=reserved_ms where organisation_id=$1 and repository_id=$2 and status='reserved' and lease_until<clock_timestamp() returning *
    ), totals as (select period,sum(reserved_ms)::int as reserved from expired group by period), charged as (
      update budget_accounts b set reserved_runner_ms=reserved_runner_ms-t.reserved,used_runner_ms=used_runner_ms+t.reserved from totals t where b.organisation_id=$1 and b.repository_id=$2 and b.period=t.period
    ) insert into governance_events (organisation_id,repository_id,actor,action,target_id) select $1,$2,$3,'abandoned_action_charged',id::text from expired returning id`,
      [
        principal.scope.organisationId,
        principal.scope.repositoryId,
        principal.id,
      ],
    );
    return result.rowCount ?? 0;
  }
  async usage(principal: Principal) {
    requireCapability(principal, principal.scope, 'assessment.read');
    return (
      await this.pool.query<{
        period: string;
        max_runner_ms: number;
        used_runner_ms: number;
        reserved_runner_ms: number;
      }>(
        'select period,max_runner_ms,used_runner_ms,reserved_runner_ms from budget_accounts where organisation_id=$1 and repository_id=$2 order by period desc limit 12',
        [principal.scope.organisationId, principal.scope.repositoryId],
      )
    ).rows;
  }
}
