import { z } from 'zod';
import { SourceReferenceSchema } from './knowledge.js';
import { ShaSchema } from './workflow.js';

export const DependencySchema = z.strictObject({
  key: z.string().regex(/^[a-zA-Z0-9:_-]{1,200}$/),
  kind: z.enum(['code', 'deployment', 'flag', 'data']),
  status: z.enum(['unknown', 'pending', 'satisfied', 'failed']),
  certainty: z.enum(['confirmed', 'inferred', 'contested', 'rejected']),
  explanation: z.string().min(1).max(1000),
  source: SourceReferenceSchema,
  buildSha: ShaSchema.nullable(),
});
export type Dependency = z.infer<typeof DependencySchema>;
export type ReadinessState = 'ready' | 'blocked' | 'unknown';
export interface Readiness {
  code: ReadinessState;
  feature: ReadinessState;
  environment: ReadinessState;
  data: ReadinessState;
  approval: ReadinessState;
  eligibleForPlan: boolean;
  blockers: string[];
}
export function evaluateReadiness(
  headSha: string,
  knownComplete: boolean,
  inputs: (Dependency & { valid: boolean })[],
): Readiness {
  ShaSchema.parse(headSha);
  const blockers: string[] = [];
  function dimension(kinds: Dependency['kind'][]): ReadinessState {
    const items = inputs.filter((item) => kinds.includes(item.kind));
    if (!items.length) return 'unknown';
    let state: ReadinessState = 'ready';
    for (const item of items) {
      const { valid, ...dependency } = item;
      DependencySchema.parse(dependency);
      if (
        !valid ||
        item.certainty !== 'confirmed' ||
        item.status === 'unknown'
      ) {
        blockers.push(`${item.key}: unknown, unconfirmed or stale dependency.`);
        state = 'unknown';
      } else if (
        item.status !== 'satisfied' ||
        (item.kind === 'deployment' && item.buildSha !== headSha)
      ) {
        blockers.push(
          `${item.key}: prerequisite or exact deployment build is not satisfied.`,
        );
        if (state !== 'unknown') state = 'blocked';
      }
    }
    return state;
  }
  const code = dimension(['code']);
  const environment = dimension(['deployment', 'flag']);
  const data = dimension(['data']);
  if (
    !inputs.some((item) => item.kind === 'deployment') ||
    !inputs.some((item) => item.kind === 'flag')
  )
    blockers.push('Deployment or feature-flag state is unknown.');
  const environmentReady =
    inputs.some((item) => item.kind === 'deployment') &&
    inputs.some((item) => item.kind === 'flag')
      ? environment
      : 'unknown';
  if (!knownComplete)
    blockers.push('The dependency inventory is not confirmed complete.');
  if (!inputs.some((item) => item.kind === 'code'))
    blockers.push('Code readiness is unknown.');
  if (!inputs.some((item) => item.kind === 'data'))
    blockers.push('Test data readiness is unknown.');
  const feature = knownComplete ? code : 'unknown';
  return {
    code,
    feature,
    environment: environmentReady,
    data,
    approval: 'blocked',
    eligibleForPlan:
      feature === 'ready' && environmentReady === 'ready' && data === 'ready',
    blockers,
  };
}
