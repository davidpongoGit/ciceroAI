import Fastify from 'fastify';
import { HealthResponseSchema, type HealthResponse } from '@cai/contracts';
import { workflowRoutes, type WorkflowOptions } from './workflow.js';
import { adminRoutes, type AdminOptions } from './admin.js';

export function buildApp(options?: {
  workflow: WorkflowOptions;
  admin?: AdminOptions;
}) {
  const app = Fastify({
    logger: false,
    bodyLimit: 16_384,
    requestTimeout: 10_000,
  });

  app.get<{ Reply: HealthResponse }>('/health', () =>
    HealthResponseSchema.parse({ status: 'ok', service: 'cai-api' }),
  );
  app.setErrorHandler((error, _request, reply) => {
    const code =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : 500;
    const status =
      typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    void reply.code(status).send({
      error:
        status === 413
          ? 'Payload too large.'
          : 'Request could not be processed.',
    });
  });
  if (options) void app.register(workflowRoutes, options.workflow);
  if (options?.admin) void app.register(adminRoutes, options.admin);

  return app;
}
