import { z } from 'zod';
import { ScopeSchema, ShaSchema } from './workflow.js';

export const SourceReferenceSchema = z.strictObject({
  sourceKey: z.string().min(1).max(300),
  version: z.string().min(1).max(200),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export const SourceSnapshotSchema = z.strictObject({
  scope: ScopeSchema,
  reference: SourceReferenceSchema,
  kind: z.enum(['github', 'jira']),
  canonicalUrl: z.url(),
  title: z.string().max(1000),
  text: z.string().max(100_000),
  observedAt: z.iso.datetime(),
  redactions: z.number().int().nonnegative().default(0),
});
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
export const RequirementSchema = z.strictObject({
  id: z.string().min(1).max(300),
  text: z.string().min(1).max(5000),
  status: z.enum(['explicit', 'ambiguous', 'conflicted']),
  sources: z.array(SourceReferenceSchema).min(1).max(100),
});
export const ChangeAssessmentSchema = z.strictObject({
  scope: ScopeSchema,
  headSha: ShaSchema,
  sourceReferences: z.array(SourceReferenceSchema).max(100),
  requirements: z.array(RequirementSchema).max(500),
  changedPaths: z.array(z.string().max(500)).max(2000),
  state: z.enum(['assessment_ready', 'awaiting_clarification', 'blocked']),
  questions: z.array(z.string().max(1000)).max(500),
  limitations: z.array(z.string().max(1000)).max(100),
  analysisVersion: z.literal('deterministic-v1'),
  policyVersion: z.literal('supervised-v1'),
});
export type ChangeAssessment = z.infer<typeof ChangeAssessmentSchema>;
