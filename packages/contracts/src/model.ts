import { z } from 'zod';

const IdentifierSchema = z.string().trim().min(1).max(200);

export const AnalysisTaskSchema = z.strictObject({
  kind: z.literal('foundation_probe'),
  organisationId: z.uuid(),
  repositoryId: IdentifierSchema,
  source: z.strictObject({
    id: IdentifierSchema,
    version: IdentifierSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

export const AnalysisResultSchema = z.strictObject({
  provider: z.literal('mock'),
  modelVersion: z.literal('mock-v1'),
  task: AnalysisTaskSchema,
  state: z.literal('unknown'),
  explanation: z.literal(
    'Foundation probe only; no requirements or assertions were analysed.',
  ),
  externalCalls: z.literal(0),
});

export type AnalysisTask = z.infer<typeof AnalysisTaskSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export interface ModelProvider {
  analyse(task: AnalysisTask): Promise<AnalysisResult>;
}

export class MockModelProvider implements ModelProvider {
  analyse(input: AnalysisTask): Promise<AnalysisResult> {
    const task = AnalysisTaskSchema.parse(input);
    return Promise.resolve(
      AnalysisResultSchema.parse({
        provider: 'mock',
        modelVersion: 'mock-v1',
        task,
        state: 'unknown',
        explanation:
          'Foundation probe only; no requirements or assertions were analysed.',
        externalCalls: 0,
      }),
    );
  }
}
