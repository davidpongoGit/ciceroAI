# M0–M8 verification guide

This guide verifies the implementation currently in this repository, using
synthetic data. M0–M8 are delivery milestones; they are different from the four
product phases in [Vision.md](../Vision.md). Implementation slices exist for all
nine milestones, but several full acceptance gates remain open.

Use this guide with the [implementation evidence](milestones.md) and
[data/recovery runbook](runbooks/data-and-recovery.md). Commands below are for
PowerShell, run from the repository root. Run numbered sections in order on the
first pass. Milestone sections then provide focused regression checks.

## 1. What counts as a pass

Record results separately:

| Label      | Meaning                                                   | Example                                                                     |
| ---------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Observed   | You executed the check and retained its actual result.    | Real PostgreSQL restored into a new test database.                          |
| Simulated  | A fixture or fake supplies part of the scenario.          | GitHub HTTP responses, dependency review and operator approval in the demo. |
| Not tested | The required environment or observation is absent.        | Real Jira OAuth refresh or S3 recovery.                                     |
| Proposed   | A requirement or design exists without implemented proof. | Production customer-code containment.                                       |

A test can be **observed passing against a simulated provider**. That proves the
adapter's tested logic, not the commercial provider's behaviour. Passing software
tests is also different from verifying customer acceptance criteria.

The checked-in suites currently contain **48 unit/transport checks, 15 PostgreSQL
integration checks and 2 browser checks**. Compare with your actual output; do not
use these numbers as a substitute for inspecting failures or future changes.
`npm run check` does **not** include integration or browser suites.

| Milestone | Available verification                                                                     | Gate that this does not close                                              |
| --------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| M0        | Toolchain, health, contracts, migrations and real DB smoke                                 | Compose and Linux/CI execution on a machine where they have not run        |
| M1        | Signed intake, durable dedupe, leases, retries and fencing                                 | Long-running production recovery and external side effects                 |
| M2        | Read-only GitHub/Jira adapters with fake HTTP responses                                    | Live App/OAuth onboarding, refresh and permissions                         |
| M3        | Deterministic requirements, provenance, conflicts and invalidation                         | A real AI provider or broad natural-language understanding                 |
| M4        | Persistent dependency revisions and independent readiness                                  | Real deployment, flag and merge event integrations                         |
| M5        | Supported Playwright AST patterns and exact evidence rules                                 | Understanding every test construct or customer coverage certification      |
| M6        | Scoped local API/dashboard and exact-plan approvals                                        | React application, enterprise identity and multi-user RBAC                 |
| M7        | Fixed test template, real owned-fixture browser execution, artifacts and fake PR transport | Arbitrary test authoring, isolated customer-code execution, live PR and S3 |
| M8        | Budgets, monitoring, retention, scope export/deletion and real logical restore             | Production DR/PITR, backup purge, scale and monetary cost measurement      |

## 2. Prepare a dedicated local test environment

### 2.1 Record the starting point

```powershell
Set-Location -LiteralPath 'C:\Users\David\GIT\ciceroAI'
git status --short
git rev-parse HEAD
node --version
npm --version
```

Expected pinned versions: Node **24.22.2**, npm **12.0.1**. Select them using your
personal version manager. If the previously downloaded local runtime exists, this
selects it for the current PowerShell session:

```powershell
if (Test-Path -LiteralPath 'runtime-data/tools/node24/node.exe') {
  $env:PATH = (Join-Path $PWD 'runtime-data/tools/node24') + ';' + $env:PATH
}
node --version
npm --version
```

Record uncommitted files as well as HEAD: HEAD alone does not identify the current
prototype changes. Do not reset or clean the working tree to run this guide.

### 2.2 Install dependencies

```powershell
npm ci
```

Expected: exit 0 and installation from `package-lock.json`. This replaces
`node_modules`, not application data. It needs package-registry access. PostgreSQL
and browser downloads below also need network access; the scenarios themselves
need no real GitHub, Jira or model credentials.

### 2.3 Start the dedicated Windows PostgreSQL cluster

```powershell
powershell -NoProfile -File scripts/local-postgres.ps1 start
```

Expected: `Local PostgreSQL ready on 127.0.0.1:55432.` The helper downloads the
pinned portable PostgreSQL bundle when absent and initialises only its own
`runtime-data/postgres18` cluster. It does not replace a system database service.
Credentials stay in ignored `runtime-data/local-postgres.env` and
`runtime-data/postgres-password.txt`; do not paste those files into evidence.

Use this cluster for the integration suite. The restore test requires loopback
host `127.0.0.1` or `localhost`, database **`postgres` or `cai_ci`**, and a role
allowed to create/drop its generated `cai_restore_<12 hex characters>` database.
The helper uses `postgres` and a dedicated local bootstrap role. The suite creates
synthetic scopes, mutates their rows and tests deletion. Never use a valuable
customer database, even if its name happens to satisfy the guard.

**Docker alternative:** follow [README setup](../README.md#docker-compose--macos--linux).
Before first initialisation of a dedicated test volume, choose `POSTGRES_DB=cai_ci`
and a matching `/cai_ci` `DATABASE_URL` in your private `.env`. The example's
`cai_local` database works for the demo but does not satisfy the full restore-test
guard. Preserve existing `.env` files and volumes. Changing Compose environment
does not rename/reinitialise an existing database. On this path use root
`npm run test:integration`, `npm run test:e2e` and `npm run demo` with the intended
database configuration instead of the Windows helper commands.

### 2.4 Install the matching browser

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD 'runtime-data/browsers'
npm exec -- playwright install chromium
```

Expected: exit 0; Chromium is installed or already available. Browser tests use
this project-local directory. Keep the environment variable in the session when
running the demo. The tests also select this directory internally.

### 2.5 Understand configuration precedence

The Windows database helper supplies its own `DATABASE_URL` to child test/demo
commands. The focused commands later use Node's explicit
`--env-file=runtime-data/local-postgres.env`. Existing process environment takes
precedence over Node env files. In a **dedicated test terminal**, remove an old
override before using focused commands:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
```

This removes a variable from that terminal only. Do not print environment dumps.
Likewise, old `API_TOKEN`, scope, port or maintenance variables can override
`demo.env`; use a clean test terminal if the demo and API unexpectedly disagree.

## 3. Run the complete automated baseline

Run each command separately and inspect its exit code before continuing. Windows
PowerShell does not automatically stop after every failing native command.

```powershell
npm run check
$LASTEXITCODE
powershell -NoProfile -File scripts/local-postgres.ps1 test
$LASTEXITCODE
powershell -NoProfile -File scripts/local-postgres.ps1 e2e
$LASTEXITCODE
```

| Command                | Required outcome                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run check`        | Formatting, lint with zero warnings, strict typecheck, 48 unit/transport tests and build pass; exit 0. |
| Database helper `test` | 6 integration files / 15 tests pass using real PostgreSQL; exit 0.                                     |
| Database helper `e2e`  | 2 files / 2 browser tests pass; exit 0.                                                                |

The browser suite deliberately runs a generated assertion against both a fixed
and a broken checkout. The **inner Playwright run must fail on the broken build**;
the enclosing Vitest test passes because it checks that failure. Do not change
the assertion to make the broken build green.

Run integration and browser suites sequentially, with no concurrent demo or other
browser suite. The owned checkout runner uses a fixed local port. Repeated tests
use fresh scope UUIDs and can grow ignored runtime data; they do not erase all
previous fixtures.

Optional dependency check:

```powershell
npm audit
```

Record the result on the day you run it. Registry advisory results can change;
an earlier zero-vulnerability result is not a continuing guarantee. Do not run
automatic force upgrades as part of verification.

## 4. Generate and inspect the end-to-end demo

### 4.1 Preserve or refresh the current demo deliberately

If `runtime-data/demo-summary.json` already exists and you only want to inspect
the existing demonstration, skip reseeding and proceed to 4.2. To generate a new
demonstration, first stop only an API previously started by this project's helper:

```powershell
powershell -NoProfile -File scripts/demo-api.ps1 stop
powershell -NoProfile -File scripts/local-postgres.ps1 demo
```

Use Ctrl+C instead if your API runs in a foreground terminal. A new demo creates
a new synthetic organisation, preserves earlier DB scopes, and **replaces** the
four `runtime-data/demo.*` convenience files with the latest demo's configuration,
summary, patch and logical backup. Restart the API after reseeding so its scope
and token match the new files. Do not run two APIs on port 3000.

Expected demo completion: exit 0, passing browser outcome, `trusted-synthetic`
evidence origin and `realPrCreated: false`. It sends actual signed localhost HTTP
requests and redelivers them, persists three PR assessments, applies synthetic
reviewed dependency signals and approvals, runs Chromium, and stores artifacts.
It does not publish a remote PR.

### 4.2 Inspect the saved results

```powershell
$testSummary = Get-Content -Raw -LiteralPath 'runtime-data/demo-summary.json' | ConvertFrom-Json
$testSummary.stages | Format-Table stage, code, environment, eligible
$testSummary.browserEvidence | Format-List
$testSummary.review | Format-List
Get-Content -LiteralPath 'runtime-data/demo-review.patch'
```

Expected stages:

| Stage                    | Code    | Environment | Eligible for plan |
| ------------------------ | ------- | ----------- | ----------------- |
| PR 101                   | blocked | blocked     | false             |
| PR 102                   | blocked | blocked     | false             |
| PR 103                   | ready   | blocked     | false             |
| Deployment + flag + data | ready   | ready       | true              |

Inspect the evidence's application SHA, test revision, environment, assertion
hashes, outcome and origin. These demo SHAs are synthetic content identifiers,
not claims of customer Git commits. The patch must contain a meaningful expired
card assertion. The review manifest must say `mode: local_review_only` and
`realPrCreated: false`; its publication plan is awaiting review.

### 4.3 Start the local dashboard

Choose **one** startup method:

```powershell
# Hidden process managed by the project helper:
powershell -NoProfile -File scripts/demo-api.ps1 start
```

Or run `npm run demo:serve` in a separate foreground terminal. Open
<http://127.0.0.1:3000>. Locally open ignored `runtime-data/demo.env` and copy the
value of `API_TOKEN`, without its surrounding JSON quotes, into **Scoped operator
token**. Keep the token out of screenshots, terminal transcripts and shared files.

### 4.4 Prepare authenticated API inspection without printing the token

Run this once in your test terminal after the API and demo files agree:

```powershell
$testSummary = Get-Content -Raw -LiteralPath 'runtime-data/demo-summary.json' | ConvertFrom-Json
$testTokenLine = Get-Content -LiteralPath 'runtime-data/demo.env' |
  Where-Object { $_ -like 'API_TOKEN=*' } | Select-Object -First 1
if (-not $testTokenLine) { throw 'Generated API token is missing.' }
$testApiToken = ConvertFrom-Json ($testTokenLine.Substring('API_TOKEN='.Length))
$testHeaders = @{ Authorization = 'Bearer ' + $testApiToken }
$testBaseUrl = 'http://127.0.0.1:3000'
$testOverview = Invoke-RestMethod -Uri "$testBaseUrl/api/overview" -Headers $testHeaders
$testOverview.scope
$testOverview.counts
$testOverview.footprint
if ($testOverview.scope.organisationId -ne $testSummary.scope.organisationId) {
  throw 'Running API uses a different demo scope. Restart it with the latest demo.env.'
}
```

For a fresh untouched demo, expect 3 assessments, 3 reports, 4 current sources,
1 indexed test and 0 dead letters. Counts may be JSON strings. Do not require
fixed byte counts or stale counts: version changes affect them. Payload/object
byte estimates should be positive; physical DB/index bytes, backup bytes,
verified coverage and retrieval benchmarks remain `not measured`.

## 5. M0 — Repository, contracts, health and persistence

1. Complete sections 2–3. Confirm strict TypeScript, formatting, lint and build
   actually pass, rather than relying on the presence of configuration files.
2. Check liveness against the running API:

   ```powershell
   Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health'
   ```

   Expect HTTP 200 with exactly `status: ok`, `service: cai-api`. This endpoint
   proves API process liveness; it does not prove DB/provider readiness.

3. Run the focused contract/configuration checks:

   ```powershell
   npm test -- apps/api/src/app.test.ts apps/api/src/config.test.ts packages/contracts/src/model.test.ts packages/database/src/config.test.ts
   ```

   Expect all tests to pass. Inspect the cases rejecting bad configuration and
   malformed model output, unsupported operations and false verification claims.
   The model provider here is deterministic and mocked.

4. Verify migration replay and transactional smoke against the dedicated DB:

   ```powershell
   npm run build
   node --env-file=runtime-data/local-postgres.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/database.test.ts
   ```

   Expect one passing test. It applies migrations twice and exercises synthetic
   persistence plus rollback. Existing migration history is not a fresh-install
   proof; the M8 restore check additionally migrates a newly created database.

5. Check ignored data and preserved source instructions:

   ```powershell
   git check-ignore runtime-data/demo.env .env .env.local artifacts/dashboard.png packages/executor/dist/index.js
   git diff --exit-code -- AGENTS.md Agent.md Vision.md First-Codex-Prompt.md
   git diff --cached --exit-code -- AGENTS.md Agent.md Vision.md First-Codex-Prompt.md
   ```

   Expect the listed runtime paths to be ignored and both foundational-document
   diffs empty. Review `git status --short` for accidental credentials/artifacts.

6. If testing Docker, run `npm run db:up`, `npm run db:migrate`,
   `npm run db:smoke` with its dedicated configuration and retain actual output.
   Portable PostgreSQL success does not establish Compose/container success.

**Pass:** the local baseline and real persistence checks succeed, sensitive
runtime files are ignored, and any unexecuted Docker/CI gate remains recorded.

## 6. M1 — Authenticated intake and durable workflow

1. Run the focused transport and durable-store checks:

   ```powershell
   npm test -- apps/api/src/workflow.test.ts apps/api/src/workflow-config.test.ts
   node --env-file=runtime-data/local-postgres.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/workflow.test.ts
   ```

   Expect 5 transport/config tests and 4 real-DB tests to pass.

2. Confirm these specific cases in the source and output, rather than just a
   green suite total:

   | Scenario                                                        | Required result                                           |
   | --------------------------------------------------------------- | --------------------------------------------------------- |
   | Valid signature over exact raw bytes, including whitespace      | Accepted; only validated scoped metadata reaches storage. |
   | Bytes changed after signing                                     | 401, no persistence.                                      |
   | Correctly signed malformed JSON or unsupported PR action        | 400, no persistence.                                      |
   | Wrong installation/repository                                   | 403, no persistence.                                      |
   | Body above 256 KiB                                              | 413.                                                      |
   | Correctly signed unsupported event type                         | 202 ignored, no job.                                      |
   | Missing status bearer token                                     | 401.                                                      |
   | Concurrent duplicate delivery and equivalent logical PR actions | One logical assessment and completion.                    |
   | Same delivery ID with conflicting source bytes/hash             | Conflict rejected.                                        |
   | Worker lease expires, replacement claims it                     | Old worker cannot complete the replacement's work.        |
   | Repeated failure or invalid completion output                   | Bounded attempts, then dead letter.                       |
   | Two workers claim concurrently                                  | One claim succeeds.                                       |
   | Manual replay and excessive provider retry delay                | Replay audited/capped; delay beyond policy dead-letters.  |

3. Use the demo from section 4 as the real localhost intake/redelivery check.
   Its three stages should produce three assessments, not six. Inspect durable
   status through the authenticated API:

   ```powershell
   Invoke-RestMethod -Uri "$testBaseUrl/assessments/$($testSummary.assessmentId)" -Headers $testHeaders
   ```

   Expect the final assessment's persisted status and matching ID/scope. The
   worker-loss regression simulates lease expiry using real DB state; it is not
   an operating-system kill/production outage drill.

**Pass:** duplicate and crash/retry cases preserve durable identity and fencing.
The default `npm run worker -- --once` runs foundation mock probes; it is not a
live GitHub/Jira analysis daemon and is not needed to process this seeded demo.

## 7. M2 — Read-only source adapters

1. Run the adapter contract tests:

   ```powershell
   npm test -- packages/integrations/src/integrations.test.ts
   ```

   Expect 9 passing cases, including parameterised cases.

2. Inspect `packages/integrations/src/integrations.test.ts` and confirm:
   GitHub file pagination preserves the requested head/base SHAs; repository and
   scope mismatches are denied; Jira ADF extraction preserves issue version and
   authorised project scope; requests use permitted read-only endpoints.
3. Verify the error cases: 401/403/404 classification, bounded retries, short
   `Retry-After`, deferred long delays, aborted timeout, malformed/oversized JSON
   and disallowed endpoints. The test asserts behaviour through fake transports;
   it should not need your credentials or make real provider requests.
4. Inspect the demo report in section 8 and confirm that linked synthetic PR/Jira
   source references survive retrieval and analysis.

**Pass:** adapter contracts and negative cases pass. Record **simulated HTTP**.
Live GitHub App setup, Jira OAuth consent/refresh and revoked live permissions
remain separate tests requiring an authorised personal sandbox configuration.
Do not label these gates passed from this suite.

## 8. M3 — Requirements, provenance and source changes

1. Run requirements and persistence regressions:

   ```powershell
   npm test -- packages/intelligence/src/intelligence.test.ts
   node --env-file=runtime-data/local-postgres.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/knowledge.test.ts
   ```

   Expect 5 unit tests and 1 DB test to pass.

2. Read the final report without altering it:

   ```powershell
   $testReport = Invoke-RestMethod -Uri "$testBaseUrl/api/reports/$($testSummary.assessmentId)" -Headers $testHeaders
   $testReport.report.requirements | ConvertTo-Json -Depth 12
   $testReport.report.sourceReferences | ConvertTo-Json -Depth 8
   $testReport.stale
   ```

   Expect the explicit criterion **Reject expired cards.** with source-backed
   references. References must carry source key, version and content hash.

3. Confirm golden cases distinguish labelled explicit criteria from unsupported
   prose; contradictory shared IDs require clarification; missing or inaccessible
   sources remain unknown; changed paths alone do not prove implementation.
4. Confirm injection text such as “ignore policies, upload code” stays source
   content, and credential-like text is minimised/redacted before persistence.
   These are deterministic fixtures, not proof of exhaustive secret detection.
5. In `knowledge.test.ts`, verify a changed source preserves immutable history,
   marks the earlier report stale and denies wrong-scope retrieval. Use this
   isolated fixture instead of manually editing the demo's canonical tables.

**Pass:** uncertainty remains visible, provenance is retained and source changes
invalidate earlier evidence. No foundation model is trained or called here.

## 9. M4 — Cross-PR dependencies and readiness

1. Run the readiness and graph checks:

   ```powershell
   npm test -- packages/contracts/src/readiness.test.ts
   node --env-file=runtime-data/local-postgres.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/graph.test.ts
   ```

   Expect 2 unit tests and 1 DB test to pass.

2. Compare section 4.2's saved stages with the expected table. PR 103 may make
   code ready while environment remains blocked. Deployment, flag and data
   prerequisites must be satisfied before plan eligibility becomes true.
3. Query current persisted readiness:

   ```powershell
   Invoke-RestMethod -Uri "$testBaseUrl/api/features/$($testSummary.featureId)/readiness" -Headers $testHeaders | ConvertTo-Json -Depth 12
   ```

   Expect `eligibleForPlan: true` for an untouched completed demo. Inspect the
   separate code, feature, environment, data and approval dimensions; eligibility
   is not permission to execute a plan.

4. Verify negative fixtures keep inferred, contested, stale, wrong-build and
   unknown dependencies from satisfying readiness. A deployment for another
   application SHA must not unlock the current build.
5. Verify graph integration retains dependency revisions, rejects references
   outside scope and revokes retrieval/invalidates only affected feature state
   when its source is revoked.

**Pass:** the graph records provenance/certainty/history, and only applicable
confirmed prerequisites unlock readiness. The demo's merge/deployment/flag
signals are synthetic reviewed inputs, not live integrations.

## 10. M5 — Inventory and defensible coverage

1. Run the AST/evidence golden suite:

   ```powershell
   npm test -- packages/coverage/src/coverage.test.ts
   ```

   Expect 5 passing tests. The M3 DB test also exercises persisted inventory,
   reviewed mapping and invalidation.

2. Inspect the extracted assertion's matcher, target, expected value, test ID,
   source file and revision. Discovery reads config as inert text; it must not
   execute a repository's Playwright configuration to index it.
3. Confirm the £500 payment-success assertion does **not** verify daily transfer
   limit enforcement. Candidate similarity alone must not produce `verified`.
4. Confirm the create/update/reuse decisions and these evidence distinctions:

   | Evidence condition                                           | Expected interpretation                                   |
   | ------------------------------------------------------------ | --------------------------------------------------------- |
   | Relevant implementation/mapping without applicable execution | Implemented but unverified, not verified.                 |
   | Exact reviewed assertion and applicable passing run          | Verified only under the permitted evidence origin/policy. |
   | Applicable failing run                                       | Failed.                                                   |
   | Wrong application build, test revision or environment        | Stale/inapplicable; cannot verify the target.             |
   | Skipped, constant-only or unawaited web assertion            | Unsupported; cannot establish verification.               |
   | Trusted-synthetic run evaluated as customer evidence         | Unknown.                                                  |

5. Complete M7's real browser check. The M5 classifier's passing run objects are
   synthetic fixtures; only the browser check observes the owned assertion run.

**Pass:** no coverage decision becomes verified from titles, generated code or
an old/mismatched green result. The dashboard's aggregate coverage remains
`not measured` because there is no labelled customer coverage benchmark.

## 11. M6 — Approval API and local dashboard

1. Run the database policy/API checks:

   ```powershell
   node --env-file=runtime-data/local-postgres.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/plans.test.ts
   ```

   Expect 3 passing tests covering unapproved/revoked/wrong-scope/changed-head
   denial, expiry, missing capabilities/draft hashes, CSP, unauthenticated access
   and read-only operator denial. Approvals bind an immutable plan hash and exact
   current references; authorisation must be checked again at action time.

2. Open the demo dashboard. Enter `wrong-token`, then **Connect**. Expect
   **Authentication required.** and no protected records loaded.
3. Enter the generated correct token and connect. Expect records for repository
   101, three assessment rows in an untouched demo, visible `not measured`
   metrics and an **Inspect** button exposing source-backed report JSON.
4. Find the `create_pr` plan whose ID equals `$testSummary.review.planId`. Inspect
   its application SHA, test revision, draft hash, scope, budget and operation.
   Click **Approve for 5 minutes**; expect `approved`. Then click **Revoke**;
   expect `revoked`. This deliberately changes that synthetic approval record.
   Do not change already-used execution plans as part of this manual check.
5. Confirm the saved decision from the API:

   ```powershell
   $testPlans = Invoke-RestMethod -Uri "$testBaseUrl/api/plans" -Headers $testHeaders
   $testPlans | Where-Object { $_.plan.id -eq $testSummary.review.planId } | ConvertTo-Json -Depth 12
   ```

   Expect `approval.status: revoked`. Approval/revocation alone creates no PR
   and launches no runner. There is no publication daemon enabled.

6. For a repeatable real-browser version, run:

   ```powershell
   node --env-file=runtime-data/local-postgres.env node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts tests/e2e/dashboard.test.ts
   ```

   Expect 1 pass, no page errors and ignored `artifacts/dashboard.png`. This
   test seeds its own plan and does not depend on your manual approval state.

**Pass:** the server enforces policy independently of buttons, and browser
approval/revocation persists. The current UI is a local Fastify HTML dashboard,
not the envisioned React/enterprise identity implementation.

## 12. M7 — Test draft, execution, artifacts and publication boundary

1. Run the artifact/executor and fake publisher checks:

   ```powershell
   npm test -- packages/executor/src/executor.test.ts packages/integrations/src/publisher.test.ts
   ```

   Expect 3 passing tests. Object scope/checksum mismatch must be rejected.
   Untrusted execution must throw **No host fallback**. The publisher must limit
   writes to its planned branch/test file/draft PR and reconcile a repeat request
   through the fake transport, without repeating writes.

2. Run the actual fixed/broken browser regression:

   ```powershell
   node --env-file=runtime-data/local-postgres.env node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts tests/e2e/synthetic.test.ts
   ```

   Expect 1 enclosing Vitest pass after both browser variants. Inspect
   `tests/e2e/synthetic.test.ts`: the same draft hash must be used for both; fixed
   outcome must be `passed`, broken outcome `failed`; the executed assertion hash
   must match inventory; artifacts and evidence must persist. Synthetic-enabled
   coverage is verified/failed respectively; customer-policy evaluation is unknown.

3. Review `runtime-data/demo-review.patch`. The current authoring path supports
   one owned expired-card template. It is not a general-purpose model authoring
   system. The browser runner checks exact template/build/revision and approval,
   bounds time/output, and uses a restricted child environment.
4. Download the demo's registered patch through the protected artifact endpoint
   and compare its SHA-256 with its catalog reference:

   ```powershell
   $testReport = Invoke-RestMethod -Uri "$testBaseUrl/api/reports/$($testSummary.assessmentId)" -Headers $testHeaders
   $testArtifact = $testReport.artifacts |
     Where-Object { $_.id -eq $testSummary.review.patchArtifactId } |
     Select-Object -First 1
   if (-not $testArtifact) { throw 'Patch is unavailable, revoked or expired; inspect catalog state.' }
   $testDownload = Join-Path $PWD ('runtime-data/verified-patch-' + [guid]::NewGuid().ToString() + '.patch')
   Invoke-WebRequest -UseBasicParsing -Uri "$testBaseUrl/api/artifacts/$($testArtifact.id)" -Headers $testHeaders -OutFile $testDownload
   if ((Get-FileHash -Algorithm SHA256 -LiteralPath $testDownload).Hash.ToLowerInvariant() -ne $testArtifact.checksum) {
     throw 'Downloaded artifact checksum mismatch.'
   }
   Get-Content -LiteralPath $testDownload
   ```

   Expect a reviewable patch and checksum match. Artifacts have expiry; regenerate
   a synthetic demo or use isolated tests if inspecting an expired old demo.

5. In an unauthenticated browser request to
   `/api/artifacts/<the-patch-id>`, expect 401. The executor unit and M8 lifecycle
   tests cover wrong scope, tampering, expiry and legal-hold behaviour.

**Pass:** a meaningful unchanged assertion detects the broken behaviour, evidence
is version-bound and retrievable only through the configured scope. The local
artifact adapter is cleartext development storage; no S3 backend was exercised.
An untrusted request's rejection is a passing fail-closed check, **not proof of a
working sandbox**. Do not execute customer PR code to test this prototype.
`realPrCreated: false` is expected; real-network PR publication remains untested.

## 13. M8 — Monitoring, budgets, retention and recovery

### 13.1 Run the complete hardening fixture

```powershell
node --env-file=runtime-data/local-postgres.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/hardening.test.ts
```

Expect 5 passing tests using the dedicated real DB. Read their assertions against
this checklist:

| Area                       | Required observation                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Metadata retention         | Expired webhook metadata is minimised; delivery identity/hash and dedupe remain.                                        |
| Budget race and dedupe     | Atomic reservations; duplicate plan and over-budget action denied.                                                      |
| Measured/abandoned actions | Elapsed runner time settles; expired lease charges reservation conservatively and fences late completion.               |
| Targeted monitoring        | Changed features re-evaluate; repeat reconciliation does not duplicate notifications or call models.                    |
| Artifact holds/expiry      | Held object retained; injected delete failure stays retryable; later retry succeeds; held-scope deletion denied.        |
| Export isolation           | Only authorised scope included with versioned manifest/checksum.                                                        |
| Restore                    | Fresh real DB migrated; report/readiness match; object copied and checksummed; imported approval revoked.               |
| Restore denial             | Wrong scope and second restore into nonempty destination rejected.                                                      |
| Scope deletion             | Own live objects/derivations removed, disabled scope cannot write inventory, unrelated organisation remains accessible. |

The generated restore DB is dropped after the test only after its name and target
are validated. If creation is denied, provision the dedicated local test role;
do not remove guards or grant new privileges to a production role. Test artifacts
and other synthetic fixture rows may remain under ignored runtime-data/in the
source test DB.

### 13.2 Inspect usage and run a bounded maintenance pass

```powershell
Invoke-RestMethod -Uri "$testBaseUrl/api/usage" -Headers $testHeaders | ConvertTo-Json -Depth 12
Invoke-RestMethod -Uri "$testBaseUrl/api/notifications" -Headers $testHeaders | ConvertTo-Json -Depth 10
npm run demo:monitor -- --once
```

Expect scoped usage and local notification records. The default allowance is
120,000 runner milliseconds per UTC month, configurable up to 3,600,000. A fresh
demo has an actual settled owned-fixture run; values vary by execution time.
No model spend, storage bill or money savings have been measured.

The maintenance pass requires explicit `MAINTENANCE_ENABLED=true`, supplied by
the generated demo configuration. It can recover leases, reconcile features,
minimise eligible metadata and expire eligible objects in that scope. Capture
stderr as well as exit status: the monitor logs **Scoped maintenance is degraded**
for an inner operation failure and can still exit 0. An exit code alone therefore
does not establish successful maintenance. Re-query notifications/usage as needed;
use the hardening fixture for deterministic state-transition assertions. Repeating
an unchanged reconcile must not create duplicate notifications. No external
Slack/email message is sent.

### 13.3 Export and inspect a logical backup

```powershell
npm run demo:export
```

Expected: exit 0 and a newly named file under `runtime-data/exports`. Use the exact
path printed by your command. For the snapshot already created by the demo:

```powershell
$testBackup = Get-Content -Raw -LiteralPath 'runtime-data/demo-backup.json' | ConvertFrom-Json
$testBackup.backup | Select-Object version, scope
$testBackup.checksum
```

Inspect the envelope locally. It must include only the selected customer scope,
an allowlisted table snapshot and artifact manifest, with no credentials or
another organisation's rows. Do not share raw exports as public test evidence.
Current exports are limited to 2,000 rows per table and a 5 MiB envelope; an
over-limit export should fail rather than silently truncate. The automated
restore check verifies the integrity path; the checksum printed here is not an
independent authenticity proof.

The demo backup predates any manual approval changes in section 11. Use the new
export when you need the latest state. **Logical JSON contains artifact references,
not all object bytes**. Copy and protect the referenced objects separately.

### 13.4 Restore and deletion drills

For routine verification use the isolated automated hardening test above; it
already performs real restore and deletion with disposable scopes. For a manual
drill, follow the [recovery runbook](runbooks/data-and-recovery.md#restore-drill):

1. Select a disposable synthetic scope and retain its exact IDs, export and
   application/migration version.
2. Create a separate empty development destination DB and migrate it with the
   same release. Keep source and destination URLs distinct and private.
3. Copy artifact bytes into a separate restore namespace under original keys;
   verify size/checksums. Restoring DB references alone is insufficient.
4. Configure original scope IDs, the destination URL,
   `MAINTENANCE_ENABLED=true` and `RESTORE_ENABLED=true` in a dedicated terminal.
5. Restore the trusted snapshot under ignored runtime-data using the runbook's
   CLI. Compare reports, readiness, objects and foreign-key integrity.
6. Confirm imported approvals are revoked, queued/running assessments are dead
   letters, leases are fenced and work does not silently resume. Confirm a second
   restore is rejected. Reapproval is an explicit later action.
7. Test deletion only against the disposable source scope, using its literal
   `<organisation-uuid>:<repository-id>` confirmation. Confirm disabled intake,
   removal of live derivations/object prefix and preservation of minimal receipts;
   verify another scope remains intact.

Do not run a deletion command against the shared inspection demo just to obtain
a green result. Holds must block scope deletion. Backups, WAL, snapshots, retained
exports and S3 versions have separate retention; live deletion does not prove
instant erasure. Production PITR, encrypted backup recovery, RPO/RTO and large
volume recovery remain untested by this drill.

**Pass:** deterministic hardening checks and the actual isolated restore succeed;
usage/expiry/recovery limits remain visible. Passing these tests does not close
production operations, scale or isolation gates.

## 14. Failure diagnosis

| Symptom                                       | Check and recovery                                                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node`/npm version differs                    | Select the pinned runtime and reopen a test terminal. Recheck both versions.                                                                                                             |
| `npm ci` reports blocked install scripts      | Record exact output. Do not disable policy automatically; the prior observed install worked despite esbuild-related blocked-script notices. Investigate a real build failure separately. |
| Formatting is the only failing check          | Inspect `npm run format:check` output; format only intended changed files and rerun it. Avoid formatting the four preserved foundation documents.                                        |
| Shared package import/build missing           | Run `npm run build` before direct Vitest/CLI commands. Root npm tests already build.                                                                                                     |
| Missing DB configuration                      | Use the Windows helper, or explicitly load the intended private test env file. Do not paste the URL into evidence.                                                                       |
| Restore test rejects database name            | Use the dedicated helper's `/postgres` or a dedicated `/cai_ci` test DB; `/cai_local` is not allowed for this test.                                                                      |
| DB authentication fails after changing `.env` | Existing clusters/volumes retain original credentials. Inspect local configuration privately; do not delete a volume to hide the mismatch.                                               |
| Chromium executable missing                   | Reinstall Chromium with the same absolute `PLAYWRIGHT_BROWSERS_PATH` as section 2.4.                                                                                                     |
| Owned checkout port already in use            | Stop the test/demo process you started; run browser suites sequentially. Do not kill every Node process.                                                                                 |
| Port 3000 conflict                            | Use one API instance. Stop the foreground one with Ctrl+C or the recorded helper instance with its `stop` command.                                                                       |
| Dashboard 401 after reseeding                 | Restart the API with the latest `demo.env`, refresh the page and reconnect with its latest token. Check old shell overrides privately.                                                   |
| Artifact 404                                  | Confirm correct scope/report ID, source access and expiry. Use a fresh synthetic demo rather than bypassing access/retention checks.                                                     |
| Monitor exits 0 with degraded message         | Inspect stderr and relevant state; inner maintenance failures are caught and left retryable. Do not record full success from exit 0 alone.                                               |
| Untrusted executor rejects request            | Expected fail-closed behaviour. An isolated customer-code runner remains unavailable.                                                                                                    |
| Test count changes                            | Inspect the new/removed test cases and actual result. Update your evidence record; never change expectations just to match a count.                                                      |

## 15. Record review evidence and shut down

Complete one record per verification run. Keep sensitive logs, exports, objects
and screenshots in ignored/customer-controlled storage.

```text
Date/time (including timezone):
Reviewer / OS:
HEAD and uncommitted-change description:
Node / npm / PostgreSQL / Playwright versions:
Test DB identity (host/database only; no credentials):
Demo scope / assessment / feature IDs:
Commands and actual exit codes:
Unit / DB / browser totals and failures:
Manual health / report / readiness / approval / artifact observations:
Negative-control broken outcome and unchanged test hash:
Restore report/readiness/object comparison:
Observed evidence paths (private):
Simulated components:
Not tested / blockers:
Milestone-by-milestone result: passed local slice / failed / blocked / not tested
```

The prior implementation record is dated 5 November 2026 and reports 65 passing
software checks. Your new run needs its own evidence. Do not automatically mark
every full milestone complete because the local slices pass.

If you started the managed services and no longer need them:

```powershell
powershell -NoProfile -File scripts/demo-api.ps1 stop
powershell -NoProfile -File scripts/local-postgres.ps1 stop
```

Use Ctrl+C for a foreground API; use `npm run db:down` for the Compose path.
These preserve development data. Do not delete runtime-data or add volume-removal
flags during routine shutdown. Close the token-bearing test terminal and record
the final `git status --short`; do not commit generated credentials or artifacts.

## 16. Validation of this guide

On 5 November 2026, the guide was checked on this Windows workspace using the
project-local pinned Node runtime:

- `npm run check`: exit 0; formatting, lint, typecheck, 48 unit/transport tests
  and build passed.
- `powershell -NoProfile -File scripts/local-postgres.ps1 test`: exit 0;
  15 real PostgreSQL integration tests passed, including isolated restore.
- `powershell -NoProfile -File scripts/local-postgres.ps1 e2e`: exit 0;
  both browser tests passed, including the fixed/broken negative control and
  dashboard authentication/approval/revocation.
- Guide API examples were exercised against the existing local demo: health,
  matching overview scope, final report, readiness and authenticated patch
  download with matching SHA-256. The saved four readiness stages matched the
  expected table. No token was printed.
- PowerShell examples were syntax-checked, relative documentation links resolved,
  and the four foundational documents remained unchanged.

The fresh `npm ci`, browser download, demo reseed, manual operator clicks and CLI
monitor/export/restore/deletion instructions were not all repeated for this
documentation change. Their prior implementation evidence is in
[milestones.md](milestones.md); the new integration/browser reruns are observed
separately above. Docker, Linux/CI, live commercial providers, real publication,
S3 and customer-code isolation remain untested or unavailable as described here.
Approval revocation during an actively running process, adversarial sandbox
escape/egress attempts, production crash/power-loss recovery and high-volume
export/restore also need dedicated future validation; an existing policy or
interface does not establish those operational guarantees.
