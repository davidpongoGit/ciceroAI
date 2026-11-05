import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import {
  RunEvidenceSchema,
  TestPlanSchema,
  type ChangeAssessment,
  type RunEvidence,
  type TestPlan,
} from '@cai/contracts';
import { assertionHash, criterionHash, inventoryFile } from '@cai/coverage';
import { planHash, PolicyDenied } from '@cai/policy';
import { draftExpiredCardTest, type TestDraft } from './draft.js';

const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const reporterSchema = z.strictObject({
  results: z.array(
    z.strictObject({
      title: z.string(),
      status: z.enum([
        'passed',
        'failed',
        'timedOut',
        'skipped',
        'interrupted',
      ]),
      assertions: z.array(
        z.strictObject({
          line: z.number().int().positive(),
          passed: z.boolean(),
        }),
      ),
    }),
  ),
});
export async function syntheticBuildSha(broken: boolean): Promise<string> {
  const code = await readFile(
    path.join(workspace, 'fixtures/demo-checkout/server.mjs'),
    'utf8',
  );
  return createHash('sha1').update(code).update(String(broken)).digest('hex');
}
export const draftRevision = (draft: TestDraft): string =>
  createHash('sha1').update(draft.content).digest('hex');
export interface RunnerResult {
  evidence: RunEvidence;
  report: unknown;
  logs: string;
  runDirectory: string;
}
export interface SandboxExecutor {
  executeUntrusted(
    plan: TestPlan,
    repositoryPath: string,
  ): Promise<RunnerResult>;
}
export class UnavailableSandbox implements SandboxExecutor {
  executeUntrusted(
    plan: TestPlan,
    repositoryPath: string,
  ): Promise<RunnerResult> {
    if (!TestPlanSchema.safeParse(plan).success || !repositoryPath)
      return Promise.reject(new Error('Invalid untrusted execution request.'));
    return Promise.reject(
      new Error(
        'Untrusted execution is disabled until an independently reviewed isolated runner is configured. No host fallback is permitted.',
      ),
    );
  }
}

export async function executeTrustedSynthetic(input: {
  plan: TestPlan;
  draft: TestDraft;
  criterion: ChangeAssessment['requirements'][number];
  broken: boolean;
  authorize: () => Promise<TestPlan>;
}): Promise<RunnerResult> {
  const plan = TestPlanSchema.parse(input.plan);
  const expected = draftExpiredCardTest(plan, input.criterion);
  if (
    plan.operation !== 'execute' ||
    plan.environment !== 'synthetic-checkout' ||
    input.draft.content !== expected.content ||
    input.draft.hash !== expected.hash ||
    plan.draftHash !== expected.hash ||
    plan.testRevisionSha !== draftRevision(expected) ||
    plan.appSha !== (await syntheticBuildSha(input.broken))
  )
    throw new PolicyDenied();
  const approval = await input.authorize();
  if (planHash(approval) !== planHash(plan)) throw new PolicyDenied();
  const root = await realpath(workspace);
  const directory = path.join(root, 'runtime-data', 'runs', randomUUID());
  await mkdir(path.join(directory, 'tests'), { recursive: true });
  const resolved = await realpath(directory);
  if (!resolved.startsWith(path.join(root, 'runtime-data') + path.sep))
    throw new Error('Synthetic workspace escaped its allowed root.');
  await writeFile(path.join(resolved, expected.path), expected.content, {
    flag: 'wx',
    mode: 0o600,
  });
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'])
    if (process.env[key]) environment[key] = process.env[key];
  Object.assign(environment, {
    PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'runtime-data/browsers'),
    CAI_DEMO_RUN_ROOT: resolved,
    CAI_DEMO_PORT: '4317',
    CAI_DEMO_BROKEN: String(input.broken),
    CI: '1',
  });
  let logs = '';
  const cancellation = new AbortController();
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        cli,
        'test',
        '--config',
        path.join(root, 'fixtures/demo-checkout/playwright.config.ts'),
      ],
      {
        cwd: root,
        env: environment,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const stop = (): void => {
      if (cancellation.signal.aborted || child.exitCode !== null) return;
      cancellation.abort();
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn(
          'taskkill.exe',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' },
        );
        killer.on('error', () => {
          child.kill();
        });
      } else child.kill('SIGTERM');
    };
    const collect = (chunk: Buffer): void => {
      if (
        Buffer.byteLength(logs) + chunk.byteLength >
        Math.min(plan.budget.maxArtifactBytes, 524_288)
      )
        stop();
      else logs += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timeout = setTimeout(stop, plan.budget.maxRunnerSeconds * 1000);
    let checking = false;
    const check = setInterval(() => {
      if (checking) return;
      checking = true;
      void input
        .authorize()
        .catch(stop)
        .finally(() => {
          checking = false;
        });
    }, 1000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      clearInterval(check);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timeout);
      clearInterval(check);
      resolve(exitCode ?? 1);
    });
  });
  if (cancellation.signal.aborted)
    throw new Error(
      'Synthetic run was cancelled by approval, resource or timeout policy.',
    );
  const report = reporterSchema.parse(
    JSON.parse(
      await readFile(path.join(resolved, 'evidence.json'), 'utf8'),
    ) as unknown,
  );
  const asset = inventoryFile(
    plan.scope,
    expected.path,
    expected.content,
    plan.testRevisionSha,
  )[0];
  const executed = report.results.find((result) =>
    result.title.startsWith(input.criterion.id),
  );
  if (
    !asset ||
    !executed ||
    executed.status === 'skipped' ||
    executed.status === 'interrupted'
  )
    throw new Error('No applicable synthetic execution result.');
  const observedAssertions = asset.assertions.filter((assertion) =>
    executed.assertions.some((step) => step.line === assertion.line),
  );
  if (!observedAssertions.length)
    throw new Error('No mapped assertion was observed executing.');
  const passed =
    code === 0 &&
    executed.status === 'passed' &&
    executed.assertions.every((step) => step.passed);
  const evidence = RunEvidenceSchema.parse({
    id: randomUUID(),
    scope: plan.scope,
    testId: asset.id,
    fileHash: asset.fileHash,
    testRevisionSha: plan.testRevisionSha,
    appSha: plan.appSha,
    environment: plan.environment,
    criterionHash: criterionHash(input.criterion),
    assertionHashes: observedAssertions.map(assertionHash),
    outcome: passed ? 'passed' : 'failed',
    origin: 'trusted-synthetic',
    finishedAt: new Date().toISOString(),
  });
  return { evidence, report, logs, runDirectory: resolved };
}
