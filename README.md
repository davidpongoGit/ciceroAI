# Cicero AI (Cai)

M0 development foundation for an independent QA engineering platform. The current
application exposes only process liveness. It does not analyse PRs, verify coverage,
execute customer tests or contact AI/GitHub/Jira providers.

Product requirements: [Vision.md](Vision.md). Delivery agreement: [Agent.md](Agent.md).
Decisions: [foundation](docs/adr/0001-foundation.md) and
[knowledge storage](docs/adr/0002-knowledge-storage.md). Actual milestone evidence:
[implementation status](docs/implementation-status.md).

## Prerequisites

- Node.js **24.22.2 LTS**, pinned in `.nvmrc` and `.node-version`. Select it using
  your Node version manager. The workspace supports Node 24.15+ within 24.x.
- npm **12.0.1** (`npm --version`). If needed, install it in your personal Node
  environment with `npm install --global npm@12.0.1`.
- Docker Desktop with Linux containers (or Docker Engine) and Docker Compose v2
  supporting `up --wait`, for database commands only.
- Free loopback ports 3000 and 5432; Git and a personal, authorised development
  environment. Use synthetic data only.

Commands below run from the repository root in PowerShell, macOS or Linux unless
labelled otherwise. No external provider credentials or accounts are required.

## Install and run the API

```sh
npm ci
npm run build
npm start
```

In a second terminal:

```sh
curl http://127.0.0.1:3000/health
```

On Windows, use `curl.exe` or
`Invoke-RestMethod http://127.0.0.1:3000/health`. Expected HTTP 200 JSON:

```json
{ "status": "ok", "service": "cai-api" }
```

Health means the API process can answer requests; it does **not** claim database,
integration or workflow readiness. PostgreSQL and `.env` are unnecessary for this
route. The service binds only to `127.0.0.1`; M0 rejects public `HOST` values.
Stop with Ctrl+C (SIGINT), or SIGTERM on supported hosts.

For API source watching:

```sh
npm run dev
```

Shared packages are built before watching. After changing contracts/database,
restart `npm run dev` to rebuild their exports. No global TS runner is needed.

## Configure and start PostgreSQL

Copy the example once; do not overwrite an existing `.env`:

```powershell
# PowerShell
Copy-Item .env.example .env
```

```sh
# macOS / Linux
cp .env.example .env
```

Replace `CHANGE_ME_LOCAL_PASSWORD` in both password fields with the same unique
local password. URL-encode reserved password characters in `DATABASE_URL`.
`.env.example` is illustrative local configuration; `.env` is Git-ignored.
Shell environment variables override `.env` for Node and Compose; avoid stale
`DATABASE_URL` or `POSTGRES_*` values from other projects. The root commands load
the root `.env` explicitly and do not print it.

```sh
npm run db:up
npm run db:migrate
npm run db:smoke
npm run test:integration
```

Compose starts PostgreSQL **18.6** and waits for readiness. A named Docker volume
holds data, publishing only `127.0.0.1:5432`. PostgreSQL 18 uses a volume mounted at
`/var/lib/postgresql`. Container image pulls require network access. This local
development service uses the bootstrap database role; do not use these deployment
defaults for real customer data or production. A published loopback port is still
accessible to other local processes.

`db:migrate` applies checked-in Drizzle SQL and maintains Drizzle's migration journal.
Run only against the intended personal development database; the supplied URL
determines the target. The API does not automatically migrate or open DB connections.
M0 creates only `installation_metadata` (technical metadata), not customer knowledge.
The integration test reapplies migrations, writes/reads a synthetic metadata row,
rolls it back and checks that it was removed. The standalone smoke assumes migrations
have already run. Missing configuration or DB connectivity fails the command;
tests never silently substitute a mock or skip a missing database.

Stop the API with Ctrl+C, then stop the database:

```sh
npm run db:down
```

Ordinary shutdown preserves the named volume. Do **not** add `--volumes` unless you
intend to permanently delete this development database. Password/user/db changes
in `.env` do not reinitialise an existing volume; manage existing roles explicitly
or use a separate new development volume after reviewing retained data.

For schema changes, edit `packages/database/src/schema.ts`, run `npm run db:generate`,
review and retain the SQL plus journal/snapshot files, then migrate/test. Do not use
schema push or edit already applied migrations. Back up populated databases before
changes; destructive schema evolution needs its own reviewed plan. This is not a
production backup/restore procedure.

## Checks

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
# All checks above, excluding real DB integration:
npm run check
# Separately, after configuring/starting PostgreSQL:
npm run test:integration
```

`npm test` builds package exports, then runs unit and injected health transport
tests. `typecheck` covers source, tests and TS config files. `build` emits each
workspace's JS/declarations using TS project references. No browser/E2E application
exists yet. GitHub Actions has read-only repository permissions, a bounded checks
job and a separate ephemeral PostgreSQL integration job. CI is configured, not
claimed executed until a workflow actually runs. No secrets are provided to PR jobs;
do not replace `pull_request` with privileged `pull_request_target` execution.

`npm run format` formats maintained source/docs while explicitly excluding the
four supplied foundational Markdown documents. Lockfile and generated Drizzle
metadata are preserved. Install reproducibly with `npm ci`; retain
`package-lock.json` in the reviewed commit along with the source. No commit or push
is performed automatically.

## Module and data boundaries

- `apps/api`: Fastify health transport and validated local startup config.
- `packages/contracts`: Zod response/task schemas and typed deterministic
  `MockModelProvider`. Its foundation probe returns `unknown` and zero external
  calls, preserving scoped synthetic source provenance. It has no tools or side effects.
- `packages/database`: Drizzle schema, reviewed migrations, bounded `pg` pool,
  explicit migration/smoke CLI. No knowledge retrieval API yet.
- `tests/integration`: real PostgreSQL migration/transaction smoke.

Customer-managed single-customer installations will own their database and artifact
namespace. PostgreSQL is canonical for versioned knowledge, workflow and graph state;
large artifacts belong in future S3-compatible storage. Relational/full-text search
comes first; pgvector requires retrieval evidence and a reviewed decision.

There is no vendor telemetry, provider SDK or model training in M0. Runtime network
traffic is local HTTP and explicitly configured PostgreSQL only. Dependency
installation, image pulls and CI download public tooling. The health route is public
and contains no customer data. No authentication/authorisation system exists yet;
add it before exposing customer-data routes. Logs omit requests, credentials and
raw database errors. No employer assets, live customer content or untrusted PR code
are used. Git ignores secrets, logs, builds and evidence artifacts.

Future model calls require approved data-flow configuration; BYOK does not guarantee
data stays local. Persistent retrieval does not retrain a foundation model. Source
versions, scoped access, invalidation, retention, legal holds, export, deletion,
backup/restore and cost controls follow [ADR 0002](docs/adr/0002-knowledge-storage.md)
and Vision §5. These are staged requirements, not functioning M0 features.

## Current limits

No webhook intake, durable workflow, connectors, real AI, UI, test discovery,
assertion verification, runners, artifact store, multi-tenant isolation, retention
engine, export/deletion, usage metering or tested recovery. The Compose service is
development-only, without production TLS, encryption, role separation or backups.
See implementation status for checks actually executed and environment blockers.

Stop after M0 review. Next recommended task is **M1 plan only**, subject to explicit
founder approval.
