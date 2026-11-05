import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  Reporter,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
export default class SyntheticEvidenceReporter implements Reporter {
  private readonly results: {
    title: string;
    status: string;
    assertions: { line: number; passed: boolean }[];
  }[] = [];
  onTestEnd(test: TestCase, result: TestResult): void {
    const assertions: { line: number; passed: boolean }[] = [];
    const visit = (step: TestStep): void => {
      if (step.category === 'expect' && step.location)
        assertions.push({ line: step.location.line, passed: !step.error });
      for (const child of step.steps) visit(child);
    };
    for (const step of result.steps) visit(step);
    this.results.push({ title: test.title, status: result.status, assertions });
  }
  onEnd(): void {
    const runRoot = process.env.CAI_DEMO_RUN_ROOT;
    if (!runRoot) throw new Error('Synthetic run root is missing.');
    writeFileSync(
      path.join(runRoot, 'evidence.json'),
      JSON.stringify({ results: this.results }),
      { mode: 0o600 },
    );
  }
}
