import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TestPlan } from '@cai/contracts';
import { GitHubDraftPublisher } from './publisher.js';
import type { FetchTransport } from './http.js';

describe('M7 GitHub draft publisher with synthetic HTTP only', () => {
  it('creates only the planned branch/file/draft PR and reconciles a repeated request without writes', async () => {
    const content = 'synthetic test draft';
    const scope = { organisationId: randomUUID(), repositoryId: '101' };
    const plan: TestPlan = {
      id: randomUUID(),
      scope,
      assessmentId: randomUUID(),
      featureId: randomUUID(),
      operation: 'create_pr',
      strategy: 'create',
      level: 'e2e',
      appSha: 'a'.repeat(40),
      testRevisionSha: 'b'.repeat(40),
      environment: 'synthetic-staging',
      criterionIds: ['AC-1'],
      draftHash: createHash('sha256').update(content).digest('hex'),
      budget: { maxRunnerSeconds: 30, maxArtifactBytes: 1000 },
      policyVersion: 'supervised-v1',
    };
    let branchExists = false;
    let fileExists = false;
    let prExists = false;
    const writes: string[] = [];
    const branch = `cai/${plan.id}`;
    const pr = {
      number: 7,
      html_url: 'https://github.com/synthetic/demo/pull/7',
      head: { ref: branch },
      base: { ref: 'main' },
    };
    const response = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status });
    const transport: FetchTransport = (url, init) => {
      const endpoint = new URL(url).pathname.replace(
        '/repos/synthetic/demo',
        '',
      );
      if (init.method === 'GET') {
        if (endpoint === '') return Promise.resolve(response({ id: 101 }));
        if (endpoint === '/git/ref/heads/main')
          return Promise.resolve(response({ object: { sha: plan.appSha } }));
        if (endpoint === `/git/ref/heads/${branch}`)
          return Promise.resolve(
            branchExists
              ? response({
                  object: { sha: fileExists ? 'c'.repeat(40) : plan.appSha },
                })
              : response({}, 404),
          );
        if (endpoint === '/contents/tests/new.spec.ts')
          return Promise.resolve(
            fileExists
              ? response({
                  encoding: 'base64',
                  content: Buffer.from(content).toString('base64'),
                })
              : response({}, 404),
          );
        if (endpoint.startsWith('/compare/'))
          return Promise.resolve(
            response({
              files: [{ filename: 'tests/new.spec.ts', status: 'added' }],
            }),
          );
        if (endpoint === '/pulls')
          return Promise.resolve(response(prExists ? [pr] : []));
      }
      writes.push(`${init.method ?? ''} ${endpoint}`);
      if (endpoint === '/git/refs') {
        branchExists = true;
        return Promise.resolve(response({}));
      }
      if (endpoint === '/contents/tests/new.spec.ts') {
        fileExists = true;
        return Promise.resolve(response({}));
      }
      if (endpoint === '/pulls') {
        prExists = true;
        return Promise.resolve(response(pr));
      }
      return Promise.reject(new Error('Unexpected synthetic request.'));
    };
    const publisher = new GitHubDraftPublisher(
      {
        scope,
        repository: 'synthetic/demo',
        baseBranch: 'main',
        installationToken: 'synthetic-token',
        approvedExternalWrites: true,
      },
      transport,
    );
    const authorize = vi.fn<() => Promise<TestPlan>>().mockResolvedValue(plan);
    const request = {
      plan,
      path: 'tests/new.spec.ts',
      content,
      provenance: ['jira:DEMO-1@v1'],
      authorize,
    };
    expect((await publisher.publish(request)).reused).toBe(false);
    expect(writes).toEqual([
      'POST /git/refs',
      'PUT /contents/tests/new.spec.ts',
      'POST /pulls',
    ]);
    expect((await publisher.publish(request)).reused).toBe(true);
    expect(writes).toHaveLength(3);
    await expect(
      publisher.publish({ ...request, path: '../escape.spec.ts' }),
    ).rejects.toThrow('denied');
    authorize.mockRejectedValue(new Error('Approval revoked.'));
    await expect(publisher.publish(request)).rejects.toThrow('revoked');
    expect(writes).toHaveLength(3);
  });
});
