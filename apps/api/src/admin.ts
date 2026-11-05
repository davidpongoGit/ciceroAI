import { randomBytes } from 'node:crypto';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  TestPlanSchema,
  type Principal,
  type ArtifactStore,
} from '@cai/contracts';
import { createDatabase } from '@cai/database';
import { PolicyDenied, requireCapability } from '@cai/policy';
import { constantTimeEqual } from './workflow.js';
import { dashboard } from './dashboard.js';

export interface AdminOptions {
  database: ReturnType<typeof createDatabase>;
  principal: Principal;
  apiToken: string;
  artifactStore?: ArtifactStore;
}
export const adminRoutes: FastifyPluginCallback<AdminOptions> = (
  app,
  options,
  done,
) => {
  const { database, principal } = options;
  app.get('/', (_request, reply) => {
    const nonce = randomBytes(18).toString('base64');
    return reply
      .header(
        'content-security-policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      )
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .type('text/html')
      .send(dashboard(nonce));
  });
  app.register((api, _settings, ready) => {
    api.addHook('onRequest', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const auth = request.headers.authorization;
      if (
        typeof auth !== 'string' ||
        !constantTimeEqual(auth, `Bearer ${options.apiToken}`)
      )
        await reply.code(401).send({ error: 'Authentication required.' });
    });
    api.setErrorHandler((error, _request, reply) => {
      void reply
        .code(
          error instanceof PolicyDenied
            ? 403
            : error instanceof z.ZodError
              ? 400
              : 503,
        )
        .send({
          error:
            error instanceof PolicyDenied
              ? error.message
              : 'The operation could not be completed. Check current source versions and configuration.',
        });
    });
    api.get('/api/overview', async () => database.plans.overview(principal));
    api.get('/api/plans', async () => database.plans.list(principal));
    api.get('/api/usage', async () => database.actions.usage(principal));
    api.get('/api/notifications', async () =>
      database.monitor.notifications(principal),
    );
    api.get<{ Params: { id: string } }>(
      '/api/artifacts/:id',
      async (request, reply) => {
        const reference = await database.artifacts.reference(
          principal,
          z.uuid().parse(request.params.id),
        );
        if (!reference)
          return reply
            .code(404)
            .send({ error: 'Artifact not found or expired.' });
        if (!options.artifactStore)
          return reply
            .code(503)
            .send({ error: 'Artifact storage is not configured.' });
        return reply
          .header('x-content-type-options', 'nosniff')
          .header(
            'content-disposition',
            `attachment; filename="${reference.id}"`,
          )
          .type(reference.mediaType)
          .send(
            Buffer.from(
              await options.artifactStore.get(principal.scope, reference),
            ),
          );
      },
    );
    api.get<{ Params: { id: string } }>(
      '/api/reports/:id',
      async (request, reply) => {
        requireCapability(principal, principal.scope, 'assessment.read');
        const report = await database.knowledge.getReport(
          principal.scope,
          z.uuid().parse(request.params.id),
        );
        return report
          ? {
              ...report,
              features: await database.graph.assessmentFeatures(
                principal.scope,
                request.params.id,
              ),
              runs: await database.coverage.recordedRuns(
                principal.scope,
                request.params.id,
              ),
              artifacts: await database.artifacts.list(
                principal,
                z.uuid().parse(request.params.id),
              ),
            }
          : reply.code(404).send({ error: 'Report not found.' });
      },
    );
    api.post('/api/plans', async (request, reply) => {
      const id = await database.plans.create(
        principal,
        TestPlanSchema.parse(request.body),
      );
      return reply.code(201).send({ id });
    });
    api.post<{ Params: { id: string } }>(
      '/api/plans/:id/decision',
      async (request) => {
        const body = z
          .strictObject({
            decision: z.enum(['approved', 'rejected', 'revoked']),
            expiresAt: z.iso.datetime().optional(),
          })
          .parse(request.body);
        await database.plans.decide(
          principal,
          z.uuid().parse(request.params.id),
          body.decision,
          body.expiresAt,
        );
        return { recorded: true };
      },
    );
    api.get<{ Params: { id: string } }>(
      '/api/features/:id/readiness',
      async (request, reply) => {
        requireCapability(principal, principal.scope, 'assessment.read');
        const readiness = await database.graph.readiness(
          principal.scope,
          z.uuid().parse(request.params.id),
        );
        return (
          readiness ?? reply.code(404).send({ error: 'Feature not found.' })
        );
      },
    );
    ready();
  });
  done();
};
