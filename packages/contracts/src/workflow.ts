import { z } from 'zod';
import { AnalysisResultSchema, AnalysisTaskSchema } from './model.js';

export const ScopeSchema = z.strictObject({
  organisationId: z.uuid(),
  repositoryId: z.string().regex(/^[1-9][0-9]{0,19}$/),
});
export type Scope = z.infer<typeof ScopeSchema>;
export const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const PullRequestEventSchema = z.object({
  action: z.enum(['opened', 'synchronize', 'reopened', 'closed']),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({
    id: z.number().int().positive(),
    full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({ sha: ShaSchema }),
    base: z.object({ sha: ShaSchema }),
    merged: z.boolean().default(false),
  }),
});
export type PullRequestEvent = z.infer<typeof PullRequestEventSchema>;
export const AssessmentSchema = z.strictObject({
  id: z.uuid(),
  organisationId: z.uuid(),
  repositoryId: z.string(),
  correlationId: z.uuid(),
  status: z.enum(['queued', 'running', 'completed', 'dead_letter']),
  attempts: z.number().int().nonnegative(),
  headSha: ShaSchema,
  task: AnalysisTaskSchema,
  result: AnalysisResultSchema.nullable(),
  lastError: z
    .enum([
      'provider_failed',
      'invalid_output',
      'lease_expired',
      'retry_exceeds_policy',
    ])
    .nullable(),
});
export type Assessment = z.infer<typeof AssessmentSchema>;
export interface IntakeEvent {
  scope: Scope;
  installationId: string;
  deliveryId: string;
  sourceHash: string;
  event: PullRequestEvent;
}
export interface IntakeResult {
  id: string;
  correlationId: string;
  duplicate: boolean;
}
export interface Lease {
  assessment: Assessment;
  token: string;
}
export type FailureReason = NonNullable<Assessment['lastError']>;
export interface WorkflowStore {
  intake(input: IntakeEvent): Promise<IntakeResult>;
  get(scope: Scope, id: string): Promise<Assessment | null>;
  claim(scope: Scope, leaseMs?: number): Promise<Lease | null>;
  complete(scope: Scope, lease: Lease, result: unknown): Promise<boolean>;
  fail(
    scope: Scope,
    lease: Lease,
    reason: FailureReason,
    delayMs?: number,
  ): Promise<boolean>;
}
