import { z } from 'zod';
import {
  ScopeSchema,
  PublicationTargetSchema,
  type Principal,
} from '@cai/contracts';
import { createDatabase, readDatabaseUrl } from '@cai/database';
import { LocalArtifactStore } from '@cai/executor';
import { GitHubDraftPublisher } from '@cai/integrations';
import { publishApprovedTest } from './publication.js';

try {
  if (process.env.PUBLISH_ENABLED !== 'true')
    throw new Error('Publication is disabled.');
  const scope = ScopeSchema.parse({
    organisationId: process.env.ORGANISATION_ID,
    repositoryId: process.env.REPOSITORY_ID,
  });
  const target = PublicationTargetSchema.pick({
    repositoryId: true,
    repository: true,
    baseBranch: true,
  }).parse({
    repositoryId: process.env.AUTOMATION_REPOSITORY_ID,
    repository: process.env.AUTOMATION_REPOSITORY,
    baseBranch: process.env.AUTOMATION_BASE_BRANCH,
  });
  const planId = z.uuid().parse(process.argv[2]);
  const draftArtifactId = z.uuid().parse(process.argv[3]);
  const publisher = new GitHubDraftPublisher({
    scope,
    applicationRepository: process.env.APPLICATION_REPOSITORY ?? '',
    automationRepository: target,
    installationToken: process.env.AUTOMATION_INSTALLATION_TOKEN ?? '',
    approvedExternalWrites: true,
  });
  const principal: Principal = {
    id: 'local-publication-operator',
    scope,
    capabilities: ['assessment.read', 'create_pr', 'data.manage'],
  };
  const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
  try {
    const result = await publishApprovedTest({
      database,
      principal,
      planId,
      draftArtifactId,
      store: new LocalArtifactStore('runtime-data/artifacts'),
      publisher,
      mode: 'github',
    });
    console.info(
      JSON.stringify({
        status: result.receipt.status,
        url: result.receipt.result.url,
        reused: result.receipt.result.reused,
        receiptArtifactId: result.reference.id,
      }),
    );
  } finally {
    await database.close();
  }
} catch {
  console.error(
    'Publication did not complete. Check explicit enablement, separate automation target, current exact-plan approval and draft artifact. Reconcile uncertain writes with the same plan; no credentials or source content were logged.',
  );
  process.exitCode = 1;
}
