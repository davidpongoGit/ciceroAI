import { z } from 'zod';
import { ScopeSchema, ShaSchema } from './workflow.js';

export const PublicationTargetSchema = z.strictObject({
  provider: z.literal('github'),
  repositoryId: z.string().regex(/^[1-9][0-9]*$/),
  repository: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/),
  baseBranch: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  baseSha: ShaSchema,
  path: z
    .string()
    .max(500)
    .regex(/^tests\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.spec\.ts$/),
});
export type PublicationTarget = z.infer<typeof PublicationTargetSchema>;

export const TestPlanSchema = z
  .strictObject({
    id: z.uuid(),
    scope: ScopeSchema,
    assessmentId: z.uuid(),
    featureId: z.uuid(),
    operation: z.enum(['draft', 'execute', 'create_pr']),
    strategy: z.enum(['reuse', 'update', 'create']),
    level: z.enum(['unit', 'api', 'e2e']),
    appSha: ShaSchema,
    testRevisionSha: ShaSchema,
    environment: z.string().min(1).max(100),
    criterionIds: z.array(z.string().min(1).max(300)).min(1).max(100),
    draftHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    budget: z.strictObject({
      maxRunnerSeconds: z.number().int().min(1).max(60),
      maxArtifactBytes: z.number().int().min(1).max(5_242_880),
    }),
    policyVersion: z.literal('supervised-v1'),
    // Optional for reading legacy plans. Legacy create_pr plans cannot be approved
    // or published until replaced by a new immutable plan with an explicit target.
    publication: PublicationTargetSchema.optional(),
  })
  .refine(
    (plan) =>
      !plan.publication ||
      (plan.operation === 'create_pr' &&
        plan.publication.repositoryId !== plan.scope.repositoryId),
    'Publication requires a separate automation repository.',
  );
export type TestPlan = z.infer<typeof TestPlanSchema>;
export const PrincipalSchema = z.strictObject({
  id: z.string().min(1).max(100),
  scope: ScopeSchema,
  capabilities: z.array(
    z.enum([
      'assessment.read',
      'plan.create',
      'plan.approve',
      'plan.revoke',
      'draft',
      'execute',
      'create_pr',
      'data.manage',
    ]),
  ),
});
export type Principal = z.infer<typeof PrincipalSchema>;
export type Capability = Principal['capabilities'][number];
