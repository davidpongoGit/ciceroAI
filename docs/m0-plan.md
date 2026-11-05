# M0 implementation plan

Scope: foundation only, then stop for founder review. Preserve the supplied
Markdown files byte-for-byte; copy the attached prompt without changing its text.

1. npm workspaces, pinned lockfile, strict TS project references, ESLint, Prettier,
   Vitest and CI with read-only repository permissions.
2. Fastify GET /health with shared runtime-validated response. Local-only startup
   config, graceful shutdown, no secret-bearing errors or request logging.
3. Contracts and deterministic mock model provider: versioned scoped source input,
   validated unknown output, zero provider calls or tools.
4. Drizzle/pg boundary, one installation metadata table, checked-in SQL migration,
   Compose PostgreSQL, explicit migration and real DB integration smoke commands.
5. README, two ADRs and implementation status with actual evidence and blockers.

Acceptance: npm ci, format check, lint, typecheck, unit/endpoint tests and build;
live HTTP health and shutdown; secret/artifact ignore review; real PostgreSQL
startup/migration/smoke if Docker is available. Integration must fail clearly when
configuration or DB is unavailable, never silently skip or substitute an in-memory
database. Fresh-volume execution is a separate gate from unit tests.

Dependencies, proposed tree, commands and security boundaries: ADR 0001.
Risks: missing Docker, unavailable real DB evidence, upstream/toolchain upgrades,
development-only auth/TLS/backup posture, no customer isolation proof yet.
No API keys, pushes, commits, external accounts, M1 code or live customer data.
