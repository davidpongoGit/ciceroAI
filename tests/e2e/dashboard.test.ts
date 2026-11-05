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
      operation: 'draft',
      strategy: 'create',
      level: 'e2e',
      appSha: fixture.pr.headSha,
      testRevisionSha: fixture.pr.headSha,
      environment: 'synthetic-checkout',
      criterionIds: [fixture.report.requirements[0]?.id ?? ''],
      draftHash: null,
      budget: { maxRunnerSeconds: 30, maxArtifactBytes: 1000 },
      policyVersion: 'supervised-v1',
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
});
