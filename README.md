# Cicero AI (Cai)

A customer-managed QA engineering prototype with a working synthetic demonstration:
signed PR events → durable PostgreSQL jobs → versioned requirements → dependency
readiness → reviewed assertion mappings → scoped approvals → real Playwright
evidence → reviewable test diffs, lifecycle controls and a local dashboard.

The repository now contains implementation slices across **M1–M8**. This is a
synthetic development prototype, not a production-complete commercial platform.
Real provider onboarding, external AI, S3 and isolated customer-code execution have
not been demonstrated. See [milestone evidence](docs/milestones.md) and
[remaining gates](docs/runbooks/data-and-recovery.md).

Follow the [step-by-step M0–M8 test guide](docs/test-guide-m0-m8.md) for setup,
milestone checks, expected results, manual dashboard/API checks and recovery drills.

The founder authorised continued sequential building on 5 November 2026. Earlier
M0 stop notes are historical. [Vision.md](Vision.md), [Agent.md](Agent.md),
[AGENTS.md](AGENTS.md) and [First-Codex-Prompt.md](First-Codex-Prompt.md) remain intact.

## Prerequisites

- Node **24.22.2 LTS** (`.nvmrc` / `.node-version`) and npm **12.0.1**. Select the
  pinned runtime using your personal Node version manager. No global TS runner is
  needed. A checksum-verified local Node binary was used for the recorded checks.
- PostgreSQL **18.6** through Docker Compose v2, or the project-local Windows helper.
- Playwright's matching Chromium for browser tests; download instructions below.
- Personal, authorised tools and synthetic data. No employer resources or real
  GitHub/Jira/model credentials are needed for the demo.

Run commands from this repository's root. `npm ci` uses the checked-in lockfile.

## Quick start on Windows without Docker

```powershell
npm ci
powershell -NoProfile -File scripts/local-postgres.ps1 start
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD 'runtime-data/browsers'
npm exec -- playwright install chromium
powershell -NoProfile -File scripts/local-postgres.ps1 demo
npm run demo:serve
```

Open **http://127.0.0.1:3000**. Open the ignored file `runtime-data/demo.env` locally
and copy its `API_TOKEN` into the dashboard's password field. The token is kept
only in page memory, and is not printed by the demo or stored by the browser.

The Windows helper downloads the pinned PostgreSQL binary bundle
`@embedded-postgres/windows-x64@18.6.0-beta.19` into ignored `runtime-data/tools`.
It initialises a dedicated SCRAM-authenticated cluster, binds **127.0.0.1:55432**
and generates local credentials in ignored runtime-data. It creates no system
service and does not change an existing PostgreSQL installation. If a project-local
Node 24 binary is present, the helper selects it for child commands.

The demo actually sends HMAC-signed localhost HTTP requests, redelivers them,
persists and processes three synthetic PR stages, records their readiness, obtains
**simulated fixture approvals**, runs the owned browser fixture and stores evidence.
A publication plan remains awaiting review; no external branch or PR is created.
Each run uses a fresh synthetic organisation and preserves earlier data.

Useful generated files:

| File                             | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `runtime-data/demo-summary.json` | Stage outcomes, scoped IDs, observed browser evidence and usage |
| `runtime-data/demo-review.patch` | Readable generated test diff                                    |
| `runtime-data/demo-backup.json`  | Versioned scoped logical snapshot and object-reference manifest |
| `runtime-data/demo.env`          | Local-only installation identity and generated credentials      |
| `runtime-data/artifacts`         | Scoped test drafts, diffs and execution reports                 |

Stop the API with Ctrl+C. Stop the dedicated database separately:

```powershell
powershell -NoProfile -File scripts/local-postgres.ps1 stop
```

Database data and artifacts remain on disk. Never delete runtime-data or Docker
volumes unless you intend to discard those development records.

For a hidden Windows API process after building/seeding, use
`powershell -NoProfile -File scripts/demo-api.ps1 start` and later the same command
with `stop`. The helper validates its recorded process identity before stopping it.

## Docker Compose / macOS / Linux

Copy `.env.example` to `.env` once, preserving an existing file. Replace both
`CHANGE_ME_LOCAL_PASSWORD` values with the same personal local password; URL-encode
reserved password characters in `DATABASE_URL`. Shell environment overrides `.env`.

```sh
npm ci
npm run db:up
npm run db:migrate
npm run db:smoke
```

Compose publishes PostgreSQL only on **127.0.0.1:5432** and preserves a named volume.
Its PostgreSQL 18 mount is `/var/lib/postgresql`. The bootstrap role is for personal
development, not production role separation. Changing initial credentials in `.env`
does not reinitialise an existing volume.

For the synthetic demonstration, set Playwright's browser directory before install:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/runtime-data/browsers" npm exec -- playwright install chromium
npm run demo
npm run demo:serve
```

On Linux, install the documented Playwright system dependencies if needed; CI uses
`playwright install --with-deps chromium` on an ephemeral runner. The demo accepts
only loopback development URLs with database names `postgres`, `cai_local` or `cai_ci`.
It never selects a remote customer database automatically. Stop Compose with
`npm run db:down`; ordinary shutdown keeps the volume. Do not add `--volumes` casually.

Docker/Compose was **unavailable on the implementation host**, so its startup and
container behaviour remain unverified. Real PostgreSQL tests used the portable
18.6 binary instead. Linux and GitHub Actions have not been executed here.

## Health-only API and scoped workflow

```sh
npm run build
npm start
curl http://127.0.0.1:3000/health
```

Health-only startup needs no `.env`, database or provider keys. Expected HTTP 200:

```json
{ "status": "ok", "service": "cai-api" }
```

This is process liveness, separate from DB or integration readiness. HOST is
restricted to `127.0.0.1`. `npm run dev` watches API source and first builds shared
packages; restart it after changing a shared package.

For a configured local workflow, set `WORKFLOW_ENABLED=true`, an explicit
`DATABASE_URL`, organisation UUID, numeric repository/installation IDs and
independent random webhook/API secrets of at least 32 characters. Placeholder
secrets are rejected. Run migrations explicitly before starting.

- `POST /webhooks/github`: raw-body HMAC-SHA256, delivery validation, scope checks,
  256 KiB limit, transactional persistence and logical/delivery deduplication.
- `GET /assessments/:id`: bearer-authenticated, installation-scoped status.
- `GET /api/overview`, `/api/plans`, `/api/reports/:id`: scoped dashboard records.
- `GET /api/features/:id/readiness`: independent readiness dimensions.
- `GET /api/artifacts/:id`: authorised attachment download with checksum checking.
- `GET /api/usage`, `/api/notifications`: scoped metering and in-app notifications.
- `POST /api/plans`, `/api/plans/:id/decision`: strict schemas and server-side policy.

`PLAN_APPROVALS_ENABLED=false` defaults to read-only operator access. Explicitly
enabling it grants the configured single local operator plan-management rights.
No authentication cookie or CORS grant exists, and the UI cannot choose another
organisation. This is not a multi-user production identity/RBAC implementation.
No HTTP endpoint runs arbitrary code or merges a repository.

```sh
npm run worker -- --once
npm run worker
```

The default worker processes deterministic foundation probes. The source-analysis
orchestrator is exercised by the synthetic demo; read-only GitHub/Jira adapters
accept already-authorised scoped tokens but are not automatically activated.
Real app registration, OAuth consent/refresh and live permission validation remain
deployment work. No external model SDK/provider is enabled.

## Checks and database migrations

```sh
npm run check
npm run test:integration
npm run test:e2e
npm audit
```

`check` runs formatting, lint, strict source/test typecheck, unit/transport tests and
build. Integration requires a real database; missing configuration fails explicitly.
Browser tests require Chromium and use only repository-owned synthetic code.
The database role for integration tests needs permission to create/drop its uniquely
named temporary `cai_restore_*` database. Use a dedicated personal/ephemeral CI DB.
The full restore suite requires a loopback database named `postgres` or `cai_ci`;
the Windows helper selects `postgres`. The example's `cai_local` database is
suitable for the demo but does not satisfy that restore-test guard.

Windows convenience commands select the dedicated cluster and ignored credentials:

```powershell
powershell -NoProfile -File scripts/local-postgres.ps1 test
powershell -NoProfile -File scripts/local-postgres.ps1 e2e
```

The browser suite proves that the unchanged generated assertion passes on a fixed
synthetic build and fails on its broken variant. A second browser test exercises
dashboard authentication and approval/revocation. Unit classifier fixtures remain
simulations; browser results are marked `trusted-synthetic` and cannot verify
customer code. Synthetic build/test SHA values are content identifiers, not
claims of customer Git commits.

Edit `packages/database/src/schema.ts`, run `npm run db:generate`, review and retain
generated SQL plus snapshots/journal, then migrate/test. Never edit applied SQL or
use schema push on customer data. Migration 0007 backfills scope controls for
existing assessments. CI has read-only repository permissions, bounded jobs and
an ephemeral PostgreSQL/browser job. It is configured, not claimed executed.

## Monitoring, retention, export and recovery

```sh
npm run monitor -- --once
npm run monitor
npm run demo:monitor -- --once
npm run demo:export
```

Maintenance requires `MAINTENANCE_ENABLED=true` and an explicit scope. It performs
deterministic targeted reconciliation, notification dedupe, abandoned-action
recovery, metadata minimisation and artifact expiry. It makes no model calls and
sends no external notifications. The polling interval is bounded at five seconds.

Per-scope UTC-month runner budgets default to 120 seconds. Each action reserves
its approved allowance, is unique per plan, and records measured milliseconds.
An abandoned action is conservatively charged its reservation. Policy prevents
overruns from launching new actions. No provider prices or fictional savings are
shown; model/storage/cloud billing is not measured by this prototype.

Current retention covers webhook metadata (default 14 days, retaining hashes and
delivery identities) and artifacts (default maximum 30 days). Configurable policies
and holds are persisted; held scopes cannot be deleted. Referenced knowledge and
audit history remain until an explicit scoped deletion/contractual policy is applied.
Complete category-specific production retention and backup purge automation remain
open. See the [data/recovery runbook](docs/runbooks/data-and-recovery.md).

Privileged CLI operations require explicit scope and maintenance enablement:

```sh
npm run data -- export
npm run data -- prune
# Restore additionally needs RESTORE_ENABLED=true and an empty migrated target:
npm run data -- restore runtime-data/exports/<snapshot>.json
# Destructive: only for an intentionally selected development/customer scope:
npm run data -- delete <organisation-uuid>:<repository-id>
```

Exports have version, scope, row/byte bounds and checksums. Checksums detect
corruption; they do not authenticate an untrusted backup. Restore rejects wrong
scope and nonempty destinations, preserves relationships and fences imported work
and approvals. Integration tests actually restored a fresh PostgreSQL database and
copied/checksummed an artifact. This is an **application logical backup**, not WAL/PITR,
instance-role/configuration backup or a production recovery guarantee. Object bytes
must be backed up separately from the manifest. Live deletion preserves minimal
receipts; retained backups have a separate purge schedule.

## Module and trust boundaries

| Module                  | Responsibility                                                         |
| ----------------------- | ---------------------------------------------------------------------- |
| `apps/api`              | Health, signed intake, scoped records and local approval UI            |
| `apps/worker`           | Durable worker, analysis orchestration, maintenance and demo/data CLIs |
| `packages/contracts`    | Runtime-validated contracts and deterministic mock boundary            |
| `packages/database`     | Canonical PostgreSQL state, migrations and scoped stores               |
| `packages/integrations` | Approved read-only adapters and guarded draft-PR publisher             |
| `packages/intelligence` | Conservative explicit-criterion extraction and provenance              |
| `packages/coverage`     | Inert AST inventory, reviewed assertion mappings and evidence rules    |
| `packages/policy`       | Immutable plan hashing, capabilities and readiness gates               |
| `packages/executor`     | Fixed trusted-synthetic runner and scoped local artifact adapter       |

PostgreSQL remains canonical for customer-scoped versioned knowledge, workflow and
graph state. Large artifacts are separate objects; the local adapter follows the
scoped object contract for a later S3 backend. Relational queries precede optional
pgvector benchmarks. Persistent retrieval does not retrain a foundation model.
BYOK does not guarantee data stays local; future providers require approved data flows.

Source text, model output and PR code do not grant permissions. Extraction supports
explicit `AC-N:` / `AC[SHARED_ID]:` lines, preserves contradictions and minimises
credential-looking text. Unsupported prose and syntax remain unknown. Test names,
static generation and stale/wrong-build passes never establish verified coverage.

All current data is synthetic. No employer assets, live customer data, provider
calls, external repository writes, pushes or merges were used. Runtime requests
are local HTTP/PostgreSQL; package/browser downloads fetched public tooling.
Vendor telemetry and shared training are absent. Credentials, artifacts and build
outputs are Git-ignored. The four supplied foundational documents were preserved.

## Remaining gates

No reviewed sandbox is available for arbitrary PR code: the boundary fails closed
with **no host fallback**. Docker/Compose, live GitHub/Jira/OAuth, real AI, S3,
production TLS/identity/encryption/role separation and hosted multi-tenancy remain
unverified or unimplemented. The GitHub publisher was tested with synthetic HTTP
only; local reviewable diffs exist, but no real test PR was opened.

Architecture and alternatives: [ADRs](docs/adr/0001-foundation.md),
[knowledge ownership](docs/adr/0002-knowledge-storage.md),
[durable workflows](docs/adr/0003-durable-workflows.md) and
[supervised plans](docs/adr/0004-supervised-plans.md).
