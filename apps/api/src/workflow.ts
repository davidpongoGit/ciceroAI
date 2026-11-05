import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PullRequestEventSchema,
  ScopeSchema,
  type Scope,
  type WorkflowStore,
} from '@cai/contracts';
import { DeliveryConflict } from '@cai/database';

export interface WorkflowOptions {
  scope: Scope;
  installationId: string;
  webhookSecret: string;
  apiToken: string;
  store: WorkflowStore;
}
export function constantTimeEqual(left: string, right: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(left).digest(),
    createHash('sha256').update(right).digest(),
  );
}
export function validSignature(
  body: Buffer,
  signature: unknown,
  secret: string,
): boolean {
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature))
    return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}
export async function workflowRoutes(
  app: FastifyInstance,
  options: WorkflowOptions,
): Promise<void> {
  ScopeSchema.parse(options.scope);
  if (
    options.webhookSecret.length < 32 ||
    options.apiToken.length < 32 ||
    !/^[1-9][0-9]*$/.test(options.installationId)
  )
    throw new Error('Invalid workflow security configuration.');
  await app.register((webhooks, _options, done) => {
    webhooks.removeContentTypeParser('application/json');
    webhooks.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 262_144 },
      (_request, body, done) => {
        done(null, body);
      },
    );
    webhooks.post(
      '/webhooks/github',
      { bodyLimit: 262_144 },
      async (request, reply) => {
        const raw: unknown = request.body;
        if (
          !Buffer.isBuffer(raw) ||
          !validSignature(
            raw,
            request.headers['x-hub-signature-256'],
            options.webhookSecret,
          )
        )
          return reply.code(401).send({ error: 'Invalid webhook signature.' });
        const delivery = z
          .uuid()
          .safeParse(request.headers['x-github-delivery']);
        if (!delivery.success)
          return reply.code(400).send({ error: 'Invalid delivery ID.' });
        if (request.headers['x-github-event'] !== 'pull_request')
          return reply.code(202).send({ ignored: true });
        let value: unknown;
        try {
          value = JSON.parse(raw.toString('utf8')) as unknown;
        } catch {
          return reply.code(400).send({ error: 'Invalid JSON.' });
        }
        const parsed = PullRequestEventSchema.safeParse(value);
        if (!parsed.success)
          return reply
            .code(400)
            .send({ error: 'Unsupported pull request payload.' });
        const event = parsed.data;
        if (
          String(event.repository.id) !== options.scope.repositoryId ||
          String(event.installation.id) !== options.installationId
        )
          return reply
            .code(403)
            .send({ error: 'Event outside configured scope.' });
        try {
          const result = await options.store.intake({
            scope: options.scope,
            installationId: options.installationId,
            deliveryId: delivery.data,
            sourceHash: createHash('sha256').update(raw).digest('hex'),
            event,
          });
          return await reply.code(202).send(result);
        } catch (error) {
          if (error instanceof DeliveryConflict)
            return reply.code(409).send({ error: error.message });
          return reply
            .code(503)
            .send({ error: 'Intake unavailable; retry the same delivery.' });
        }
      },
    );
    done();
  });
  app.get<{ Params: { id: string } }>(
    '/assessments/:id',
    async (request, reply) => {
      const auth = request.headers.authorization;
      if (
        typeof auth !== 'string' ||
        !constantTimeEqual(auth, `Bearer ${options.apiToken}`)
      )
        return reply.code(401).send({ error: 'Authentication required.' });
      const id = z.uuid().safeParse(request.params.id);
      if (!id.success)
        return reply.code(400).send({ error: 'Invalid assessment ID.' });
      try {
        const assessment = await options.store.get(options.scope, id.data);
        if (!assessment)
          return await reply.code(404).send({ error: 'Assessment not found.' });
        return assessment;
      } catch {
        return reply
          .code(503)
          .send({ error: 'Assessment storage unavailable.' });
      }
    },
  );
}
