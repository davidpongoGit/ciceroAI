import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ScopeSchema,
  PublicationTargetSchema,
  TestPlanSchema,
  RunEvidenceSchema,
  type Scope,
  type PublicationTarget,
  type TestPlan,
  type RunEvidence,
} from '@cai/contracts';
import { inventoryFile } from '@cai/coverage';
import { planHash, PolicyDenied } from '@cai/policy';
import {
  boundedJson,
  IntegrationError,
  ReadOnlyHttp,
  type FetchTransport,
} from './http.js';

const RefSchema = z.object({
  object: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
});
const RepoSchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string(),
});
const PrSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.url(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean(),
  merged_at: z.string().nullable(),
  head: z.object({ ref: z.string(), sha: z.string(), repo: RepoSchema }),
  base: z.object({ ref: z.string(), sha: z.string(), repo: RepoSchema }),
});
export interface PublicationConfig {
  scope: Scope;
  applicationRepository: string;
  automationRepository: Pick<
    PublicationTarget,
    'repositoryId' | 'repository' | 'baseBranch'
  >;
  installationToken: string;
  approvedExternalWrites: true;
}
export interface PublicationRequest {
  plan: TestPlan;
  content: string;
  provenance: string[];
  executionEvidence?: RunEvidence[];
  authorize: () => Promise<TestPlan>;
}
export interface PublicationResult {
  number: number;
  url: string;
  branch: string;
  headSha: string;
  reused: boolean;
}
export class GitHubDraftPublisher {
  private readonly config: PublicationConfig;
  private readonly root: string;
  private readonly headers: Record<string, string>;
  constructor(
    config: PublicationConfig,
    private readonly transport: FetchTransport = fetch,
  ) {
    const scope = ScopeSchema.parse(config.scope);
    const target = PublicationTargetSchema.pick({
      repositoryId: true,
      repository: true,
      baseBranch: true,
    }).parse({
      repositoryId: config.automationRepository.repositoryId,
      repository: config.automationRepository.repository,
      baseBranch: config.automationRepository.baseBranch,
    });
    const applicationRepository =
      PublicationTargetSchema.shape.repository.parse(
        config.applicationRepository,
      );
    if (
      !z.literal(true).safeParse(config.approvedExternalWrites).success ||
      !config.applicationRepository ||
      target.repositoryId === scope.repositoryId ||
      target.repository.toLowerCase() === applicationRepository.toLowerCase() ||
      !config.installationToken ||
      config.installationToken.includes('CHANGE_ME')
    )
      throw new PolicyDenied();
    this.config = { ...config, scope, automationRepository: target };
    this.root = `https://api.github.com/repos/${target.repository}`;
    this.headers = {
      Authorization: `Bearer ${config.installationToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'content-type': 'application/json',
    };
  }
  async publish(input: PublicationRequest): Promise<PublicationResult> {
    const plan = TestPlanSchema.parse(input.plan);
    const target = plan.publication;
    const configured = this.config.automationRepository;
    const expectedHash = createHash('sha256')
      .update(input.content)
      .digest('hex');
    const gitBlobSha = createHash('sha1')
      .update(`blob ${String(Buffer.byteLength(input.content))}\0`)
      .update(input.content)
      .digest('hex');
    if (
      !target ||
      plan.scope.organisationId !== this.config.scope.organisationId ||
      plan.scope.repositoryId !== this.config.scope.repositoryId ||
      plan.operation !== 'create_pr' ||
      plan.strategy !== 'create' ||
      plan.level !== 'e2e' ||
      plan.draftHash !== expectedHash ||
      target.repositoryId !== configured.repositoryId ||
      target.repository.toLowerCase() !== configured.repository.toLowerCase() ||
      target.baseBranch !== configured.baseBranch ||
      Buffer.byteLength(input.content) > 100_000 ||
      !z
        .array(
          z
            .string()
            .min(1)
            .max(1000)
            .regex(/^[^\r\n]+$/),
        )
        .min(1)
        .max(100)
        .safeParse(input.provenance).success
    )
      throw new PolicyDenied();
    const tests = inventoryFile(
      plan.scope,
      target.path,
      input.content,
      plan.testRevisionSha,
    );
    if (
      !tests.some(
        (test) =>
          !test.skipped &&
          test.assertions.some((assertion) => assertion.supported),
      )
    )
      throw new PolicyDenied();
    const evidence = z
      .array(RunEvidenceSchema)
      .max(20)
      .parse(input.executionEvidence ?? []);
    if (
      evidence.some(
        (run) =>
          run.scope.organisationId !== plan.scope.organisationId ||
          run.scope.repositoryId !== plan.scope.repositoryId ||
          run.appSha !== plan.appSha ||
          run.testRevisionSha !== plan.testRevisionSha ||
          run.fileHash !== expectedHash,
      )
    )
      throw new PolicyDenied();
    const branch = `cai/${plan.id}`;
    const read = new ReadOnlyHttp(this.transport);
    const get = (endpoint: string) =>
      read.get(this.root + endpoint, this.headers);
    const optionalGet = async (endpoint: string): Promise<unknown> => {
      try {
        return await get(endpoint);
      } catch (error) {
        if (error instanceof IntegrationError && error.code === 'missing')
          return null;
        throw error;
      }
    };
    const guard = async () => {
      if (planHash(await input.authorize()) !== planHash(plan))
        throw new PolicyDenied();
    };
    const repoMatches = (repo: z.infer<typeof RepoSchema>) =>
      String(repo.id) === target.repositoryId &&
      repo.full_name.toLowerCase() === target.repository.toLowerCase();
    const checkTarget = async () => {
      if (
        !repoMatches(RepoSchema.parse(await get(''))) ||
        RefSchema.parse(await get(`/git/ref/heads/${target.baseBranch}`)).object
          .sha !== target.baseSha
      )
        throw new PolicyDenied();
    };
    const write = async (
      method: 'POST' | 'PUT',
      endpoint: string,
      body: unknown,
    ): Promise<unknown> => {
      // Recheck the independent automation base and exact approval before every
      // write. No application repository request or default-branch write exists.
      await checkTarget();
      await guard();
      let response: Response;
      try {
        response = await this.transport(this.root + endpoint, {
          method,
          headers: this.headers,
          body: JSON.stringify(body),
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        throw new IntegrationError('unavailable');
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new IntegrationError(
          response.status === 401 || response.status === 403
            ? 'denied'
            : response.status === 429
              ? 'rate_limited'
              : 'unavailable',
        );
      }
      return boundedJson(response);
    };
    const filePath = `/contents/${target.path.split('/').map(encodeURIComponent).join('/')}`;
    const verifyPr = (
      value: unknown,
      headSha: string,
      reused: boolean,
    ): PublicationResult => {
      const pr = PrSchema.parse(value);
      const url = `https://github.com/${target.repository}/pull/${String(pr.number)}`;
      if (
        !repoMatches(pr.head.repo) ||
        !repoMatches(pr.base.repo) ||
        pr.head.ref !== branch ||
        pr.head.sha !== headSha ||
        pr.base.ref !== target.baseBranch ||
        pr.base.sha !== target.baseSha ||
        pr.state !== 'open' ||
        !pr.draft ||
        pr.merged_at !== null ||
        pr.html_url.toLowerCase() !== url.toLowerCase()
      )
        throw new PolicyDenied();
      return { number: pr.number, url, branch, headSha, reused };
    };
    await guard();
    await checkTarget();
    // New test only. Never overwrite an existing test or other automation file.
    if (await optionalGet(`${filePath}?ref=${target.baseSha}`))
      throw new PolicyDenied();
    if (!(await optionalGet(`/git/ref/heads/${branch}`)))
      await write('POST', '/git/refs', {
        ref: `refs/heads/${branch}`,
        sha: target.baseSha,
      });
    let current = RefSchema.parse(await get(`/git/ref/heads/${branch}`)).object
      .sha;
    if (!(await optionalGet(`${filePath}?ref=${current}`))) {
      if (current !== target.baseSha) throw new PolicyDenied();
      await write('PUT', filePath, {
        message: `Cai approved test plan ${plan.id}`,
        content: Buffer.from(input.content).toString('base64'),
        branch,
      });
      current = RefSchema.parse(await get(`/git/ref/heads/${branch}`)).object
        .sha;
    }
    const file = z
      .object({
        type: z.literal('file'),
        encoding: z.literal('base64'),
        content: z.string().max(200_000),
      })
      .parse(await get(`${filePath}?ref=${current}`));
    if (
      createHash('sha256')
        .update(Buffer.from(file.content.replace(/\s/g, ''), 'base64'))
        .digest('hex') !== expectedHash
    )
      throw new PolicyDenied();
    const diff = z
      .object({
        status: z.literal('ahead'),
        ahead_by: z.literal(1),
        behind_by: z.literal(0),
        total_commits: z.literal(1),
        files: z
          .array(
            z.object({
              filename: z.string(),
              status: z.literal('added'),
              sha: z.string(),
            }),
          )
          .length(1),
      })
      .parse(await get(`/compare/${target.baseSha}...${current}`));
    const changedFile = diff.files[0];
    if (
      !changedFile ||
      changedFile.filename !== target.path ||
      changedFile.sha !== gitBlobSha
    )
      throw new PolicyDenied();
    const existing = z
      .array(PrSchema)
      .max(100)
      .parse(
        await get(
          `/pulls?state=all&head=${encodeURIComponent(`${target.repository.split('/')[0] ?? ''}:${branch}`)}&base=${encodeURIComponent(target.baseBranch)}&per_page=100`,
        ),
      );
    await checkTarget();
    await guard();
    if (existing.length > 1) throw new PolicyDenied();
    if (existing[0]) return verifyPr(existing[0], current, true);
    // Immutable commit reads above qualify the proposal; refuse a concurrently
    // edited branch instead of publishing another actor's edits.
    if (
      RefSchema.parse(await get(`/git/ref/heads/${branch}`)).object.sha !==
      current
    )
      throw new PolicyDenied();
    const proposal = {
      title: `Cai: regression coverage (${plan.id.slice(0, 8)})`,
      head: branch,
      base: target.baseBranch,
      draft: true,
      body: `Cai test-only proposal. Developer review, approval and merge remain in the VCS.\n\nPlan: ${plan.id}\nPlan hash: ${planHash(plan)}\nApplication repository: ${this.config.applicationRepository} (read-only, ID ${plan.scope.repositoryId})\nAssessed application SHA: ${plan.appSha}\nAutomation repository: ${target.repository} (ID ${target.repositoryId})\nAutomation base: ${target.baseBranch}@${target.baseSha}\nPlanned test content revision: ${plan.testRevisionSha}\nDraft SHA-256: ${expectedHash}\n\nSource/version references:\n${input.provenance.map((source) => `- ${source}`).join('\n')}\n\nThis publication does not establish verified coverage. Review execution evidence and environment suitability separately. No application code, workflow configuration or existing test is changed. No merge is requested.`,
    };
    proposal.body +=
      '\n\nRecorded execution evidence (not verified coverage):\n' +
      (evidence.length
        ? evidence
            .map(
              (run) =>
                `- ${run.id}: ${run.outcome}; ${run.origin}; environment ${run.environment}; finished ${run.finishedAt}`,
            )
            .join('\n')
        : 'Execution evidence unavailable.');
    const created = await write('POST', '/pulls', proposal);
    return verifyPr(created, current, false);
  }
}
