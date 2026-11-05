import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ScopeSchema,
  TestPlanSchema,
  type Scope,
  type TestPlan,
} from '@cai/contracts';
import { safeRepositoryPath } from '@cai/coverage';
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
const PrSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.url(),
  head: z.object({ ref: z.string() }),
  base: z.object({ ref: z.string() }),
});
export class GitHubDraftPublisher {
  private readonly root: string;
  private readonly headers: Record<string, string>;
  constructor(
    private readonly config: {
      scope: Scope;
      repository: string;
      baseBranch: string;
      installationToken: string;
      approvedExternalWrites: true;
    },
    private readonly transport: FetchTransport = fetch,
  ) {
    ScopeSchema.parse(config.scope);
    if (
      !z.literal(true).safeParse(config.approvedExternalWrites).success ||
      !/^[\w.-]+\/[\w.-]+$/.test(config.repository) ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(config.baseBranch) ||
      !config.installationToken
    )
      throw new PolicyDenied();
    this.root = `https://api.github.com/repos/${config.repository}`;
    this.headers = {
      Authorization: `Bearer ${config.installationToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'content-type': 'application/json',
    };
  }
  async publish(input: {
    plan: TestPlan;
    path: string;
    content: string;
    provenance: string[];
    authorize: () => Promise<TestPlan>;
  }) {
    const plan = TestPlanSchema.parse(input.plan);
    const expectedHash = createHash('sha256')
      .update(input.content)
      .digest('hex');
    if (
      plan.scope.organisationId !== this.config.scope.organisationId ||
      plan.scope.repositoryId !== this.config.scope.repositoryId ||
      plan.operation !== 'create_pr' ||
      plan.strategy !== 'create' ||
      plan.draftHash !== expectedHash ||
      !safeRepositoryPath(input.path) ||
      !input.path.startsWith('tests/') ||
      !input.path.endsWith('.spec.ts') ||
      Buffer.byteLength(input.content) > 100_000
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
    const guard = async (): Promise<void> => {
      if (planHash(await input.authorize()) !== planHash(plan))
        throw new PolicyDenied();
    };
    const write = async (
      method: 'POST' | 'PUT',
      endpoint: string,
      body: unknown,
    ): Promise<unknown> => {
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
    await guard();
    const repo = z
      .object({ id: z.number().int().positive() })
      .parse(await get(''));
    if (String(repo.id) !== plan.scope.repositoryId) throw new PolicyDenied();
    const base = RefSchema.parse(
      await get(`/git/ref/heads/${this.config.baseBranch}`),
    );
    if (base.object.sha !== plan.appSha) throw new PolicyDenied();
    const branchRef = await optionalGet(`/git/ref/heads/${branch}`);
    if (!branchRef)
      await write('POST', '/git/refs', {
        ref: `refs/heads/${branch}`,
        sha: plan.appSha,
      });
    const fileEndpoint = `/contents/${input.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
    let file = await optionalGet(fileEndpoint);
    if (!file) {
      const writable = RefSchema.parse(await get(`/git/ref/heads/${branch}`));
      if (writable.object.sha !== plan.appSha) throw new PolicyDenied();
      await write(
        'PUT',
        `/contents/${input.path.split('/').map(encodeURIComponent).join('/')}`,
        {
          message: `Cai approved test plan ${plan.id}`,
          content: Buffer.from(input.content).toString('base64'),
          branch,
        },
      );
      file = await get(fileEndpoint);
    }
    const stored = z
      .object({
        encoding: z.literal('base64'),
        content: z.string().max(200_000),
      })
      .parse(file);
    if (
      createHash('sha256')
        .update(Buffer.from(stored.content.replace(/\s/g, ''), 'base64'))
        .digest('hex') !== expectedHash
    )
      throw new PolicyDenied();
    const current = RefSchema.parse(await get(`/git/ref/heads/${branch}`));
    const diff = z
      .object({
        files: z
          .array(z.object({ filename: z.string(), status: z.string() }))
          .max(1),
      })
      .parse(await get(`/compare/${plan.appSha}...${current.object.sha}`));
    if (
      diff.files.length !== 1 ||
      diff.files[0]?.filename !== input.path ||
      diff.files[0].status !== 'added'
    )
      throw new PolicyDenied();
    const existing = z
      .array(PrSchema)
      .max(100)
      .parse(
        await get(
          `/pulls?state=all&head=${encodeURIComponent(`${this.config.repository.split('/')[0] ?? ''}:${branch}`)}`,
        ),
      );
    const prior = existing.find(
      (pr) => pr.head.ref === branch && pr.base.ref === this.config.baseBranch,
    );
    if (prior)
      return {
        number: prior.number,
        url: prior.html_url,
        branch,
        reused: true,
      };
    if (
      RefSchema.parse(await get(`/git/ref/heads/${this.config.baseBranch}`))
        .object.sha !== plan.appSha
    )
      throw new PolicyDenied();
    const created = PrSchema.parse(
      await write('POST', '/pulls', {
        title: `Cai: reviewed regression coverage (${plan.id.slice(0, 8)})`,
        head: branch,
        base: this.config.baseBranch,
        draft: true,
        body: `Plan: ${plan.id}\nPlan hash: ${planHash(plan)}\nDraft checksum: ${expectedHash}\n\nSources:\n${input.provenance.map((source) => `- ${source}`).join('\n')}\n\nGenerated test draft. Execution evidence must be reviewed separately. No merge is requested.`,
      }),
    );
    if (
      created.head.ref !== branch ||
      created.base.ref !== this.config.baseBranch
    )
      throw new PolicyDenied();
    return {
      number: created.number,
      url: created.html_url,
      branch,
      reused: false,
    };
  }
}
