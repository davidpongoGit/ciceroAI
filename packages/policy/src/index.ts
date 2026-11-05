import { createHash } from 'node:crypto';
import {
  PrincipalSchema,
  TestPlanSchema,
  type Capability,
  type Principal,
  type Readiness,
  type Scope,
  type TestPlan,
} from '@cai/contracts';

export class PolicyDenied extends Error {
  constructor() {
    super('Action denied by scoped approval policy.');
  }
}
export function requireCapability(
  principal: Principal,
  scope: Scope,
  capability: Capability,
): void {
  PrincipalSchema.parse(principal);
  if (
    principal.scope.organisationId !== scope.organisationId ||
    principal.scope.repositoryId !== scope.repositoryId ||
    !principal.capabilities.includes(capability)
  )
    throw new PolicyDenied();
}
export function planHash(input: TestPlan): string {
  return createHash('sha256')
    .update(JSON.stringify(TestPlanSchema.parse(input)))
    .digest('hex');
}
export function requireReadiness(
  plan: TestPlan,
  readiness: Readiness | null,
): void {
  TestPlanSchema.parse(plan);
  if (plan.operation !== 'draft' && !plan.draftHash) throw new PolicyDenied();
  if (
    !readiness ||
    (plan.level === 'e2e'
      ? !readiness.eligibleForPlan
      : readiness.code !== 'ready')
  )
    throw new PolicyDenied();
}
