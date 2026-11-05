import { z } from 'zod';
import { ScopeSchema, ShaSchema } from './workflow.js';

export const AssertionSchema = z.strictObject({
  line: z.number().int().positive(),
  target: z.string().max(2000),
  matcher: z.string().max(100),
  expected: z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]),
  negated: z.boolean(),
  supported: z.boolean(),
});
export type Assertion = z.infer<typeof AssertionSchema>;
export const TestAssetSchema = z.strictObject({
  id: z.string().max(500),
  scope: ScopeSchema,
  path: z.string().max(500),
  title: z.string().max(1000),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  testRevisionSha: ShaSchema,
  line: z.number().int().positive(),
  skipped: z.boolean(),
  assertions: z.array(AssertionSchema).max(500),
  limitations: z.array(z.string()).max(100),
});
export type TestAsset = z.infer<typeof TestAssetSchema>;
export const AssertionMappingSchema = z.strictObject({
  criterionId: z.string().min(1).max(300),
  criterionHash: z.string().regex(/^[a-f0-9]{64}$/),
  testId: z.string().min(1).max(500),
  assertionHash: z.string().regex(/^[a-f0-9]{64}$/),
  reviewedBy: z.enum(['human-review', 'synthetic-fixture']),
});
export type AssertionMapping = z.infer<typeof AssertionMappingSchema>;
export const RunEvidenceSchema = z.strictObject({
  id: z.uuid(),
  scope: ScopeSchema,
  testId: z.string().max(500),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  testRevisionSha: ShaSchema,
  appSha: ShaSchema,
  environment: z.string().min(1).max(100),
  criterionHash: z.string().regex(/^[a-f0-9]{64}$/),
  assertionHashes: z
    .array(z.string().regex(/^[a-f0-9]{64}$/))
    .min(1)
    .max(500),
  outcome: z.enum(['passed', 'failed', 'environment_failure']),
  origin: z.enum(['isolated-runner', 'trusted-synthetic']),
  finishedAt: z.iso.datetime(),
});
export type RunEvidence = z.infer<typeof RunEvidenceSchema>;
