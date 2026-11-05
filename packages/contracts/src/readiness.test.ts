import { describe, expect, it } from 'vitest';
import { evaluateReadiness, type Dependency } from './readiness.js';

const head = 'a'.repeat(40);
const source = {
  sourceKey: 'jira:DEMO-1',
  version: 'v1',
  contentHash: 'b'.repeat(64),
};
function dependency(
  key: string,
  kind: Dependency['kind'],
  status: Dependency['status'] = 'satisfied',
): Dependency & { valid: boolean } {
  return {
    key,
    kind,
    status,
    certainty: 'confirmed',
    explanation: 'Synthetic reviewed source.',
    source,
    buildSha: kind === 'deployment' ? head : null,
    valid: true,
  };
}
describe('M4 independent readiness dimensions', () => {
  it('keeps a three-PR feature blocked until code, deployment, flag and data prerequisites are met', () => {
    const items = [
      dependency('pr101', 'code'),
      dependency('pr102', 'code', 'pending'),
      dependency('pr103', 'code', 'pending'),
      dependency('staging', 'deployment', 'pending'),
      dependency('checkout_flag', 'flag', 'pending'),
      dependency('synthetic_cards', 'data'),
    ];
    expect(evaluateReadiness(head, true, items).eligibleForPlan).toBe(false);
    items[1] = dependency('pr102', 'code');
    items[2] = dependency('pr103', 'code');
    expect(evaluateReadiness(head, true, items).code).toBe('ready');
    expect(evaluateReadiness(head, true, items).environment).toBe('blocked');
    items[3] = dependency('staging', 'deployment');
    items[4] = dependency('checkout_flag', 'flag');
    expect(evaluateReadiness(head, true, items)).toMatchObject({
      eligibleForPlan: true,
      approval: 'blocked',
    });
  });
  it('never satisfies inferred, contested, stale, wrong-build or unknown future dependencies', () => {
    const items = [
      dependency('pr101', 'code'),
      dependency('staging', 'deployment'),
      dependency('flag', 'flag'),
      dependency('data', 'data'),
    ];
    expect(evaluateReadiness(head, false, items).feature).toBe('unknown');
    expect(evaluateReadiness('c'.repeat(40), true, items).environment).toBe(
      'blocked',
    );
    expect(
      evaluateReadiness(head, true, [
        { ...dependency('pr101', 'code'), valid: false },
        ...items.slice(1),
      ]).code,
    ).toBe('unknown');
    expect(
      evaluateReadiness(head, true, [
        { ...dependency('pr101', 'code'), certainty: 'inferred' },
        ...items.slice(1),
      ]).code,
    ).toBe('unknown');
    expect(evaluateReadiness(head, true, []).eligibleForPlan).toBe(false);
  });
});
