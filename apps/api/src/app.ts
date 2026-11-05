import Fastify from 'fastify';
import { HealthResponseSchema, type HealthResponse } from '@cai/contracts';

export function buildApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 16_384,
    requestTimeout: 10_000,
  });

  app.get<{ Reply: HealthResponse }>('/health', () =>
    HealthResponseSchema.parse({ status: 'ok', service: 'cai-api' }),
  );

  return app;
}
