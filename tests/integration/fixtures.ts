import { randomUUID } from 'node:crypto';
import { type Principal } from '@cai/contracts';
import { createDatabase } from '@cai/database';
import {
  SyntheticSourceProvider,
  type PullRequestSource,
} from '@cai/integrations';
import { processAnalysisOne } from '../../apps/worker/src/analysis.js';

export async function seedReadyAssessment(
  database: ReturnType<typeof createDatabase>,
  headSha = 'a'.repeat(40),
) {
  const scope = { organisationId: randomUUID(), repositoryId: '101' };
  const pr: PullRequestSource = {
    scope,
    number: 101,
    headSha,
    baseSha: 'b'.repeat(40),
    title: 'DEMO-1 checkout',
    body: '',
    url: 'https://github.com/synthetic/demo/pull/101',
    files: [],
  };
  const queued = await database.workflows.intake({
    scope,
    installationId: '99',
    deliveryId: randomUUID(),
    sourceHash: 'c'.repeat(64),
    event: {
      action: 'opened',
      installation: { id: 99 },
      repository: { id: 101, full_name: 'synthetic/demo' },
      pull_request: {
        number: 101,
        head: { sha: pr.headSha },
        base: { sha: pr.baseSha },
        merged: false,
      },
    },
  });
  await processAnalysisOne(
    database,
    scope,
    new SyntheticSourceProvider(pr, [
      {
        scope,
        key: 'DEMO-1',
        version: 'v1',
        title: 'Synthetic cards',
        text: 'AC-1: Reject expired cards.',
        url: 'https://synthetic.atlassian.net/browse/DEMO-1',
      },
    ]),
  );
  const report = await database.knowledge.getReport(scope, queued.id);
  const source = report?.report.sourceReferences.find(
    (ref) => ref.sourceKey === 'jira:DEMO-1',
  );
  if (!source || !report) throw new Error('Expected fixture report.');
  const featureId = await database.graph.configureFeature(
    scope,
    'checkout',
    pr.headSha,
    true,
  );
  for (const [key, kind] of [
    ['card_validation', 'code'],
    ['staging', 'deployment'],
    ['checkout_flag', 'flag'],
    ['synthetic_cards', 'data'],
  ] as const) {
    await database.graph.reviseDependency(
      scope,
      featureId,
      {
        key,
        kind,
        status: 'satisfied',
        certainty: 'confirmed',
        explanation: 'Synthetic reviewed fixture state.',
        source,
        buildSha: kind === 'deployment' ? pr.headSha : null,
      },
      'synthetic-fixture',
    );
  }
  const principal: Principal = {
    id: 'synthetic-operator',
    scope,
    capabilities: [
      'assessment.read',
      'plan.create',
      'plan.approve',
      'plan.revoke',
      'draft',
      'execute',
      'create_pr',
      'data.manage',
    ],
  };
  return {
    scope,
    principal,
    pr,
    assessmentId: queued.id,
    featureId,
    report: report.report,
  };
}
