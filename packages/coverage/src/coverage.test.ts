import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  AssertionMapping,
  ChangeAssessment,
  RunEvidence,
} from '@cai/contracts';
import {
  assessCoverage,
  assertionHash,
  criterionHash,
  discoverPlaywright,
  inventoryFile,
} from './index.js';

const scope = {
  organisationId: '134da1cb-a441-4325-9e17-e2c93eb12bbc',
  repositoryId: '101',
};
const sha = 'a'.repeat(40);
const criterion: ChangeAssessment['requirements'][number] = {
  id: 'jira:DEMO-1:AC-1',
  text: 'Reject transfers above the daily limit.',
  status: 'explicit',
  sources: [
    { sourceKey: 'jira:DEMO-1', version: 'v1', contentHash: 'b'.repeat(64) },
  ],
};
const correctCode = `import { test, expect } from '@playwright/test';
test('jira:DEMO-1:AC-1 daily limit', async ({ page }) => {
  await page.getByTestId('amount').fill('501');
  await page.getByRole('button', {name: 'Transfer'}).click();
  await expect(page.getByTestId('error')).toHaveText('Daily limit exceeded');
});`;
const target = {
  scope,
  appSha: sha,
  environment: 'synthetic-staging',
  testRevisionSha: sha,
  allowTrustedSynthetic: false,
};
async function cleanupInventory(root: string, parent: string): Promise<void> {
  const resolved = await realpath(root);
  if (
    path.dirname(resolved) !== parent ||
    !path.basename(resolved).startsWith('cai-inventory-')
  )
    throw new Error('Temporary cleanup target escaped its parent.');
  await rm(resolved, { recursive: true, force: true });
}
function fixtures() {
  const test = inventoryFile(scope, 'tests/limit.spec.ts', correctCode, sha)[0];
  const assertion = test?.assertions[0];
  if (!test || !assertion) throw new Error('Expected test and assertion.');
  const mapping: AssertionMapping = {
    criterionId: criterion.id,
    criterionHash: criterionHash(criterion),
    testId: test.id,
    assertionHash: assertionHash(assertion),
    reviewedBy: 'synthetic-fixture',
  };
  const evidence: RunEvidence = {
    id: randomUUID(),
    scope,
    testId: test.id,
    fileHash: test.fileHash,
    testRevisionSha: sha,
    appSha: sha,
    environment: target.environment,
    criterionHash: mapping.criterionHash,
    assertionHashes: [mapping.assertionHash],
    outcome: 'passed',
    origin: 'isolated-runner',
    finishedAt: '2026-11-05T00:00:00.000Z',
  };
  return { test, mapping, evidence };
}
describe('M5 AST inventory and evidence decisions (synthetic evidence fixtures)', () => {
  it('records exact matcher, target and expected value without executing source', () => {
    const { test } = fixtures();
    expect(test.assertions[0]).toMatchObject({
      target: "page.getByTestId('error')",
      matcher: 'toHaveText',
      expected: 'Daily limit exceeded',
      supported: true,
    });
    expect(() =>
      inventoryFile(scope, '../escape.spec.ts', correctCode, sha),
    ).toThrow('Unsupported test path');
    const dangerous = `throw new Error('Never execute me');\n${correctCode}`;
    expect(
      inventoryFile(scope, 'tests/untrusted.spec.ts', dangerous, sha),
    ).toHaveLength(1);
  });
  it('never turns a £500 success assertion into daily-limit verification', () => {
    const { mapping, evidence } = fixtures();
    const misleading = inventoryFile(
      scope,
      'tests/limit.spec.ts',
      correctCode
        .replace("page.getByTestId('error')", "page.getByTestId('balance')")
        .replace('Daily limit exceeded', '500'),
      sha,
    );
    expect(
      assessCoverage(criterion, misleading, null, null, target).state,
    ).toBe('candidate');
    expect(
      assessCoverage(criterion, misleading, mapping, evidence, target),
    ).toMatchObject({ state: 'candidate', action: 'update' });
  });
  it('selects create/update/reuse and requires exact version/environment execution evidence', () => {
    const { test, mapping, evidence } = fixtures();
    expect(assessCoverage(criterion, [], null, null, target)).toMatchObject({
      state: 'gap',
      action: 'create',
    });
    expect(
      assessCoverage(criterion, [test], mapping, null, target),
    ).toMatchObject({ state: 'implemented_unverified', action: 'reuse' });
    expect(
      assessCoverage(criterion, [test], mapping, evidence, target).state,
    ).toBe('verified');
    expect(
      assessCoverage(
        criterion,
        [test],
        mapping,
        { ...evidence, appSha: 'c'.repeat(40) },
        target,
      ).state,
    ).toBe('stale');
    expect(
      assessCoverage(
        criterion,
        [test],
        mapping,
        { ...evidence, environment: 'different' },
        target,
      ).state,
    ).toBe('stale');
    expect(
      assessCoverage(
        criterion,
        [test],
        mapping,
        { ...evidence, outcome: 'failed' },
        target,
      ).state,
    ).toBe('failed');
    expect(
      assessCoverage(
        criterion,
        [test],
        mapping,
        { ...evidence, origin: 'trusted-synthetic' },
        target,
      ).state,
    ).toBe('unknown');
    expect(
      assessCoverage(
        { ...criterion, status: 'conflicted' },
        [test],
        mapping,
        evidence,
        target,
      ).state,
    ).toBe('unknown');
  });
  it('does not support skipped, constant-only or unawaited web assertions', () => {
    const skipped = inventoryFile(
      scope,
      'tests/skip.spec.ts',
      correctCode.replace("test('jira", "test.skip('jira"),
      sha,
    )[0];
    expect(skipped?.skipped).toBe(true);
    const constant = inventoryFile(
      scope,
      'tests/noop.spec.ts',
      correctCode.replace("page.getByTestId('error')", 'true'),
      sha,
    )[0];
    expect(constant?.assertions[0]?.supported).toBe(false);
    const unawaited = inventoryFile(
      scope,
      'tests/unawaited.spec.ts',
      correctCode.replace('await expect', 'expect'),
      sha,
    )[0];
    expect(unawaited?.assertions[0]?.supported).toBe(false);
  });
  it('discovers config as inert text and reports bounded supported test inventory', async () => {
    const parent = await realpath(tmpdir());
    const root = await mkdtemp(path.join(parent, 'cai-inventory-'));
    try {
      await writeFile(
        path.join(root, 'playwright.config.ts'),
        "throw new Error('Do not execute config');",
      );
      await writeFile(path.join(root, 'limit.spec.ts'), correctCode);
      const result = await discoverPlaywright(root, scope, sha);
      expect(result.configs).toEqual(['playwright.config.ts']);
      expect(result.tests).toHaveLength(1);
    } finally {
      await cleanupInventory(root, parent);
    }
  });
});
