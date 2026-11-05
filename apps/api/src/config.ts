import { z } from 'zod';

const ApiConfigSchema = z.object({
  HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export function readApiConfig(env: NodeJS.ProcessEnv) {
  const result = ApiConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      'Invalid API configuration: HOST must be 127.0.0.1 and PORT must be 1–65535.',
    );
  }
  return { host: result.data.HOST, port: result.data.PORT };
}
