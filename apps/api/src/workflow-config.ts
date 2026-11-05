import { z } from 'zod';
import { ScopeSchema } from '@cai/contracts';
import { readDatabaseUrl } from '@cai/database';

export function readWorkflowConfig(env: NodeJS.ProcessEnv) {
  if (env.WORKFLOW_ENABLED !== 'true') return null;
  const schema = z.object({
    ORGANISATION_ID: z.uuid(),
    REPOSITORY_ID: ScopeSchema.shape.repositoryId,
    INSTALLATION_ID: z.string().regex(/^[1-9][0-9]{0,19}$/),
    WEBHOOK_SECRET: z
      .string()
      .min(32)
      .refine((value) => !value.includes('CHANGE_ME')),
    API_TOKEN: z
      .string()
      .min(32)
      .refine((value) => !value.includes('CHANGE_ME')),
  });
  const config = schema.safeParse(env);
  if (!config.success)
    throw new Error(
      'Invalid workflow configuration. Set scoped identity and independent secrets of at least 32 characters.',
    );
  if (config.data.WEBHOOK_SECRET === config.data.API_TOKEN)
    throw new Error('Webhook and API credentials must be different.');
  return {
    scope: {
      organisationId: config.data.ORGANISATION_ID,
      repositoryId: config.data.REPOSITORY_ID,
    },
    installationId: config.data.INSTALLATION_ID,
    webhookSecret: config.data.WEBHOOK_SECRET,
    apiToken: config.data.API_TOKEN,
    databaseUrl: readDatabaseUrl(env.DATABASE_URL),
  };
}
