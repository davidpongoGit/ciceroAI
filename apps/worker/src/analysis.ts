import { MockModelProvider, type Scope } from '@cai/contracts';
import { createDatabase } from '@cai/database';
import { collectAndAnalyse } from '@cai/intelligence';
import type { SourceProvider } from '@cai/integrations';

export async function processAnalysisOne(
  database: ReturnType<typeof createDatabase>,
  scope: Scope,
  provider: SourceProvider,
): Promise<boolean> {
  const lease = await database.workflows.claim(scope);
  if (!lease) return false;
  try {
    const number = /^github:pr:([1-9][0-9]*)$/.exec(
      lease.assessment.task.source.id,
    )?.[1];
    if (!number) throw new Error('Unsupported source identity.');
    const analysis = await collectAndAnalyse(
      provider,
      scope,
      Number(number),
      lease.assessment.headSha,
    );
    const modelResult = await new MockModelProvider().analyse(
      lease.assessment.task,
    );
    await database.knowledge.completeAnalysis(
      scope,
      lease,
      analysis,
      modelResult,
    );
  } catch (error) {
    const retryAfter: unknown =
      error instanceof Error && 'retryAfterMs' in error
        ? error.retryAfterMs
        : 1000;
    if (typeof retryAfter === 'number' && retryAfter > 86_400_000) {
      await database.workflows.fail(scope, lease, 'retry_exceeds_policy', 0);
      return true;
    }
    await database.workflows.fail(
      scope,
      lease,
      'provider_failed',
      typeof retryAfter === 'number'
        ? Math.min(86_400_000, Math.max(1000, retryAfter))
        : 1000,
    );
  }
  return true;
}
