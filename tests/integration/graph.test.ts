import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import { type Dependency, type SourceReference } from '@cai/contracts';
import {
  SyntheticSourceProvider,
  type PullRequestSource,
} from '@cai/integrations';
import { processAnalysisOne } from '../../apps/worker/src/analysis.js';

describe('M4 persistent reviewed graph and source revocation', () => {
  const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
  const scope = { organisationId: randomUUID(), repositoryId: '101' };
  beforeAll(async () => {
    await database.migrate();
  });
  afterAll(async () => {
    await database.close();
  });
  it('preserves dependency revisions, blocks wrong-scope references and invalidates affected readiness only', async () => {
    const pr: PullRequestSource = {
      scope,
      number: 101,
      headSha: 'a'.repeat(40),
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
          title: 'Synthetic',
          text: 'AC-1: Reject expired cards.',
          url: 'https://synthetic.atlassian.net/browse/DEMO-1',
        },
      ]),
    );
    const source: SourceReference | undefined = (
      await database.knowledge.getReport(scope, queued.id)
    )?.report.sourceReferences.find((s) => s.sourceKey === 'jira:DEMO-1');
    if (!source) throw new Error('Expected persisted source.');
    const feature = await database.graph.configureFeature(
      scope,
      'checkout',
      pr.headSha,
      true,
    );
    const unrelated = await database.graph.configureFeature(
      scope,
      'unrelated',
      pr.headSha,
      false,
    );
    for (const [key, kind] of [
      ['pr101', 'code'],
      ['pr102', 'code'],
      ['pr103', 'code'],
      ['staging', 'deployment'],
      ['flag', 'flag'],
      ['test_data', 'data'],
    ] as const) {
      const dependency: Dependency = {
        key,
        kind,
        status: key === 'pr103' ? 'pending' : 'satisfied',
        certainty: 'confirmed',
        explanation: 'Synthetic fixture reviewed input.',
        source,
        buildSha: kind === 'deployment' ? pr.headSha : null,
      };
      await database.graph.reviseDependency(
        scope,
        feature,
        dependency,
        'synthetic-fixture',
      );
      if (key === 'pr103') {
        expect(
          (await database.graph.readiness(scope, feature))?.eligibleForPlan,
        ).toBe(false);
        await database.graph.reviseDependency(
          scope,
          feature,
          { ...dependency, status: 'satisfied' },
          'human-review',
        );
      }
    }
    expect(
      (await database.graph.readiness(scope, feature))?.eligibleForPlan,
    ).toBe(true);
    expect(
      await database.graph.readiness(
        { ...scope, repositoryId: '102' },
        feature,
      ),
    ).toBeNull();
    const affected = await database.graph.revokeSource(scope, source.sourceKey);
    expect(affected).toEqual([feature]);
    expect(affected).not.toContain(unrelated);
    expect((await database.graph.readiness(scope, feature))?.code).toBe(
      'unknown',
    );
    expect(await database.knowledge.getReport(scope, queued.id)).toBeNull();
  });
});
