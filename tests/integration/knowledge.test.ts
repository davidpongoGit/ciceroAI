import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import {
  SyntheticSourceProvider,
  type IssueSource,
  type PullRequestSource,
} from '@cai/integrations';
import { processAnalysisOne } from '../../apps/worker/src/analysis.js';
import { inventoryFile, assertionHash, criterionHash } from '@cai/coverage';

describe('M3 versioned persistent analysis with real PostgreSQL', () => {
  const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
  const scope = { organisationId: randomUUID(), repositoryId: '101' };
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
  const issue: IssueSource = {
    scope,
    key: 'DEMO-1',
    title: 'Synthetic requirement',
    text: 'AC-1: Reject expired cards.',
    version: 'v1',
    url: 'https://synthetic.atlassian.net/browse/DEMO-1',
  };
  beforeAll(async () => {
    await database.migrate();
  });
  afterAll(async () => {
    await database.close();
  });
  async function queue(headSha: string) {
    return database.workflows.intake({
      scope,
      installationId: '99',
      deliveryId: randomUUID(),
      sourceHash: 'c'.repeat(64),
      event: {
        action: 'synchronize',
        installation: { id: 99 },
        repository: { id: 101, full_name: 'synthetic/demo' },
        pull_request: {
          number: 101,
          head: { sha: headSha },
          base: { sha: 'b'.repeat(40) },
          merged: false,
        },
      },
    });
  }
  it('persists provenance, invalidates old reports on source change and hides wrong scope', async () => {
    const first = await queue(pr.headSha);
    expect(
      await processAnalysisOne(
        database,
        scope,
        new SyntheticSourceProvider(pr, [issue]),
      ),
    ).toBe(true);
    const original = await database.knowledge.getReport(scope, first.id);
    expect(original?.report.requirements[0]?.text).toBe(
      'Reject expired cards.',
    );
    expect(original?.stale).toBe(false);
    const code = `import {test,expect} from '@playwright/test';\ntest('jira:DEMO-1:AC-1', async ({page}) => { await expect(page.getByTestId('error')).toHaveText('Card expired'); });`;
    const assets = inventoryFile(
      scope,
      'tests/cards.spec.ts',
      code,
      pr.headSha,
    );
    await database.coverage.storeInventory(scope, assets);
    await database.coverage.storeInventory(scope, assets);
    expect(await database.coverage.tests(scope, pr.headSha)).toHaveLength(1);
    const asset = assets[0];
    const assertion = asset?.assertions[0];
    const criterion = original?.report.requirements[0];
    if (!asset || !assertion || !criterion)
      throw new Error('Expected persisted criterion and test.');
    await database.coverage.reviewMapping(
      scope,
      first.id,
      {
        criterionId: criterion.id,
        criterionHash: criterionHash(criterion),
        testId: asset.id,
        assertionHash: assertionHash(assertion),
        reviewedBy: 'synthetic-fixture',
      },
      pr.headSha,
      'synthetic-fixture',
    );
    const target = {
      appSha: pr.headSha,
      environment: 'synthetic-staging',
      testRevisionSha: pr.headSha,
      allowTrustedSynthetic: false,
    };
    expect(
      (await database.coverage.decisions(scope, first.id, target))?.[0]?.state,
    ).toBe('implemented_unverified');
    expect(
      await database.coverage.tests(
        { ...scope, repositoryId: '102' },
        pr.headSha,
      ),
    ).toHaveLength(0);
    const nextPr = { ...pr, headSha: 'd'.repeat(40) };
    const second = await queue(nextPr.headSha);
    expect(
      await processAnalysisOne(
        database,
        scope,
        new SyntheticSourceProvider(nextPr, [
          {
            ...issue,
            version: 'v2',
            text: 'AC-1: Reject expired and cancelled cards.',
          },
        ]),
      ),
    ).toBe(true);
    expect((await database.knowledge.getReport(scope, first.id))?.stale).toBe(
      true,
    );
    expect(
      (await database.knowledge.getReport(scope, second.id))?.report
        .requirements[0]?.sources[0]?.version,
    ).toBe('v2');
    expect(
      await database.knowledge.getReport(
        { ...scope, organisationId: randomUUID() },
        second.id,
      ),
    ).toBeNull();
    expect((await database.workflows.get(scope, second.id))?.status).toBe(
      'completed',
    );
  });
});
