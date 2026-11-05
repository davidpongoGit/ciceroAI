import { describe, expect, it, vi } from 'vitest';
import { adfText, ReadOnlySourceProvider } from './index.js';
import {
  IntegrationError,
  ReadOnlyHttp,
  retryDelay,
  type FetchTransport,
} from './http.js';

const scope = {
  organisationId: '134da1cb-a441-4325-9e17-e2c93eb12bbc',
  repositoryId: '101',
};
const config = {
  scope,
  repository: 'synthetic/demo',
  githubInstallationToken: 'synthetic-gh-token',
  jiraBearerToken: 'synthetic-jira-token',
  jiraOrigin: 'https://synthetic.atlassian.net',
  jiraCloudId: scope.organisationId,
  jiraProjectKeys: ['DEMO'],
  approvedExternalProcessing: true as const,
};
const pr = {
  number: 1,
  title: 'DEMO-1 checkout',
  body: null,
  html_url: 'https://github.com/synthetic/demo/pull/1',
  head: { sha: 'a'.repeat(40) },
  base: { sha: 'b'.repeat(40), repo: { id: 101 } },
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });

describe('M2 source adapters with synthetic HTTP transports', () => {
  it('classifies an aborted request as a timeout without further retries', async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    const transport = vi.fn<FetchTransport>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('Synthetic timeout'));
            },
            { once: true },
          );
        }),
    );
    try {
      const request = new ReadOnlyHttp(transport).get(
        'https://api.github.com/test',
        {},
      );
      controller.abort();
      await expect(request).rejects.toMatchObject({ code: 'timeout' });
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });
  it('paginates GitHub files and preserves exact requested SHAs without write methods', async () => {
    const calls: RequestInit[] = [];
    const transport: FetchTransport = (url, init) => {
      calls.push(init);
      if (new URL(url).searchParams.get('page') === '1')
        return Promise.resolve(
          json(
            Array.from({ length: 100 }, (_, i) => ({
              filename: `src/file-${String(i)}.ts`,
              status: 'modified',
              patch: '+synthetic',
            })),
          ),
        );
      if (new URL(url).searchParams.get('page') === '2')
        return Promise.resolve(json([]));
      return Promise.resolve(json(pr));
    };
    const source = await new ReadOnlySourceProvider(
      config,
      new ReadOnlyHttp(transport),
    ).getPullRequest(scope, 1, pr.head.sha);
    expect(source.files).toHaveLength(100);
    expect(source.headSha).toBe(pr.head.sha);
    expect(source.scope).toEqual(scope);
    expect(
      calls.every(
        (call) =>
          call.method === 'GET' &&
          call.redirect === 'error' &&
          call.signal instanceof AbortSignal,
      ),
    ).toBe(true);
  });
  it('extracts Jira ADF, source version and key under authorised project scope', async () => {
    const transport = vi.fn<FetchTransport>().mockResolvedValue(
      json({
        key: 'DEMO-1',
        fields: {
          summary: 'Synthetic checkout',
          updated: '2026-11-05T00:00:00Z',
          description: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'AC-1: Reject expired cards.' },
                ],
              },
            ],
          },
        },
      }),
    );
    const provider = new ReadOnlySourceProvider(
      config,
      new ReadOnlyHttp(transport),
    );
    const issue = await provider.getIssue(scope, 'DEMO-1');
    expect(issue.text).toBe('AC-1: Reject expired cards.');
    expect(issue.version).toBe('2026-11-05T00:00:00Z');
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining('/ex/jira/'),
      expect.objectContaining({ method: 'GET' }),
    );
    await expect(provider.getIssue(scope, 'OTHER-1')).rejects.toMatchObject({
      code: 'scope',
    });
  });
  it.each([401, 403, 404])(
    'stops immediately for denied/missing response %i',
    async (status) => {
      const transport = vi
        .fn<FetchTransport>()
        .mockResolvedValue(new Response('', { status }));
      await expect(
        new ReadOnlyHttp(transport).get('https://api.github.com/test', {}),
      ).rejects.toMatchObject({ code: status === 404 ? 'missing' : 'denied' });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('honours short Retry-After and delegates long delays without hammering the provider', async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'retry-after': '0' } }),
      )
      .mockResolvedValueOnce(json({ ok: true }));
    const wait = vi
      .fn<(ms: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    expect(
      await new ReadOnlyHttp(transport, wait).get(
        'https://api.github.com/test',
        {},
      ),
    ).toEqual({ ok: true });
    expect(wait).toHaveBeenCalledWith(250);
    const long = vi
      .fn<FetchTransport>()
      .mockResolvedValue(
        new Response('', { status: 429, headers: { 'retry-after': '60' } }),
      );
    await expect(
      new ReadOnlyHttp(long, wait).get('https://api.github.com/test', {}),
    ).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 60_000 });
    expect(long).toHaveBeenCalledTimes(1);
    expect(
      retryDelay(
        'Thu, 05 Nov 2026 00:00:01 GMT',
        Date.parse('2026-11-05T00:00:00Z'),
      ),
    ).toBe(1000);
  });
  it('bounds retries and rejects malformed or oversized JSON', async () => {
    const failing = vi
      .fn<FetchTransport>()
      .mockRejectedValue(new Error('synthetic provider failure with secret'));
    const wait = vi
      .fn<(ms: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    await expect(
      new ReadOnlyHttp(failing, wait).get('https://api.github.com/test', {}),
    ).rejects.toThrow('Integration request failed: unavailable.');
    expect(failing).toHaveBeenCalledTimes(3);
    for (const data of ['not JSON', 'x'.repeat(1_048_577)]) {
      const transport: FetchTransport = () =>
        Promise.resolve(new Response(data));
      await expect(
        new ReadOnlyHttp(transport).get('https://api.github.com/test', {}),
      ).rejects.toMatchObject({ code: 'malformed' });
    }
  });
  it('blocks wrong tenant/repo, wrong commit and unapproved endpoints', async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockImplementation(() => Promise.resolve(json(pr)));
    const provider = new ReadOnlySourceProvider(
      config,
      new ReadOnlyHttp(transport),
    );
    await expect(
      provider.getPullRequest(
        { ...scope, repositoryId: '102' },
        1,
        pr.head.sha,
      ),
    ).rejects.toMatchObject({ code: 'scope' });
    expect(transport).not.toHaveBeenCalled();
    await expect(
      provider.getPullRequest(scope, 1, 'c'.repeat(40)),
    ).rejects.toMatchObject({ code: 'scope' });
    expect(
      () =>
        new ReadOnlySourceProvider({
          ...config,
          jiraOrigin: 'https://unapproved.example',
        }),
    ).toThrow(IntegrationError);
    expect(adfText(null)).toBe('');
  });
});
