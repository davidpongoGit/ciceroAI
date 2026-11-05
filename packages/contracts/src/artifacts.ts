import { z } from 'zod';
import { ScopeSchema } from './workflow.js';
export const ArtifactRefSchema = z.strictObject({
  id: z.uuid(),
  scope: ScopeSchema,
  key: z.string().min(1).max(500),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative().max(5_242_880),
  mediaType: z.enum([
    'application/json',
    'text/plain',
    'text/x-diff',
    'text/typescript',
    'image/png',
  ]),
  sensitivity: z.enum(['synthetic', 'internal', 'confidential']),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export interface ArtifactStore {
  put(
    scope: z.infer<typeof ScopeSchema>,
    bytes: Uint8Array,
    metadata: Pick<ArtifactRef, 'mediaType' | 'sensitivity' | 'expiresAt'>,
  ): Promise<ArtifactRef>;
  get(
    scope: z.infer<typeof ScopeSchema>,
    reference: ArtifactRef,
  ): Promise<Uint8Array>;
  purgeScope?(scope: z.infer<typeof ScopeSchema>): Promise<void>;
  restoreObject?(
    scope: z.infer<typeof ScopeSchema>,
    reference: ArtifactRef,
    bytes: Uint8Array,
  ): Promise<void>;
  delete(
    scope: z.infer<typeof ScopeSchema>,
    reference: ArtifactRef,
  ): Promise<void>;
}
