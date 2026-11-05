import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  PublicationTargetSchema,
  type PublicationTarget,
} from '@cai/contracts';
import type { FetchTransport } from './http.js';

function syntheticPr(
  target: PublicationTarget,
  branch: string,
  headSha: string,
) {
  const repo = {
    id: Number(target.repositoryId),
    full_name: target.repository,
  };
  return {
    number: 7,
    html_url: `https://github.com/${target.repository}/pull/7`,
    state: 'open' as 'open' | 'closed',
    draft: true,
    merged_at: null as string | null,
    head: { ref: branch, sha: headSha, repo },
    base: { ref: target.baseBranch, sha: target.baseSha, repo },
  };
}

// In-memory HTTP fixture. It never invokes fetch or writes to a real repository.
// Fault controls make uncertain-write recovery and boundary tests reproducible.
export class SyntheticAutomationRepository {
  readonly requests: { method: string; path: string; body: unknown }[] = [];
  readonly target: PublicationTarget;
  baseSha: string;
  repositoryId: string;
  branch: string | null = null;
  headSha: string | null = null;
  content: string | null = null;
  pr: ReturnType<typeof syntheticPr> | null = null;
  existingBaseFile = false;
  extraFile = false;
  failAfterWrite: 'file' | 'pr' | null = null;
  constructor(target: PublicationTarget) {
    this.target = PublicationTargetSchema.parse(target);
    this.baseSha = target.baseSha;
    this.repositoryId = target.repositoryId;
  }
  get writes() {
    return this.requests.filter((request) => request.method !== 'GET');
  }
  readonly transport: FetchTransport = (url, init) =>
    Promise.resolve().then(() => {
      const parsed = new URL(url);
      const root = `/repos/${this.target.repository}`;
      if (
        parsed.origin !== 'https://api.github.com' ||
        (parsed.pathname !== root && !parsed.pathname.startsWith(root + '/'))
      )
        throw new Error('Synthetic target boundary violated.');
      const endpoint = parsed.pathname.slice(root.length);
      const method = init.method ?? 'GET';
      const body: unknown =
        typeof init.body === 'string' ? JSON.parse(init.body) : null;
      this.requests.push({ method, path: endpoint, body });
      const response = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), { status });
      if (method === 'GET') {
        if (!endpoint)
          return response({
            id: Number(this.repositoryId),
            full_name: this.target.repository,
          });
        if (endpoint === `/git/ref/heads/${this.target.baseBranch}`)
          return response({ object: { sha: this.baseSha } });
        if (
          this.branch !== null &&
          endpoint === `/git/ref/heads/${this.branch}`
        )
          return this.headSha
            ? response({ object: { sha: this.headSha } })
            : response({}, 404);
        if (endpoint.startsWith('/git/ref/heads/')) return response({}, 404);
        if (endpoint === `/contents/${this.target.path}`) {
          const ref = parsed.searchParams.get('ref');
          const content =
            ref === this.target.baseSha
              ? this.existingBaseFile
                ? 'existing test'
                : null
              : ref === this.headSha
                ? this.content
                : null;
          return content === null
            ? response({}, 404)
            : response({
                type: 'file',
                encoding: 'base64',
                content: Buffer.from(content).toString('base64'),
              });
        }
        if (
          this.headSha !== null &&
          endpoint === `/compare/${this.target.baseSha}...${this.headSha}`
        )
          return response({
            status: 'ahead',
            ahead_by: 1,
            behind_by: 0,
            total_commits: 1,
            files: [
              {
                filename: this.target.path,
                status: 'added',
                sha: createHash('sha1')
                  .update(
                    `blob ${String(Buffer.byteLength(this.content ?? ''))}\0`,
                  )
                  .update(this.content ?? '')
                  .digest('hex'),
              },
              ...(this.extraFile
                ? [{ filename: 'src/application.ts', status: 'modified' }]
                : []),
            ],
          });
        if (endpoint === '/pulls') return response(this.pr ? [this.pr] : []);
      }
      if (method === 'POST' && endpoint === '/git/refs') {
        const value = z
          .object({ ref: z.string(), sha: z.string() })
          .parse(body);
        if (
          this.branch ||
          !/^refs\/heads\/cai\/[a-f0-9-]{36}$/.test(value.ref) ||
          value.sha !== this.target.baseSha
        )
          return response({}, 422);
        this.branch = value.ref.slice('refs/heads/'.length);
        this.headSha = value.sha;
        return response({});
      }
      if (method === 'PUT' && endpoint === `/contents/${this.target.path}`) {
        const value = z
          .object({ content: z.string(), branch: z.string() })
          .parse(body);
        if (value.branch !== this.branch || this.content !== null)
          return response({}, 422);
        this.content = Buffer.from(value.content, 'base64').toString('utf8');
        this.headSha = 'c'.repeat(40);
        if (this.failAfterWrite === 'file') {
          this.failAfterWrite = null;
          throw new Error('Synthetic response lost after persisted commit.');
        }
        return response({});
      }
      if (method === 'POST' && endpoint === '/pulls') {
        const value = z
          .object({
            head: z.string(),
            base: z.string(),
            draft: z.literal(true),
          })
          .parse(body);
        if (
          value.head !== this.branch ||
          value.base !== this.target.baseBranch ||
          !this.headSha ||
          this.pr
        )
          return response({}, 422);
        this.pr = syntheticPr(this.target, value.head, this.headSha);
        if (this.failAfterWrite === 'pr') {
          this.failAfterWrite = null;
          throw new Error('Synthetic response lost after persisted PR.');
        }
        return response(this.pr);
      }
      throw new Error('Unexpected synthetic publication request.');
    });
}
