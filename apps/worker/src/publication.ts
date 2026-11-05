import { createHash } from 'node:crypto';
import type { ArtifactStore, Principal } from '@cai/contracts';
import type { createDatabase } from '@cai/database';
import type { GitHubDraftPublisher } from '@cai/integrations';
import { planHash, PolicyDenied, requireCapability } from '@cai/policy';

export async function publishApprovedTest(input: {
  database: ReturnType<typeof createDatabase>;
  principal: Principal;
  planId: string;
  draftArtifactId: string;
  store: ArtifactStore;
  publisher: Pick<GitHubDraftPublisher, 'publish'>;
  mode: 'synthetic' | 'github';
}) {
  const { database, principal } = input;
  requireCapability(principal, principal.scope, 'data.manage');
  const record = await database.plans.get(principal, input.planId);
  if (
    !record ||
    record.plan.operation !== 'create_pr' ||
    !record.plan.publication
  )
    throw new PolicyDenied();
  const plan = record.plan;
  const authorize = () =>
    database.plans.authorize(principal, plan.id, {
      appSha: plan.appSha,
      testRevisionSha: plan.testRevisionSha,
      draftHash: plan.draftHash,
    });
  await authorize();
  const artifact = (
    await database.artifacts.list(principal, plan.assessmentId)
  ).find((reference) => reference.id === input.draftArtifactId);
  if (
    !artifact ||
    artifact.mediaType !== 'text/typescript' ||
    artifact.bytes > 100_000 ||
    artifact.checksum !== plan.draftHash
  )
    throw new PolicyDenied();
  const content = Buffer.from(
    await input.store.get(plan.scope, artifact),
  ).toString('utf8');
  if (createHash('sha256').update(content).digest('hex') !== plan.draftHash)
    throw new PolicyDenied();
  const report = await database.knowledge.getReport(
    plan.scope,
    plan.assessmentId,
  );
  if (!report || report.stale) throw new PolicyDenied();
  const provenance = [
    ...new Set(
      report.report.requirements
        .filter((requirement) => plan.criterionIds.includes(requirement.id))
        .flatMap((requirement) =>
          requirement.sources.map(
            (source) =>
              `${source.sourceKey}@${source.version}#${source.contentHash}`,
          ),
        ),
    ),
  ];
  const executionEvidence = (
    await database.coverage.recordedRuns(plan.scope, plan.assessmentId)
  ).filter(
    (run) =>
      run.appSha === plan.appSha &&
      run.testRevisionSha === plan.testRevisionSha &&
      run.fileHash === plan.draftHash,
  );
  await database.plans.publicationEvent(principal, plan.id, 'started');
  try {
    const result = await input.publisher.publish({
      plan,
      content,
      provenance,
      executionEvidence,
      authorize,
    });
    const receipt = {
      kind: 'test-publication',
      version: 1,
      mode: input.mode,
      externalPullRequest: input.mode === 'github',
      status:
        input.mode === 'synthetic'
          ? 'simulated_awaiting_review'
          : 'created_awaiting_review',
      scope: plan.scope,
      planId: plan.id,
      planHash: planHash(plan),
      applicationSha: plan.appSha,
      automationTarget: plan.publication,
      draftArtifactId: artifact.id,
      draftChecksum: artifact.checksum,
      executionEvidence: executionEvidence.map((run) => ({
        id: run.id,
        outcome: run.outcome,
        origin: run.origin,
        environment: run.environment,
      })),
      provenance,
      result,
      recordedAt: new Date().toISOString(),
      limitations: [
        'Publication is not verified coverage.',
        'Developer review, approval and merge remain in the VCS.',
        ...(input.mode === 'synthetic'
          ? ['In-memory VCS transport only. No external branch or PR exists.']
          : []),
      ],
    };
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2));
    if (bytes.byteLength > plan.budget.maxArtifactBytes)
      throw new Error('Publication receipt exceeds approved artifact budget.');
    const reference = await input.store.put(plan.scope, bytes, {
      mediaType: 'application/json',
      sensitivity: artifact.sensitivity,
      expiresAt: artifact.expiresAt,
    });
    await database.artifacts.register(principal, plan.assessmentId, reference);
    await database.plans.publicationEvent(
      principal,
      plan.id,
      'recorded',
      reference.id,
    );
    return { receipt, reference };
  } catch (error) {
    await database.plans
      .publicationEvent(principal, plan.id, 'failed')
      .catch(() => undefined);
    // Uncertain writes are reconciled by the same plan-specific branch on retry.
    // Never delete/revert a remote developer branch in response to local failure.
    throw error;
  }
}
