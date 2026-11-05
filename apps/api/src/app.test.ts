import { afterEach, describe, expect, it } from 'vitest';
import { HealthResponseSchema } from '@cai/contracts';
import { buildApp } from './app.js';

describe('health transport', () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  it('returns the exact runtime-valid liveness contract without database or keys', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(HealthResponseSchema.parse(response.json<unknown>())).toEqual({
      status: 'ok',
      service: 'cai-api',
    });
  });

  it('does not expose a model action or webhook endpoint', async () => {
    const app = buildApp();
    apps.push(app);
    for (const url of ['/health', '/webhooks/github', '/analyse']) {
      const response = await app.inject({ method: 'POST', url, payload: {} });
      expect(response.statusCode).toBe(404);
    }
  });
});
