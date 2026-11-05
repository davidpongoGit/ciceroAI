import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TestPlan } from '@cai/contracts';
import { GitHubDraftPublisher } from './publisher.js';
import { SyntheticAutomationRepository } from './synthetic-publication.js';

function fixture() {
  const content =
    "import {test,expect} from '@playwright/test';\ntest('reject expired cards', async ({page}) => { await expect(page.getByTestId('card-error')).toHaveText('Card expired'); });\n";
  const scope = { organisationId: randomUUID(), repositoryId: '101' };
  const target = {
    provider: 'github' as const,
    repositoryId: '202',
    repository: 'synthetic/playwright',
    baseBranch: 'main',
    baseSha: 'd'.repeat(40),
    path: 'tests/expired-card.spec.ts',
  };
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
    environment: 'synthetic-checkout',
    criterionIds: ['AC-1'],
    draftHash: createHash('sha256').update(content).digest('hex'),
    budget: { maxRunnerSeconds: 30, maxArtifactBytes: 10000 },
    policyVersion: 'supervised-v1',
    publication: target,
  };
  const remote = new SyntheticAutomationRepository(target);
  const config = {
    scope,
    applicationRepository: 'synthetic/application',
    automationRepository: target,
    installationToken: 'synthetic-automation-only-token',
    approvedExternalWrites: true as const,
  };
  const authorize = vi.fn<() => Promise<TestPlan>>().mockResolvedValue(plan);
  const request = {
    plan,
    content,
    provenance: ['jira:DEMO-1@v1#source-hash'],
    authorize,
  };
  return {
    plan,
    target,
    remote,
    config,
    request,
    authorize,
    publisher: new GitHubDraftPublisher(config, remote.transport),
  };
}

describe('Separate automation repository publication with synthetic HTTP only', () => {
  it('creates a test-only draft in the automation repo from its own base, then reconciles without writes', async () => {
    const f = fixture();
    expect(f.target.baseSha).not.toBe(f.plan.appSha);
    expect((await f.publisher.publish(f.request)).reused).toBe(false);
    expect(
      f.remote.writes.map((request) => request.method + ' ' + request.path),
    ).toEqual([
      'POST /git/refs',
      'PUT /contents/tests/expired-card.spec.ts',
      'POST /pulls',
    ]);
    expect(f.remote.writes[0]?.body).toEqual({
      ref: `refs/heads/cai/${f.plan.id}`,
      sha: f.target.baseSha,
    });
    expect(f.remote.writes[1]?.body).toMatchObject({
      branch: `cai/${f.plan.id}`,
    });
    expect(f.remote.writes[2]?.body).toMatchObject({
      draft: true,
      base: 'main',
      head: `cai/${f.plan.id}`,
    });
    expect(JSON.stringify(f.remote.writes[2]?.body)).toContain(f.plan.appSha);
    expect(JSON.stringify(f.remote.writes[2]?.body)).toContain(
      f.target.baseSha,
    );
    expect((await f.publisher.publish(f.request)).reused).toBe(true);
    expect(f.remote.writes).toHaveLength(3);
    expect(
      f.remote.requests.every((request) => !request.path.includes('merge')),
    ).toBe(true);
  });
  it('rejects the application repo by numeric identity or case-insensitive name before HTTP', () => {
    const f = fixture();
    expect(
      () =>
        new GitHubDraftPublisher(
          {
            ...f.config,
            automationRepository: { ...f.target, repositoryId: '101' },
          },
          f.remote.transport,
        ),
    ).toThrow('denied');
    expect(
      () =>
        new GitHubDraftPublisher(
          { ...f.config, applicationRepository: 'SYNTHETIC/PLAYWRIGHT' },
          f.remote.transport,
        ),
    ).toThrow('denied');
    expect(f.remote.requests).toHaveLength(0);
  });
  it.each([
    'missing target',
    'different destination',
    'traversal',
    'application file',
    'different bytes',
  ])('rejects %s without HTTP', async (scenario) => {
    const f = fixture();
    let plan = f.plan;
    if (scenario === 'missing target')
      plan = { ...plan, publication: undefined };
    if (scenario === 'different destination')
      plan = { ...plan, publication: { ...f.target, repositoryId: '303' } };
    if (scenario === 'traversal')
      plan = {
        ...plan,
        publication: { ...f.target, path: 'tests/../src/payment.spec.ts' },
      };
    if (scenario === 'application file')
      plan = { ...plan, publication: { ...f.target, path: 'src/payment.ts' } };
    await expect(
      f.publisher.publish({
        ...f.request,
        plan,
        ...(scenario === 'different bytes'
          ? { content: f.request.content + 'changed' }
          : {}),
      }),
    ).rejects.toThrow();
    expect(f.remote.requests).toHaveLength(0);
  });
  it('rejects a different approved destination hash and a failed approval before HTTP', async () => {
    const f = fixture();
    f.authorize.mockResolvedValue({
      ...f.plan,
      publication: { ...f.target, baseSha: 'e'.repeat(40) },
    });
    await expect(f.publisher.publish(f.request)).rejects.toThrow('denied');
    f.authorize.mockRejectedValue(new Error('Approval revoked.'));
    await expect(f.publisher.publish(f.request)).rejects.toThrow('revoked');
    expect(f.remote.requests).toHaveLength(0);
  });
  it('denies a wrong remote identity or an existing base test before writes', async () => {
    const f = fixture();
    f.remote.repositoryId = '101';
    await expect(f.publisher.publish(f.request)).rejects.toThrow('denied');
    f.remote.repositoryId = '202';
    f.remote.existingBaseFile = true;
    await expect(f.publisher.publish(f.request)).rejects.toThrow('denied');
    expect(f.remote.writes).toHaveLength(0);
  });
  it('stops after branch creation if the automation base moves', async () => {
    const f = fixture();
    const publisher = new GitHubDraftPublisher(f.config, async (url, init) => {
      const response = await f.remote.transport(url, init);
      if (init.method === 'POST' && url.endsWith('/git/refs'))
        f.remote.baseSha = 'e'.repeat(40);
      return response;
    });
    await expect(publisher.publish(f.request)).rejects.toThrow('denied');
    expect(f.remote.writes).toHaveLength(1);
  });
  it('rechecks revocation before later writes', async () => {
    const f = fixture();
    f.authorize.mockImplementation(() => {
      if (f.remote.writes.length)
        return Promise.reject(new Error('Approval revoked.'));
      return Promise.resolve(f.plan);
    });
    await expect(f.publisher.publish(f.request)).rejects.toThrow('revoked');
    expect(f.remote.writes).toHaveLength(1);
  });
  it.each(['file', 'pr'] as const)(
    'reconciles an uncertain %s write without duplicate branches, commits or PRs',
    async (stage) => {
      const f = fixture();
      f.remote.failAfterWrite = stage;
      await expect(f.publisher.publish(f.request)).rejects.toThrow(
        'unavailable',
      );
      const result = await f.publisher.publish(f.request);
      expect(result.reused).toBe(stage === 'pr');
      expect(f.remote.writes).toHaveLength(3);
    },
  );
  it('does not publish a diff containing an application file', async () => {
    const f = fixture();
    f.remote.extraFile = true;
    await expect(f.publisher.publish(f.request)).rejects.toThrow();
    expect(f.remote.writes).toHaveLength(2);
    expect(f.remote.pr).toBeNull();
  });
  it('refuses tampered content and developer-closed proposals without reopening or replacing them', async () => {
    const f = fixture();
    await f.publisher.publish(f.request);
    const content = f.remote.content;
    f.remote.content = (f.remote.content ?? '') + 'tampered';
    await expect(f.publisher.publish(f.request)).rejects.toThrow('denied');
    f.remote.content = content;
    if (!f.remote.pr) throw new Error('Expected synthetic PR.');
    f.remote.pr.state = 'closed';
    await expect(f.publisher.publish(f.request)).rejects.toThrow('denied');
    expect(f.remote.writes).toHaveLength(3);
  });
  it('rejects a no-op test even if its bytes are approved', async () => {
    const f = fixture();
    const content =
      "import {test,expect} from '@playwright/test'; test('noop',()=>{ expect(true).toBe(true); });";
    const plan = {
      ...f.plan,
      draftHash: createHash('sha256').update(content).digest('hex'),
    };
    f.authorize.mockResolvedValue(plan);
    await expect(
      f.publisher.publish({ ...f.request, plan, content }),
    ).rejects.toThrow('denied');
    expect(f.remote.requests).toHaveLength(0);
  });
});
