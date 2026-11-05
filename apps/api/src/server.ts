import { buildApp } from './app.js';
import { readApiConfig } from './config.js';
import { readWorkflowConfig } from './workflow-config.js';
import { createDatabase } from '@cai/database';
import type { Principal } from '@cai/contracts';
import { LocalArtifactStore } from '@cai/executor';

let app: ReturnType<typeof buildApp> | undefined;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    const deadline = setTimeout(() => process.exit(1), 5000).unref();
    void app
      ?.close()
      .then(() => {
        clearTimeout(deadline);
      })
      .catch(() => {
        process.exitCode = 1;
      });
  });
}

try {
  const config = readApiConfig(process.env);
  const workflow = readWorkflowConfig(process.env);
  const database = workflow ? createDatabase(workflow.databaseUrl) : null;
  const principal: Principal | null = workflow
    ? {
        id: 'local-operator',
        scope: workflow.scope,
        capabilities:
          process.env.PLAN_APPROVALS_ENABLED === 'true'
            ? [
                'assessment.read',
                'plan.create',
                'plan.approve',
                'plan.revoke',
                'draft',
                'execute',
                'create_pr',
                'data.manage',
              ]
            : ['assessment.read'],
      }
    : null;
  app = buildApp(
    workflow && database && principal
      ? {
          workflow: { ...workflow, store: database.workflows },
          admin: {
            database,
            principal,
            apiToken: workflow.apiToken,
            artifactStore: new LocalArtifactStore('runtime-data/artifacts'),
          },
        }
      : undefined,
  );
  if (database)
    app.addHook('onClose', async () => {
      await database.close();
    });
  await app.listen(config);
  console.info(
    `Cai API listening at http://${config.host}:${String(config.port)}`,
  );
} catch {
  console.error(
    'API startup failed. Check HOST, PORT and local port availability.',
  );
  await app?.close();
  process.exitCode = 1;
}
