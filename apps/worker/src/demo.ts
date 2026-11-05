import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { buildApp } from '@cai/api';
import type { Principal, TestPlan, Dependency } from '@cai/contracts';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import {
  SyntheticSourceProvider,
  SyntheticAutomationRepository,
  GitHubDraftPublisher,
  type PullRequestSource,
  type IssueSource,
} from '@cai/integrations';
import {
  draftExpiredCardTest,
  draftPatch,
  draftRevision,
  executeTrustedSynthetic,
  LocalArtifactStore,
  syntheticBuildSha,
} from '@cai/executor';
import { assertionHash, criterionHash, inventoryFile } from '@cai/coverage';
import { planHash } from '@cai/policy';
import { processAnalysisOne } from './analysis.js';
import { publishApprovedTest } from './publication.js';

async function demo(): Promise<void> {
  const url = new URL(readDatabaseUrl(process.env.DATABASE_URL));
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !['/postgres', '/cai_local', '/cai_ci'].includes(url.pathname)
  )
    throw new Error('Demo requires the dedicated local development database.');
  const database = createDatabase(url.toString());
  const scope = { organisationId: randomUUID(), repositoryId: '101' };
  const principal: Principal = {
    id: 'synthetic-demo-operator',
    scope,
    capabilities: [
      'assessment.read',
      'plan.create',
      'plan.approve',
      'plan.revoke',
      'draft',
      'execute',
      'create_pr',
      'data.manage',
    ],
  };
  const secret = randomBytes(32).toString('hex');
  const token = randomBytes(32).toString('hex');
  const store = new LocalArtifactStore('runtime-data/artifacts');
  const app = buildApp({
    workflow: {
      scope,
      installationId: '99',
      webhookSecret: secret,
      apiToken: token,
      store: database.workflows,
    },
    admin: { database, principal, apiToken: token, artifactStore: store },
  });
  try {
    await database.migrate();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const finalSha = await syntheticBuildSha(false);
    const issue: IssueSource = {
      scope,
      key: 'DEMO-1',
      version: 'synthetic-v1',
      title: 'Synthetic saved-card checkout',
      text: 'AC-1: Reject expired cards.\nKnown dependencies: PR #101 validation, PR #102 payment integration, PR #103 UI. Staging, checkout flag and synthetic card data are required.',
      url: 'https://synthetic.atlassian.net/browse/DEMO-1',
    };
    const stages: {
      stage: string;
      eligible: boolean;
      code: string;
      environment: string;
    }[] = [];
    let featureId = '';
    let finalAssessmentId = '';
    let source: Dependency['source'] | undefined;
    const revise = async (
      key: string,
      kind: Dependency['kind'],
      status: Dependency['status'],
    ) => {
      if (!source) throw new Error('Expected scoped source.');
      await database.graph.reviseDependency(
        scope,
        featureId,
        {
          key,
          kind,
          status,
          certainty: 'confirmed',
          explanation:
            'Synthetic scenario signal, not a live integration observation.',
          source,
          buildSha: kind === 'deployment' ? finalSha : null,
        },
        'synthetic-fixture',
      );
    };
    for (const number of [101, 102, 103]) {
      const sha =
        number === 103
          ? finalSha
          : createHash('sha1')
              .update(`synthetic-partial-${String(number)}`)
              .digest('hex');
      const pr: PullRequestSource = {
        scope,
        number,
        headSha: sha,
        baseSha: 'b'.repeat(40),
        title: 'DEMO-1 checkout stage ' + String(number),
        body: 'Synthetic fixture only.',
        url: `https://github.com/synthetic/demo/pull/${String(number)}`,
        files: [
          {
            path: 'fixtures/demo-checkout/server.mjs',
            status: 'modified',
            patch: null,
          },
        ],
      };
      const delivery = randomUUID();
      const body = JSON.stringify({
        action: 'opened',
        installation: { id: 99 },
        repository: { id: 101, full_name: 'synthetic/demo' },
        pull_request: {
          number,
          head: { sha },
          base: { sha: pr.baseSha },
          merged: false,
        },
      });
      const headers = {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': delivery,
        'x-hub-signature-256':
          'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
      };
      const send = () =>
        fetch(address + '/webhooks/github', { method: 'POST', headers, body });
      const response = await send();
      if (response.status !== 202) throw new Error('Demo intake failed.');
      const intake = z
        .object({ id: z.uuid(), duplicate: z.boolean() })
        .parse(await response.json());
      const duplicate = z
        .object({ id: z.uuid(), duplicate: z.boolean() })
        .parse(await (await send()).json());
      if (duplicate.id !== intake.id || !duplicate.duplicate)
        throw new Error('Demo delivery did not deduplicate.');
      await processAnalysisOne(
        database,
        scope,
        new SyntheticSourceProvider(pr, [issue]),
      );
      const report = await database.knowledge.getReport(scope, intake.id);
      if (!report) throw new Error('Demo analysis did not persist.');
      source = report.report.sourceReferences.find(
        (ref) => ref.sourceKey === 'jira:DEMO-1',
      );
      if (!featureId) {
        featureId = await database.graph.configureFeature(
          scope,
          'checkout',
          finalSha,
          true,
        );
        for (const [key, kind, status] of [
          ['pr101', 'code', 'satisfied'],
          ['pr102', 'code', 'pending'],
          ['pr103', 'code', 'pending'],
          ['staging', 'deployment', 'pending'],
          ['checkout_flag', 'flag', 'pending'],
          ['synthetic_cards', 'data', 'satisfied'],
        ] as const)
          await revise(key, kind, status);
      } else await revise(`pr${String(number)}`, 'code', 'satisfied');
      const readiness = await database.graph.readiness(scope, featureId);
      if (!readiness) throw new Error('Missing readiness.');
      stages.push({
        stage: `PR ${String(number)}`,
        eligible: readiness.eligibleForPlan,
        code: readiness.code,
        environment: readiness.environment,
      });
      finalAssessmentId = intake.id;
    }
    await revise('staging', 'deployment', 'satisfied');
    await revise('checkout_flag', 'flag', 'satisfied');
    const ready = await database.graph.readiness(scope, featureId);
    if (!ready?.eligibleForPlan)
      throw new Error('Synthetic feature did not become eligible.');
    stages.push({
      stage: 'Deployment + flag + data',
      eligible: ready.eligibleForPlan,
      code: ready.code,
      environment: ready.environment,
    });
    const report = await database.knowledge.getReport(scope, finalAssessmentId);
    const criterion = report?.report.requirements[0];
    if (!criterion) throw new Error('Missing criterion.');
    const draftPlan: TestPlan = {
      id: randomUUID(),
      scope,
      assessmentId: finalAssessmentId,
      featureId,
      operation: 'draft',
      strategy: 'create',
      level: 'e2e',
      appSha: finalSha,
      testRevisionSha: finalSha,
      environment: 'synthetic-checkout',
      criterionIds: [criterion.id],
      draftHash: null,
      budget: { maxRunnerSeconds: 30, maxArtifactBytes: 1_048_576 },
      policyVersion: 'supervised-v1',
    };
    await database.plans.create(principal, draftPlan);
    await database.plans.decide(principal, draftPlan.id, 'approved');
    await database.plans.authorize(principal, draftPlan.id, {
      appSha: finalSha,
      testRevisionSha: finalSha,
      draftHash: null,
    });
    const draft = draftExpiredCardTest(draftPlan, criterion);
    const expiry = new Date(Date.now() + 86_400_000).toISOString();
    const codeRef = await store.put(scope, Buffer.from(draft.content), {
      mediaType: 'text/typescript',
      sensitivity: 'synthetic',
      expiresAt: expiry,
    });
    await database.artifacts.register(principal, finalAssessmentId, codeRef);
    const patchRef = await store.put(scope, Buffer.from(draftPatch(draft)), {
      mediaType: 'text/x-diff',
      sensitivity: 'synthetic',
      expiresAt: expiry,
    });
    await database.artifacts.register(principal, finalAssessmentId, patchRef);
    const execution: TestPlan = {
      ...draftPlan,
      id: randomUUID(),
      operation: 'execute',
      draftHash: draft.hash,
      testRevisionSha: draftRevision(draft),
    };
    await database.plans.create(principal, execution);
    await database.plans.decide(principal, execution.id, 'approved');
    const assets = inventoryFile(
      scope,
      draft.path,
      draft.content,
      execution.testRevisionSha,
    );
    const asset = assets[0];
    const assertion = asset?.assertions[0];
    if (!asset || !assertion) throw new Error('Drafted assertion missing.');
    await database.coverage.storeInventory(scope, assets);
    await database.coverage.reviewMapping(
      scope,
      finalAssessmentId,
      {
        criterionId: criterion.id,
        criterionHash: criterionHash(criterion),
        testId: asset.id,
        assertionHash: assertionHash(assertion),
        reviewedBy: 'synthetic-fixture',
      },
      execution.testRevisionSha,
      'synthetic-fixture',
    );
    const reservation = await database.actions.reserve(principal, execution);
    const started = performance.now();
    const result = await executeTrustedSynthetic({
      plan: execution,
      draft,
      criterion,
      broken: false,
      authorize: () =>
        database.plans.authorize(principal, execution.id, {
          appSha: execution.appSha,
          testRevisionSha: execution.testRevisionSha,
          draftHash: execution.draftHash,
        }),
    });
    await database.actions.settle(
      principal,
      reservation,
      Math.ceil(performance.now() - started),
      result.evidence.outcome === 'passed' ? 'completed' : 'failed',
    );
    if (result.evidence.outcome !== 'passed')
      throw new Error('Synthetic test did not pass.');
    await database.coverage.recordEvidence(
      scope,
      finalAssessmentId,
      result.evidence,
    );
    const evidenceRef = await store.put(
      scope,
      Buffer.from(
        JSON.stringify({ evidence: result.evidence, report: result.report }),
      ),
      {
        mediaType: 'application/json',
        sensitivity: 'synthetic',
        expiresAt: expiry,
      },
    );
    await database.artifacts.register(
      principal,
      finalAssessmentId,
      evidenceRef,
    );
    const publication: TestPlan = {
      ...execution,
      id: randomUUID(),
      operation: 'create_pr',
      publication: {
        provider: 'github',
        repositoryId: '202',
        repository: 'synthetic/playwright',
        baseBranch: 'main',
        baseSha: 'e'.repeat(40),
        path: draft.path,
      },
    };
    await database.plans.create(principal, publication);
    const review = {
      mode: 'local_review_only',
      realPrCreated: false,
      branch: `cai/${publication.id}`,
      planId: publication.id,
      planHash: planHash(publication),
      patchArtifactId: patchRef.id,
      evidenceArtifactId: evidenceRef.id,
      provenance: draft.provenance,
      limitations: [
        'Synthetic approval and source signals only.',
        'No customer code, real provider call or isolated untrusted execution occurred.',
      ],
    };
    const reviewRef = await store.put(
      scope,
      Buffer.from(JSON.stringify(review, null, 2)),
      {
        mediaType: 'application/json',
        sensitivity: 'synthetic',
        expiresAt: expiry,
      },
    );
    await database.artifacts.register(principal, finalAssessmentId, reviewRef);
    let publicationResult = null;
    if (process.argv.includes('--publish-synthetic')) {
      if (!publication.publication)
        throw new Error('Expected automation target.');
      const remote = new SyntheticAutomationRepository(publication.publication);
      const publisher = new GitHubDraftPublisher(
        {
          scope,
          applicationRepository: 'synthetic/demo',
          automationRepository: publication.publication,
          installationToken: 'synthetic-in-memory-token',
          approvedExternalWrites: true,
        },
        remote.transport,
      );
      await database.plans.decide(principal, publication.id, 'approved');
      const input = {
        database,
        principal,
        planId: publication.id,
        draftArtifactId: codeRef.id,
        store,
        publisher,
        mode: 'synthetic' as const,
      };
      const first = await publishApprovedTest(input);
      const repeat = await publishApprovedTest(input);
      if (remote.writes.length !== 3 || !repeat.receipt.result.reused)
        throw new Error('Synthetic publication did not reconcile.');
      publicationResult = {
        ...first.receipt,
        receiptArtifactId: first.reference.id,
        reconciliationReceiptArtifactId: repeat.reference.id,
        simulatedWrites: remote.writes.length,
      };
    }
    await database.monitor.reconcile(principal);
    const backup = await database.lifecycle.exportScope(principal);
    await mkdir('runtime-data', { recursive: true });
    const env = {
      DATABASE_URL: url.toString(),
      HOST: '127.0.0.1',
      PORT: '3000',
      WORKFLOW_ENABLED: 'true',
      ORGANISATION_ID: scope.organisationId,
      REPOSITORY_ID: scope.repositoryId,
      INSTALLATION_ID: '99',
      WEBHOOK_SECRET: secret,
      API_TOKEN: token,
      PLAN_APPROVALS_ENABLED: 'true',
      MAINTENANCE_ENABLED: 'true',
    };
    await writeFile(
      'runtime-data/demo.env',
      Object.entries(env)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n') + '\n',
      { mode: 0o600 },
    );
    await writeFile(
      'runtime-data/demo-backup.json',
      JSON.stringify(backup, null, 2),
      { mode: 0o600 },
    );
    await writeFile('runtime-data/demo-review.patch', draftPatch(draft), {
      mode: 0o600,
    });
    await writeFile(
      'runtime-data/demo-summary.json',
      JSON.stringify(
        {
          scope,
          assessmentId: finalAssessmentId,
          featureId,
          stages,
          browserEvidence: result.evidence,
          review,
          publication: publicationResult,
          usage: await database.actions.usage(principal),
          backupChecksum: backup.checksum,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.info(
      JSON.stringify(
        {
          message:
            'Synthetic demo completed. Run npm run demo:serve and open http://127.0.0.1:3000. Copy API_TOKEN locally from ignored runtime-data/demo.env; it is not logged.',
          scope,
          assessmentId: finalAssessmentId,
          stages,
          browserOutcome: result.evidence.outcome,
          evidenceOrigin: result.evidence.origin,
          realPrCreated: false,
          syntheticPublication: publicationResult
            ? {
                status: publicationResult.status,
                simulatedWrites: publicationResult.simulatedWrites,
                reconciled: true,
                receiptArtifactId: publicationResult.receiptArtifactId,
              }
            : null,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    await database.close();
  }
}
try {
  await demo();
} catch {
  console.error(
    'Synthetic demo failed. Check local database, migrations and Playwright browser installation. No credentials were logged.',
  );
  process.exitCode = 1;
}
