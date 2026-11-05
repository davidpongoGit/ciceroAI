import path from 'node:path';
import { defineConfig } from '@playwright/test';
const root = path.resolve(import.meta.dirname, '../..');
const runRoot = process.env.CAI_DEMO_RUN_ROOT;
if (
  !runRoot ||
  !path.resolve(runRoot).startsWith(path.join(root, 'runtime-data') + path.sep)
)
  throw new Error(
    'Synthetic run root must be inside ignored workspace runtime-data.',
  );
const port = process.env.CAI_DEMO_PORT ?? '4317';
export default defineConfig({
  testDir: path.join(runRoot, 'tests'),
  outputDir: path.join(runRoot, 'results'),
  timeout: 10_000,
  expect: { timeout: 1500 },
  globalTimeout: 25_000,
  retries: 0,
  workers: 1,
  reporter: [[path.join(root, 'fixtures/demo-checkout/reporter.ts')]],
  use: {
    browserName: 'chromium',
    headless: true,
    baseURL: `http://127.0.0.1:${port}`,
    serviceWorkers: 'block',
    screenshot: 'off',
    trace: 'off',
  },
  webServer: {
    command: `node "${path.join(root, 'fixtures/demo-checkout/server.mjs')}"`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 5000,
  },
});
