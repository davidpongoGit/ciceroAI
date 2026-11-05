import {
  AnalysisResultSchema,
  type ModelProvider,
  type Scope,
  type WorkflowStore,
} from '@cai/contracts';

export async function processOne(
  store: WorkflowStore,
  scope: Scope,
  provider: ModelProvider,
): Promise<boolean> {
  const lease = await store.claim(scope);
  if (!lease) return false;
  let output: unknown;
  try {
    output = await provider.analyse(lease.assessment.task);
  } catch {
    await store.fail(
      scope,
      lease,
      'provider_failed',
      Math.min(30_000, 1000 * 2 ** (lease.assessment.attempts - 1)) +
        Math.floor(Math.random() * 250),
    );
    return true;
  }
  const result = AnalysisResultSchema.safeParse(output);
  if (
    !result.success ||
    JSON.stringify(result.data.task) !== JSON.stringify(lease.assessment.task)
  ) {
    await store.fail(scope, lease, 'invalid_output');
    return true;
  }
  await store.complete(scope, lease, result.data);
  return true;
}
