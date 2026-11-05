import { z } from 'zod';
import { ScopeSchema, ShaSchema, type Scope } from '@cai/contracts';
import { IntegrationError, ReadOnlyHttp } from './http.js';
export * from './http.js';
export * from './publisher.js';
export * from './synthetic-publication.js';

export const ChangedFileSchema = z.object({
  path: z.string().min(1).max(500),
  status: z.enum([
    'added',
    'modified',
    'removed',
    'renamed',
    'copied',
    'changed',
    'unchanged',
  ]),
  patch: z.string().max(100_000).nullable(),
});
export const PullRequestSourceSchema = z.strictObject({
  scope: ScopeSchema,
  number: z.number().int().positive(),
  headSha: ShaSchema,
  baseSha: ShaSchema,
  title: z.string().max(1000),
  body: z.string().max(100_000),
  url: z.url(),
  files: z.array(ChangedFileSchema).max(2000),
});
export type PullRequestSource = z.infer<typeof PullRequestSourceSchema>;
export const IssueSourceSchema = z.strictObject({
  scope: ScopeSchema,
  key: z.string().regex(/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/),
  version: z.string().min(1).max(200),
  title: z.string().max(1000),
  text: z.string().max(100_000),
  url: z.url(),
});
export type IssueSource = z.infer<typeof IssueSourceSchema>;
export interface SourceProvider {
  getPullRequest(
    scope: Scope,
    number: number,
    expectedSha: string,
  ): Promise<PullRequestSource>;
  getIssue(scope: Scope, key: string): Promise<IssueSource>;
}

function checkScope(actual: Scope, allowed: Scope): void {
  ScopeSchema.parse(actual);
  if (
    actual.organisationId !== allowed.organisationId ||
    actual.repositoryId !== allowed.repositoryId
  )
    throw new IntegrationError('scope');
}
const GithubPrSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.url(),
  head: z.object({ sha: ShaSchema }),
  base: z.object({
    sha: ShaSchema,
    repo: z.object({ id: z.number().int().positive() }),
  }),
});
const GithubFileSchema = z.object({
  filename: z.string(),
  status: ChangedFileSchema.shape.status,
  patch: z.string().optional(),
});
const JiraIssueSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string(),
    description: z.unknown(),
    updated: z.string(),
  }),
});

export function adfText(value: unknown): string {
  let nodes = 0;
  function visit(node: unknown, depth: number): string {
    if (++nodes > 10_000 || depth > 30) throw new IntegrationError('malformed');
    if (!node || typeof node !== 'object') return '';
    const parsed = z
      .object({
        type: z.string(),
        text: z.string().optional(),
        content: z.array(z.unknown()).optional(),
      })
      .safeParse(node);
    if (!parsed.success) throw new IntegrationError('malformed');
    const item = parsed.data;
    if (item.type === 'text') return item.text ?? '';
    if (item.type === 'hardBreak') return '\n';
    const children =
      item.content?.map((child) => visit(child, depth + 1)).join('') ?? '';
    return (
      children +
      (['paragraph', 'heading', 'listItem'].includes(item.type) ? '\n' : '')
    );
  }
  if (value === null) return '';
  if (typeof value === 'string') return value;
  return visit(value, 0).trim();
}

export class ReadOnlySourceProvider implements SourceProvider {
  private readonly headers: Record<string, string>;
  constructor(
    private readonly config: {
      scope: Scope;
      repository: string;
      githubInstallationToken: string;
      jiraBearerToken: string;
      jiraOrigin: string;
      jiraCloudId: string;
      jiraProjectKeys: string[];
      approvedExternalProcessing: true;
    },
    private readonly http = new ReadOnlyHttp(),
  ) {
    ScopeSchema.parse(config.scope);
    if (!z.literal(true).safeParse(config.approvedExternalProcessing).success)
      throw new IntegrationError('scope');
    if (!z.uuid().safeParse(config.jiraCloudId).success)
      throw new IntegrationError('scope');
    const origin = new URL(config.jiraOrigin);
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(config.repository) ||
      origin.protocol !== 'https:' ||
      !/^[a-z0-9-]+\.atlassian\.net$/.test(origin.hostname) ||
      origin.origin !== config.jiraOrigin ||
      !config.githubInstallationToken ||
      !config.jiraBearerToken ||
      !config.jiraProjectKeys.every((key) => /^[A-Z][A-Z0-9]*$/.test(key))
    )
      throw new IntegrationError('scope');
    this.headers = {
      Authorization: `Bearer ${config.githubInstallationToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
  async getPullRequest(
    scope: Scope,
    number: number,
    expectedSha: string,
  ): Promise<PullRequestSource> {
    checkScope(scope, this.config.scope);
    if (
      !Number.isSafeInteger(number) ||
      number < 1 ||
      !ShaSchema.safeParse(expectedSha).success
    )
      throw new IntegrationError('scope');
    const root = `https://api.github.com/repos/${this.config.repository}/pulls/${String(number)}`;
    const parsed = GithubPrSchema.safeParse(
      await this.http.get(root, this.headers),
    );
    if (!parsed.success) throw new IntegrationError('malformed');
    const pr = parsed.data;
    if (
      pr.number !== number ||
      String(pr.base.repo.id) !== scope.repositoryId ||
      pr.head.sha !== expectedSha
    )
      throw new IntegrationError('scope');
    const files: PullRequestSource['files'] = [];
    for (let page = 1; page <= 21; page++) {
      const chunk = z
        .array(GithubFileSchema)
        .max(100)
        .safeParse(
          await this.http.get(
            `${root}/files?per_page=100&page=${String(page)}`,
            this.headers,
          ),
        );
      if (!chunk.success) throw new IntegrationError('malformed');
      if (files.length + chunk.data.length > 2000)
        throw new IntegrationError('malformed');
      files.push(
        ...chunk.data.map((file) => ({
          path: file.filename,
          status: file.status,
          patch: file.patch ?? null,
        })),
      );
      if (chunk.data.length < 100) {
        const current = GithubPrSchema.safeParse(
          await this.http.get(root, this.headers),
        );
        if (
          !current.success ||
          current.data.head.sha !== expectedSha ||
          current.data.base.sha !== pr.base.sha ||
          String(current.data.base.repo.id) !== scope.repositoryId
        )
          throw new IntegrationError('scope');
        return PullRequestSourceSchema.parse({
          scope,
          number,
          headSha: pr.head.sha,
          baseSha: pr.base.sha,
          title: pr.title,
          body: pr.body ?? '',
          url: pr.html_url,
          files,
        });
      }
    }
    throw new IntegrationError('malformed');
  }
  async getIssue(scope: Scope, key: string): Promise<IssueSource> {
    checkScope(scope, this.config.scope);
    if (
      !IssueSourceSchema.shape.key.safeParse(key).success ||
      !this.config.jiraProjectKeys.includes(key.split('-')[0] ?? '')
    )
      throw new IntegrationError('scope');
    const parsed = JiraIssueSchema.safeParse(
      await this.http.get(
        `https://api.atlassian.com/ex/jira/${this.config.jiraCloudId}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,updated`,
        {
          Authorization: `Bearer ${this.config.jiraBearerToken}`,
          Accept: 'application/json',
        },
      ),
    );
    if (!parsed.success) throw new IntegrationError('malformed');
    const issue = parsed.data;
    if (issue.key !== key) throw new IntegrationError('scope');
    return IssueSourceSchema.parse({
      scope,
      key,
      version: issue.fields.updated,
      title: issue.fields.summary,
      text: adfText(issue.fields.description),
      url: `${this.config.jiraOrigin}/browse/${encodeURIComponent(key)}`,
    });
  }
}

export class SyntheticSourceProvider implements SourceProvider {
  constructor(
    private readonly pr: PullRequestSource,
    private readonly issues: IssueSource[],
  ) {}
  getPullRequest(
    scope: Scope,
    number: number,
    expectedSha: string,
  ): Promise<PullRequestSource> {
    checkScope(scope, this.pr.scope);
    if (number !== this.pr.number || expectedSha !== this.pr.headSha)
      throw new IntegrationError('missing');
    return Promise.resolve(PullRequestSourceSchema.parse(this.pr));
  }
  getIssue(scope: Scope, key: string): Promise<IssueSource> {
    checkScope(scope, this.pr.scope);
    const issue = this.issues.find((item) => item.key === key);
    if (!issue) throw new IntegrationError('missing');
    return Promise.resolve(IssueSourceSchema.parse(issue));
  }
}
