import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
  realpath,
  lstat,
  unlink,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';
import {
  ArtifactRefSchema,
  ScopeSchema,
  type ArtifactRef,
  type ArtifactStore,
  type Scope,
} from '@cai/contracts';
// The scoped object-key contract can back S3. Local storage is development-only.
export class LocalArtifactStore implements ArtifactStore {
  async restoreObject(
    scope: Scope,
    reference: ArtifactRef,
    bytes: Uint8Array,
  ): Promise<void> {
    const file = await this.location(scope, reference);
    if (
      bytes.byteLength !== reference.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== reference.checksum
    )
      throw new Error('Restored artifact integrity check failed.');
    await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
  }
  async purgeScope(scope: Scope): Promise<void> {
    ScopeSchema.parse(scope);
    await mkdir(this.root, { recursive: true });
    const root = await realpath(this.root);
    const directory = path.join(root, scope.organisationId, scope.repositoryId);
    try {
      const resolved = await realpath(directory);
      if (resolved !== directory)
        throw new Error('Artifact scope path contains symlinks.');
      for (const entry of await readdir(resolved, { withFileTypes: true })) {
        if (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          !/^[a-f0-9-]{36}$/.test(entry.name)
        )
          throw new Error('Unexpected object in scoped artifact namespace.');
        await unlink(path.join(resolved, entry.name));
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw error;
    }
  }
  constructor(private readonly root: string) {}
  private async location(
    scope: Scope,
    reference: ArtifactRef,
  ): Promise<string> {
    ScopeSchema.parse(scope);
    ArtifactRefSchema.parse(reference);
    if (
      reference.scope.organisationId !== scope.organisationId ||
      reference.scope.repositoryId !== scope.repositoryId ||
      reference.key !==
        `${scope.organisationId}/${scope.repositoryId}/${reference.id}`
    )
      throw new Error('Artifact scope mismatch.');
    await mkdir(this.root, { recursive: true });
    const root = await realpath(this.root);
    const directory = path.join(root, scope.organisationId, scope.repositoryId);
    await mkdir(directory, { recursive: true });
    const parent = await realpath(directory);
    if (parent !== directory)
      throw new Error('Artifact parent must not contain symlinks.');
    return path.join(parent, reference.id);
  }
  async put(
    scope: Scope,
    bytes: Uint8Array,
    metadata: Pick<ArtifactRef, 'mediaType' | 'sensitivity' | 'expiresAt'>,
  ): Promise<ArtifactRef> {
    ScopeSchema.parse(scope);
    const id = randomUUID();
    const reference = ArtifactRefSchema.parse({
      id,
      scope,
      key: `${scope.organisationId}/${scope.repositoryId}/${id}`,
      checksum: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
      ...metadata,
      createdAt: new Date().toISOString(),
    });
    if (Date.parse(reference.expiresAt) <= Date.now())
      throw new Error('Artifact expiry must be in the future.');
    await writeFile(await this.location(scope, reference), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
    return reference;
  }
  async get(scope: Scope, reference: ArtifactRef): Promise<Uint8Array> {
    const file = await this.location(scope, reference);
    const info = await lstat(file);
    if (info.isSymbolicLink() || info.size > 5_242_880)
      throw new Error('Unsupported artifact path or size.');
    const bytes = await readFile(file);
    if (
      bytes.byteLength !== reference.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== reference.checksum
    )
      throw new Error('Artifact integrity check failed.');
    return bytes;
  }
  async delete(scope: Scope, reference: ArtifactRef): Promise<void> {
    const file = await this.location(scope, reference);
    try {
      if ((await lstat(file)).isSymbolicLink())
        throw new Error('Unsupported artifact path.');
      await unlink(file);
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw error;
    }
  }
}
