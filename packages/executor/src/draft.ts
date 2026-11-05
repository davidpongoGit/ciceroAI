import { createHash } from 'node:crypto';
import {
  TestPlanSchema,
  type ChangeAssessment,
  type TestPlan,
} from '@cai/contracts';
export interface TestDraft {
  path: string;
  content: string;
  hash: string;
  branch: string;
  provenance: string[];
}
export function draftExpiredCardTest(
  plan: TestPlan,
  criterion: ChangeAssessment['requirements'][number],
): TestDraft {
  TestPlanSchema.parse(plan);
  if (
    !plan.criterionIds.includes(criterion.id) ||
    criterion.status !== 'explicit' ||
    criterion.text !== 'Reject expired cards.'
  )
    throw new Error(
      'No reviewed deterministic draft template exists for this criterion.',
    );
  const content = `import { test, expect } from '@playwright/test';\n\n// Synthetic fixture; source references are recorded in the review manifest.\ntest(${JSON.stringify(criterion.id + ' rejects an expired card')}, async ({ page }) => {\n  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());\n  await page.goto('/');\n  await page.getByLabel('Card expiry').fill('01/20');\n  await page.getByRole('button', { name: 'Pay' }).click();\n  await expect(page.getByTestId('card-error')).toHaveText('Card expired');\n});\n`;
  return {
    path: 'tests/expired-card.spec.ts',
    content,
    hash: createHash('sha256').update(content).digest('hex'),
    branch: `cai/${plan.id}`,
    provenance: criterion.sources.map(
      (source) => `${source.sourceKey}@${source.version}#${source.contentHash}`,
    ),
  };
}
export function draftPatch(draft: TestDraft): string {
  const lines = draft.content.trimEnd().split('\n');
  return `diff --git a/${draft.path} b/${draft.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${draft.path}\n@@ -0,0 +1,${String(lines.length)} @@\n${lines.map((line) => '+' + line).join('\n')}\n`;
}
