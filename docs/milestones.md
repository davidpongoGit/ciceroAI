# Continued milestone delivery

Founder instruction on 5 November 2026 authorises continued sequential building
without approval pauses. Historical M0 stop notes do not limit this authorisation.
Product approval policies for generated repository writes and execution still apply.
No external accounts, pushes, merges or real provider calls are implied.

## M0 database follow-up / M1

Observed on 5 November: genuine PostgreSQL **18.6** started from a pinned public
portable binary within ignored runtime-data, listening on **127.0.0.1:55432** with
SCRAM authentication. `powershell -NoProfile -File scripts/local-postgres.ps1 test`
executed migration replay/transaction rollback plus four M1 persistence tests:
**2 files, 5 tests passed**. This closes the real database smoke gap; Docker Compose
itself remains unexecuted because Docker is absent.

`npm run check` passed: formatting, lint with zero warnings, typecheck, build and
**5 unit/transport files, 23 tests**. M1 demonstrates signed raw-body intake,
metadata-only persistence, delivery and logical dedupe, scoped authenticated status,
lease fencing/recovery after a replacement connection, concurrent claims, bounded
retries and dead-letter. Model results remain `unknown` from a deterministic mock.
Tests intentionally inject lease expiry and provider failures; this is not a live
GitHub/Jira/model integration test or a literal operating-system worker kill test.

Implementation: apps/api/src/workflow*, apps/worker, contracts/workflow.ts,
database/workflows.ts, migration 0001, unit transport tests and real PostgreSQL
tests/integration/workflow.test.ts. Queue/security rationale: ADR 0003.

The Windows portable helper starts/stops only this workspace's PostgreSQL cluster:

```powershell
powershell -NoProfile -File scripts/local-postgres.ps1 start
powershell -NoProfile -File scripts/local-postgres.ps1 test
powershell -NoProfile -File scripts/local-postgres.ps1 stop
```

Generated local credentials are in ignored runtime-data; never print or commit them.
For workflow runtime, configure .env with the same explicit database URL plus scoped
identity, independent webhook/API secrets and WORKFLOW_ENABLED=true. Run migrations
before starting the API. `npm run worker -- --once` processes one job; `npm run worker`
polls durably. Health-only startup remains available without workflow configuration.

## M2 adapter slice

`npm run check` passed with **6 files / 31 tests**. Read-only adapters check configured
organisation/repository/project, immutable head/base SHA, bounded file pagination,
response size/depth, 401/403/404, rate limits and retry limits. Raw data is schema
validated. A second PR metadata read rejects a changed head/base during pagination.
Jira uses the OAuth API gateway with an approved site/cloud ID; ADF extraction is
bounded. Installation/OAuth access tokens are injected and never persisted/logged.

Observed tests use synthetic HTTP transports only. No live provider call or OAuth
consent/token exchange occurred. Creating/distributing real integration apps and
proving their permissions remains untested. The adapter accepts an already-authorised
short-lived token; it does not claim a complete onboarding/refresh-token flow.

Next: M3 versioned sources and conservative criterion extraction, then M4–M8.

## M3 source intelligence slice

`npm run check`: **7 files / 35 tests passed**, plus lint/typecheck/build.
Real PostgreSQL integration: **3 files / 6 tests passed**. A durable worker lease
collects synthetic sources, extracts explicitly labelled criteria, commits versioned
source snapshots/report/links and job completion atomically, and marks affected old
reports stale when a source changes. Cross-scope retrieval returns nothing.

Two sources with conflicting explicit `AC[SHARED_ID]:` statements result in a
clarification state. Only `AC-N:` or explicit shared-ID lines are supported; ordinary
prose is not silently converted into requirements. No semantic model or real source
provider was exercised. Complete OAuth onboarding and arbitrary document reasoning
remain outside demonstrated capability. Source files and new DB migration 0002
are under packages/intelligence, contracts/knowledge.ts and database/knowledge.ts.

## M4 dependency/readiness slice

`npm run check`: **8 files / 37 tests passed**. PostgreSQL: **4 files / 7 tests passed**.
Dependency revisions retain scoped source-version foreign keys, certainty and actor.
Code, feature, deployment/flag, data and approval remain independent. Three synthetic
PR dependencies become eligible only after all configured prerequisites are met.
Inferred/contested/stale or wrong-build links cannot satisfy readiness. Unknown future
dependencies remain unknown until a human confirms the dependency inventory.

Source changes record invalidations and stale affected reports; source revocation
returns affected features, invalidates readiness and prevents report retrieval.
No global model sweep occurs. Tests use reviewed synthetic graph updates; automatic
interpretation of arbitrary cross-PR relationships is not demonstrated. Implementation
is contracts/readiness.ts, database/graph.ts, migration 0003 and their tests.

## M5 inventory and defensible coverage slice

`npm run check`: **9 files / 42 tests passed**. PostgreSQL: **4 files / 7 tests passed**,
including persisted inventory dedupe and a reviewed mapping remaining
`implemented_unverified` without execution evidence. Inventory parses TypeScript
without evaluating code/config. Constant-only, skipped and unawaited web assertions
cannot establish coverage. Similar £500 success assertions cannot verify limits.

Coverage decisions require reviewed exact assertion and criterion hashes plus
matching test revision/content, application build, environment and actual run
evidence. Unit classifier tests supply synthetic evidence fixtures; they do not
prove an actual browser execution. No requirement has yet been demonstrated verified
by this build. Discovery supports a documented narrow subset of Playwright syntax.
Implementation: packages/coverage, contracts/coverage.ts, database/coverage.ts and
migration 0004. The root artifact-ignore pattern was corrected so the source package
named coverage is included in Git and formatting.

## M6 supervised plans and local UI

`npm run check` passed (42 unit tests). Real PostgreSQL: **5 files / 10 tests passed**.
Immutable plans and append-only decisions bind exact source/test/build refs,
operation, environment and budget. Tests deny unapproved/revoked/expired actions,
wrong scope, changed refs and missing capabilities; exact approved refs pass.
Read-only operators cannot approve. A CSP-protected local dashboard shell exposes
no token; data APIs require the configured scoped bearer token. At this checkpoint
the UI had not yet been exercised in a browser; the M8 browser checks below now
cover it. It is not a multi-user production identity system.

Implementation: packages/policy, contracts/plans.ts, database/plans.ts, migration
0005 and API admin/dashboard modules. PLAN_APPROVALS_ENABLED defaults false; enabling
it grants management capabilities only to the configured local installation token.
There is no execution or repository-write endpoint, and approval alone runs nothing.

## M7 synthetic execution and draft delivery slice

Playwright 1.64.1 and its matching Chromium were installed locally under ignored
runtime-data. A real browser test against the owned synthetic checkout passed on
the fixed build and failed on the broken build with **identical generated test
bytes**. A custom reporter captured the matching assertion location executing.
The evidence, reviewed mapping and report/diff artifact references were persisted
in PostgreSQL; checksums and scope were checked. `test:e2e`: **1 file / 1 test passed**
(that test performs both browser runs). PostgreSQL integration: **10 tests passed**.

Synthetic build/test SHA fields are reproducible SHA-1 content/variant identifiers,
not claims of customer Git commits. Run origin is `trusted-synthetic`; it cannot
verify customer code when synthetic evidence is disabled. The host runner accepts
only the fixed owned template and fixture, uses a restricted child environment,
bounded time/output and rechecks approval while running. Arbitrary PR code is
rejected; a reviewed container sandbox remains unavailable because Docker is absent.

The GitHub publisher implements approved scoped branch/file/draft-PR creation and
reconciliation, tested through synthetic HTTP transports only. **No real GitHub
branch or PR was created.** Reviewable diffs are local artifacts. Real OAuth/app
configuration, S3 backend and isolated customer execution remain unverified.

## M8 hardening and repeatable demonstration

Observed on **5 November 2026**, Windows, using the pinned **Node 24.22.2**, npm
12.0.1, genuine PostgreSQL 18.6 and Playwright 1.64.1 Chromium. The project-local
Node binary was downloaded from nodejs.org and matched its official SHA-256 list;
no global runtime or system database service was replaced.

| Exact command                                                                                                    | Actual final outcome                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci`                                                                                                         | Exit 0; 227 packages added, 237 audited; zero vulnerabilities. Deprecated Drizzle Kit loader warnings and three blocked esbuild install scripts remain; no script-approval policy was weakened.                                            |
| `npm run check`                                                                                                  | Exit 0; formatting, zero-warning lint, strict source/test typecheck, **12 files / 48 unit and transport tests**, build.                                                                                                                    |
| `powershell -NoProfile -File scripts/local-postgres.ps1 test`                                                    | Exit 0; **6 files / 15 real PostgreSQL integration tests**.                                                                                                                                                                                |
| `powershell -NoProfile -File scripts/local-postgres.ps1 e2e`                                                     | Exit 0; **2 files / 2 real browser tests**.                                                                                                                                                                                                |
| `powershell -NoProfile -File scripts/local-postgres.ps1 demo`                                                    | Exit 0; actual signed localhost HTTP intake/redelivery, three persisted synthetic PR stages, blocked → code ready → environment ready, real passing browser assertion and persisted review artifacts.                                      |
| `npm run demo:monitor -- --once`                                                                                 | Exit 0; explicitly scoped maintenance pass completed.                                                                                                                                                                                      |
| `npm run demo:export`                                                                                            | Exit 0; scoped versioned logical snapshot and artifact manifest written under ignored runtime-data/exports.                                                                                                                                |
| `powershell -NoProfile -File scripts/demo-api.ps1 start`                                                         | Exit 0; hidden local API process started and health checked.                                                                                                                                                                               |
| `powershell -NoProfile -File scripts/demo-api.ps1 stop`                                                          | Exit 0; validated recorded executable/workspace/command line before stopping only that API; restart also passed.                                                                                                                           |
| `curl.exe --fail --silent --show-error http://127.0.0.1:3000/health`                                             | Exit 0; exact `{"status":"ok","service":"cai-api"}`.                                                                                                                                                                                       |
| Authenticated `GET /api/overview` against the running demo                                                       | HTTP 200; 3 assessments/reports, 4 current sources, 1 indexed test, no dead letters. Scoped JSON payload estimate and registered object bytes are reported; physical DB/index/backup bytes remain `not measured`. Token was never printed. |
| `npm audit`                                                                                                      | Exit 0; zero reported vulnerabilities.                                                                                                                                                                                                     |
| `git diff --quiet -- AGENTS.md Agent.md Vision.md First-Codex-Prompt.md`                                         | Exit 0; all four foundational documents unchanged.                                                                                                                                                                                         |
| `git check-ignore runtime-data/demo.env .env .env.local artifacts/dashboard.png packages/executor/dist/index.js` | All credential/artifact/build paths ignored.                                                                                                                                                                                               |

Test totals are **65 passed** across the three suites. These are software checks,
not a count of verified customer requirements. Golden classifier/provider cases use
synthetic fixtures. The browser suite observed actual execution of the owned test
assertion on fixed and broken variants, with identical test bytes, and exercised
dashboard authentication, inspection and approval/revocation without browser errors.
Visual QA screenshot: ignored `artifacts/dashboard.png`.

### Demonstrated hardening

- Scoped per-month runner budget reservations, plan-level dedupe, measured elapsed
  milliseconds, conservative abandoned-action charging and lease fencing. Budget
  overrun cannot reserve another action. No model/provider price assumptions.
- Targeted feature readiness snapshots from versioned invalidations; repeat
  reconciliation produces no duplicate notifications or model calls. Notifications
  are local records with acknowledgement, not external messages.
- Configurable webhook metadata minimisation retains delivery identity/hash;
  source and derived state stay versioned. Credential-looking source content is
  redacted before persistence and triggers clarification when applicable.
- Artifact expiry, legal holds, pending-deletion retry after injected object-store
  failure, integrity/scoped access and denial of held-scope deletion.
- Row/byte-bounded scope-only export, wrong-scope restore rejection, and a real
  restore into a new temporary PostgreSQL database. The test compared source/report
  content and readiness, copied/checksummed an object, revoked imported approvals,
  rejected overwrite, and removed only its validated temporary database.
- Scoped live deletion removes objects and derivations in FK order, preserves a
  disabled-scope tombstone/minimal receipt and leaves another organisation intact.
  Disabled scopes cannot write a new inventory. Backups have separate retention.
- Bounded audited manual replay and dead-lettering when a provider Retry-After
  exceeds retry policy. Normalised logical keys dedupe equivalent open/sync events
  while preserving raw-byte delivery conflict checks.

### Current files and limits

M8 implementation is in database/actions.ts, lifecycle.ts, monitor.ts, retention.ts,
artifact catalog, worker monitor/data/demo CLIs and migrations 0007–0008. API access
is in admin.ts; operations guidance is in docs/runbooks/data-and-recovery.md.
All modules contain exercised behaviour; no UI/worker service depends on generated
LLM authority. Source/version/graph data remain canonical PostgreSQL records.

**Remaining acceptance gates:** Docker Compose and arbitrary-PR containment are
not demonstrated. The untrusted executor deliberately rejects every request; a
reviewed isolated runner is not implemented/configured. OAuth registration/consent/
refresh, live provider permissions, a real AI adapter, S3 backend, real test-PR
publication, production identity/TLS/encryption/role separation, exhaustive retention
categories, backup purge/PITR and large-volume recovery remain unimplemented or
unverified as described in the runbook. CI was updated but never pushed/dispatched.
Read-only adapters and the publisher were tested via synthetic transports only.

The built baseline spans M1–M8 and demonstrates the synthetic path; this is **not**
an assertion that every production/full-vision milestone acceptance gate is closed.
No real provider calls, customer data, untrusted host execution, external repository
writes, commits, pushes, merges or production actions occurred. The original M0
commit remains the repository HEAD; new work is left uncommitted for inspection.

The local demo API and dedicated database are left available for founder inspection
at 127.0.0.1:3000 / 127.0.0.1:55432. Stop them with the documented helpers. The token
is only in ignored runtime-data/demo.env. The demo leaves a real-publication plan
awaiting product-level review and creates a local patch/manifest instead of a PR.
Further work should close the explicit environment/integration gates and validate a
representative pilot before claiming a production or fully autonomous product.

## Readiness display milestone

Date: 5 November 2026. Scope: one local dashboard/evidence milestone, requested
after founder testing. No publisher or repository-write capability was added.

The existing dashboard shows the requirement, PR identity and full assessed
application revision alongside a plain-language test-readiness verdict. Inspect
shows separate code, feature, environment and data dimensions, specific blockers,
recorded run origin/result/revisions/environment/assertion hashes and explicit
unavailable execution or unmeasured coverage states. `assessment_ready` is labelled
as completed analysis; it does not imply testability, execution or verification.
Readiness alone grants no execution authority. A feature targeting another SHA
does not establish readiness for an earlier assessment. Failed readiness reads
produce an unknown state rather than falling back to analysis status.

The existing feature-readiness endpoint is reused and now includes its evaluated
application SHA. Authenticated report responses add candidate features linked by
exact shared source versions or an existing plan, bounded dependency history and
up to 20 recorded runs. These reads retain installation scope and report/source
access checks. Revoked dependency sources suppress reconstructed history. There
are no new dependencies, schema migrations or outbound provider calls.

Observed browser inspection through the normal `http://127.0.0.1:3000/` token
entry point, against the existing synthetic demo, confirmed:

- Requirement: “Reject expired cards”; current assessed revision has testable
  prerequisites and a recorded Playwright pass labelled synthetic.
- Persisted revision history includes code-blocked states after PR #101 and
  #102 analysis, code-ready/environment-blocked state after PR #103 analysis,
  and readiness after deployment/flag/data prerequisites are satisfied.
- Coverage remains `not measured`; earlier assessed builds do not inherit the
  later feature target's readiness. No browser page errors occurred.
- Screenshots: ignored `artifacts/readiness-demo.png` and
  `artifacts/readiness-demo-history.png`; the first was visually inspected.

Historical feature target and inventory-completeness decisions were not
snapshotted. The UI therefore labels history **reconstructed**, replays persisted
dependency revisions with the current target/inventory/source validity, and
explains that PR labels identify the latest linked analysis before each change,
not causality or a captured historical verdict. History above 200 revisions is
explicitly unavailable rather than partially reconstructed. No dates or outcomes
are read from the convenience demo summary to populate the UI.

Checks observed: `npm run check` exited 0 (format, lint, strict typecheck,
48 unit/transport tests, build); database helper `test` exited 0 (15 PostgreSQL
tests); database helper `e2e` exited 0 (3 browser tests). The added browser
regression traverses code/environment/readiness states while analysis remains
complete, tests missing and seeded synthetic run display, checks a changed target
and an unavailable readiness endpoint. Its seeded pass is display-fixture evidence;
the separate existing execution test still observes real fixed/broken browser runs.
API integration checks include cross-scope and revoked-source denials.

Publication boundary: application code, developer PRs/MRs and requirements are
read inputs. Future Cai VCS writes must be test-only PRs/MRs in a separately
configured Playwright automation repository, with developer review/approval/merge
in the VCS. Separate-repository publishing enforcement and live VCS integration
remain a later milestone; the existing synthetic publisher contract does not prove
that gate. No commit, push, merge or external repository write was performed here.

## Separate automation-repository publication milestone

Date: 5 November 2026. Implements the next bounded publishing lane after the
readiness display. The code supports an explicit GitHub test-proposal command;
the demonstrated end-to-end path uses synthetic VCS transport only.

`TestPlan.publication` binds the separate automation repository ID/name, base
branch/SHA and exact new `tests/**/*.spec.ts` path into the approved plan hash.
Application scope/SHA, test-content revision and automation base SHA remain
distinct. The publisher checks configured/remote target identity, matching
approval, source freshness, registered draft ownership/checksum, meaningful static
assertion, immutable file/blob identity, one added file/commit and draft PR
identity. It rechecks approval/base before writes, never updates default refs or
application files, and does not merge, reopen closed PRs or update existing tests.

The worker publication service uses PostgreSQL approvals and governance events
plus the scoped artifact adapter for receipts. Receipts identify mode, target,
application/test provenance, plan hash, result and recorded run origins; missing
execution stays explicit. Lost commit/PR responses and receipt-storage failure
reconcile via the same plan branch on retry. Legacy destination-less publication
plans remain readable but cannot be newly approved or published. No new database
migration or dependency was added.

Commands added: `npm run demo:publish` (synthetic only) and
`npm run publish:test -- <plan-id> <draft-artifact-id>` (explicitly configured live
command). The Windows helper's `publish` action runs the synthetic demo. Live
configuration defaults off in `.env.example`; the command has no approval-granting
capability and dashboard approval does not publish. Destination information is
visible before approval; legacy plans explain the need for replacement.

Observed checks:

- `npm run check`: exit 0; formatting, lint, strict typecheck, **63 unit/transport
  tests** and build passed. Sixteen publisher cases include wrong/same repository,
  changed destination/content, traversal, no-op assertions, moved base, revoked
  approval, extra application files, uncertain writes and closed proposals.
- `powershell -NoProfile -File scripts/local-postgres.ps1 test`: exit 0;
  **7 files / 18 real PostgreSQL tests**, including three new publication cases
  for approval, receipt/audit scope, destination changes, source revocation and
  storage-failure reconciliation. VCS responses are simulated.
- `powershell -NoProfile -File scripts/local-postgres.ps1 e2e`: exit 0;
  **3 browser tests**, including visible automation destination and approval/
  revocation through normal dashboard entry.
- `powershell -NoProfile -File scripts/local-postgres.ps1 publish`: exit 0;
  actual owned Playwright pass, independent application repo 101 / automation repo
  202, exactly three in-memory VCS writes, repeat reconciliation without extra
  writes, scoped receipts and `realPrCreated: false`.
- Normal `http://127.0.0.1:3000/` browser inspection: destination shown, synthetic
  pass retained, no page errors or outbound VCS request. Authenticated receipt
  download matched its catalog SHA-256 and recorded the synthetic run origin.
  Screenshot: ignored `artifacts/publication-target.png`.
- Direct CLI with `PUBLISH_ENABLED=false`: expected exit 1 before configuration/
  provider access. Credentials/runtime artifacts stay ignored; foundation
  documents unchanged. Existing generated demo files were copied into an ignored
  preservation directory before reseeding; previous DB scopes remain intact.

The current total is **84 passing software tests**, not verified requirements.
The demo API is left running against the latest synthetic scope. No live GitHub
publication, GitLab MR, protected-branch/installation permission test, automated
merge, untrusted execution, commit or push occurred. Live token/race/concurrency
behaviour and CI compatibility in an authorised personal automation repository
remain the next integration gate. See [ADR 0005](adr/0005-separate-automation-publication.md)
and the [publication runbook](runbooks/test-publication.md).
