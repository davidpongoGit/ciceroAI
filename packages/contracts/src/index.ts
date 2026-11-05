import { z } from 'zod';

export const HealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('cai-api'),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export * from './model.js';
export * from './workflow.js';
export * from './knowledge.js';
export * from './readiness.js';
export * from './coverage.js';
export * from './plans.js';
export * from './artifacts.js';
