import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Scope, type TestPlan } from '@cai/contracts';
import { LocalArtifactStore, UnavailableSandbox } from './index.js';

async function cleanup(root: string, parent: string): Promise<void> {
  const resolved = await realpath(root);
  if (
    path.dirname(resolved) !== parent ||
    !path.basename(resolved).startsWith('cai-artifacts-')
  )
    throw new Error('Cleanup target outside expected temp parent.');
  await rm(resolved, { recursive: true, force: true });
}
describe('M7 scoped artifacts and execution boundary', () => {
  it('checks object ownership/checksum and deletes only the selected scoped object', async () => {
    const parent = await realpath(tmpdir());
    const root = await mkdtemp(path.join(parent, 'cai-artifacts-'));
    const scope: Scope = { organisationId: randomUUID(), repositoryId: '101' };
    const store = new LocalArtifactStore(root);
    try {
      const ref = await store.put(scope, Buffer.from('synthetic report'), {
        mediaType: 'text/plain',
        sensitivity: 'synthetic',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(Buffer.from(await store.get(scope, ref)).toString()).toBe(
        'synthetic report',
      );
      await expect(
        store.get({ ...scope, organisationId: randomUUID() }, ref),
      ).rejects.toThrow('scope mismatch');
      await expect(
        store.get(scope, { ...ref, checksum: 'a'.repeat(64) }),
      ).rejects.toThrow('integrity');
      await store.delete(scope, ref);
      await expect(store.get(scope, ref)).rejects.toThrow();
    } finally {
      await cleanup(root, parent);
    }
  });
  it('never falls back to host execution for untrusted repositories', async () => {
    const plan: TestPlan = {
      id: randomUUID(),
      scope: { organisationId: randomUUID(), repositoryId: '101' },
      assessmentId: randomUUID(),
      featureId: randomUUID(),
      operation: 'execute',
      strategy: 'create',
      level: 'e2e',
      appSha: 'a'.repeat(40),
      testRevisionSha: 'b'.repeat(40),
      environment: 'staging',
      criterionIds: ['AC-1'],
      draftHash: 'c'.repeat(64),
      budget: { maxRunnerSeconds: 1, maxArtifactBytes: 1000 },
      policyVersion: 'supervised-v1',
    };
    await expect(
      new UnavailableSandbox().executeUntrusted(plan, 'untrusted/path'),
    ).rejects.toThrow('No host fallback');
  });
});
