import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import { buildApp } from '@cai/api';
import type { TestPlan } from '@cai/contracts';
import { seedReadyAssessment } from '../integration/fixtures.js';

describe('M6/M8 real browser dashboard and approval controls', () => {
  const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
  beforeAll(async () => {
    await database.migrate();
  });
  afterAll(async () => {
    await database.close();
  });
  it('loads authorised records, shows current limits and records approval/revocation from the UI', async () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(
      'runtime-data/browsers',
    );
    const { chromium, expect: browserExpect } =
      await import('@playwright/test');
    const fixture = await seedReadyAssessment(database);
    const token = 'synthetic-dashboard-token-32-characters';
    const plan: TestPlan = {
      id: randomUUID(),
      scope: fixture.scope,
      assessmentId: fixture.assessmentId,
      featureId: fixture.featureId,
      operation: 'create_pr',
      strategy: 'create',
      level: 'e2e',
      appSha: fixture.pr.headSha,
      testRevisionSha: fixture.pr.headSha,
      environment: 'synthetic-checkout',
      criterionIds: [fixture.report.requirements[0]?.id ?? ''],
      draftHash: 'c'.repeat(64),
      budget: { maxRunnerSeconds: 30, maxArtifactBytes: 1000 },
      policyVersion: 'supervised-v1',
      publication: {
        provider: 'github',
        repositoryId: '202',
        repository: 'synthetic/playwright',
        baseBranch: 'main',
        baseSha: 'd'.repeat(40),
        path: 'tests/expired-card.spec.ts',
      },
    };
    await database.plans.create(fixture.principal, plan);
    const app = buildApp({
      workflow: {
        scope: fixture.scope,
        installationId: '99',
        apiToken: token,
        webhookSecret: 'synthetic-dashboard-independent-secret-32',
        store: database.workflows,
      },
      admin: { database, principal: fixture.principal, apiToken: token },
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        errors.push(error.message);
      });
      await page.goto(address);
      await page.getByLabel('Scoped operator token').fill('wrong-token');
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await browserExpect(page.locator('#message')).toHaveText(
        'Authentication required.',
      );
      await page.getByLabel('Scoped operator token').fill(token);
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await browserExpect(page.locator('#message')).toContainText(
        'Loaded records for repository',
      );
      expect(await page.locator('#reports tr').count()).toBe(1);
      expect(await page.locator('#metrics').textContent()).toContain(
        'not measured',
      );
      await browserExpect(page.locator('#plans')).toContainText(
        'Automation destination: synthetic/playwright (ID 202)',
      );
      await browserExpect(page.locator('#plans')).toContainText(
        'Approval permits the exact proposal; it does not publish or merge.',
      );
      await page.getByRole('button', { name: 'Inspect', exact: true }).click();
      await browserExpect(page.locator('#detail')).toBeVisible();
      expect(await page.locator('#detail').textContent()).toContain(
        'Reject expired cards.',
      );
      await page.getByRole('button', { name: 'Approve for 5 minutes' }).click();
      await browserExpect(page.locator('.badge')).toHaveText('approved');
      await page.getByRole('button', { name: 'Revoke', exact: true }).click();
      await browserExpect(page.locator('.badge')).toHaveText('revoked');
      expect(
        (await database.plans.get(fixture.principal, plan.id))?.approval.status,
      ).toBe('revoked');
      expect(errors).toEqual([]);
      await mkdir('artifacts', { recursive: true });
      await page.screenshot({
        path: 'artifacts/dashboard.png',
        fullPage: true,
      });
    } finally {
      await browser.close();
      await app.close();
    }
  });
  it('keeps completed analysis separate from code/environment readiness and a synthetic recorded pass', async () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(
      'runtime-data/browsers',
    );
    const { chromium, expect: browserExpect } =
      await import('@playwright/test');
    const fixture = await seedReadyAssessment(database);
    const source = fixture.report.sourceReferences.find(
      (item) => item.sourceKey === 'jira:DEMO-1',
    );
    if (!source) throw new Error('Expected requirement provenance.');
    const revise = async (
      key: string,
      kind: 'code' | 'deployment' | 'flag',
      status: 'pending' | 'satisfied',
    ) =>
      database.graph.reviseDependency(
        fixture.scope,
        fixture.featureId,
        {
          key,
          kind,
          status,
          certainty: 'confirmed',
          source,
          buildSha: kind === 'deployment' ? fixture.pr.headSha : null,
          explanation: 'Synthetic readiness display regression.',
        },
        'synthetic-fixture',
      );
    await revise('pr102', 'code', 'pending');
    await revise('pr103', 'code', 'pending');
    await revise('staging', 'deployment', 'pending');
    await revise('checkout_flag', 'flag', 'pending');
    const token = 'synthetic-readiness-display-token-32-characters';
    const app = buildApp({
      workflow: {
        scope: fixture.scope,
        installationId: '99',
        apiToken: token,
        webhookSecret: 'synthetic-readiness-independent-secret-32',
        store: database.workflows,
      },
      admin: { database, principal: fixture.principal, apiToken: token },
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(address);
      await page.getByLabel('Scoped operator token').fill(token);
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      const detail = page.locator('#detail');
      await browserExpect(detail).toContainText(
        'Analysis complete (assessment_ready).',
      );
      await browserExpect(detail).toContainText(
        'Not ready: code dependencies are incomplete.',
      );
      await browserExpect(detail).toContainText('pr102: prerequisite');
      await browserExpect(detail).toContainText('pr103: prerequisite');
      await browserExpect(detail).toContainText(
        'Execution evidence unavailable',
      );
      await browserExpect(detail).toContainText(
        'Not measured. A recorded pass is separate',
      );
      await browserExpect(detail).toContainText(fixture.pr.headSha);

      const refresh = async () => {
        await page
          .getByRole('button', { name: 'Refresh evidence', exact: true })
          .click();
        await browserExpect(detail).toBeVisible();
      };
      await revise('pr102', 'code', 'satisfied');
      await refresh();
      await browserExpect(
        detail.locator('.feature-evidence > strong'),
      ).toHaveText('Not ready: code dependencies are incomplete.');
      await revise('pr103', 'code', 'satisfied');
      await refresh();
      await browserExpect(
        detail.locator('.feature-evidence > strong'),
      ).toHaveText('Not ready: environment prerequisites are blocked.');
      await browserExpect(detail).toContainText(
        'Analysis complete (assessment_ready).',
      );
      await browserExpect(detail).toContainText('checkout_flag: prerequisite');
      await revise('staging', 'deployment', 'satisfied');
      await revise('checkout_flag', 'flag', 'satisfied');
      // A seeded result checks display semantics only. synthetic.test.ts executes
      // the real owned browser fixture, including its negative control.
      await database.coverage.recordEvidence(
        fixture.scope,
        fixture.assessmentId,
        {
          id: randomUUID(),
          scope: fixture.scope,
          testId: 'synthetic-display-fixture',
          fileHash: 'c'.repeat(64),
          testRevisionSha: 'd'.repeat(40),
          appSha: fixture.pr.headSha,
          environment: 'synthetic-checkout',
          criterionHash: 'e'.repeat(64),
          assertionHashes: ['f'.repeat(64)],
          outcome: 'passed',
          origin: 'trusted-synthetic',
          finishedAt: new Date().toISOString(),
        },
      );
      await refresh();
      await browserExpect(
        detail.locator('.feature-evidence > strong'),
      ).toHaveText('Ready for automated Playwright E2E testing');
      await browserExpect(detail).toContainText(
        'Passed (synthetic; repository-owned fixture)',
      );
      await browserExpect(detail).toContainText(
        'Not measured. A recorded pass is separate',
      );
      await browserExpect(detail).toContainText(
        'A separately approved plan and configured runner are required.',
      );
      await detail
        .getByText('Prerequisite history (reconstructed)', { exact: true })
        .click();
      await browserExpect(detail.locator('.readiness-history')).toContainText(
        'Not ready: environment prerequisites are blocked.',
      );
      await browserExpect(detail.locator('.readiness-history')).toContainText(
        'Historical target/inventory decisions were not snapshotted.',
      );
      await database.graph.configureFeature(
        fixture.scope,
        'checkout',
        'b'.repeat(40),
        true,
      );
      await refresh();
      await browserExpect(
        detail.locator('.feature-evidence > strong'),
      ).toHaveText(
        'Readiness unknown for this assessed revision: the feature now targets another build.',
      );
      await page.route('**/api/features/*/readiness', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Synthetic readiness outage.' }),
        }),
      );
      await refresh();
      await browserExpect(
        detail.locator('.feature-evidence > strong'),
      ).toHaveText('Readiness unknown: prerequisite evidence is unavailable.');
      expect(errors).toEqual([]);
      await mkdir('artifacts', { recursive: true });
      await page.screenshot({
        path: 'artifacts/readiness-regression.png',
        fullPage: true,
      });
    } finally {
      await browser.close();
      await app.close();
    }
  });
});
