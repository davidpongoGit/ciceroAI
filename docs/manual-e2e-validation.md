# Manual end-to-end validation

Follow these steps in Windows PowerShell from the repository root. Each step has
an action, an expected result and evidence to record. The walkthrough validates
the local prototype through its normal dashboard and existing commands.

Run native commands one at a time. Stop on an unexpected failure; the deliberate
disabled-publication check in Step 12 is expected to return exit 1.

Use two runs:

1. **Readiness and manual approval:** prepare the normal demo, inspect evidence,
   approve/revoke its publication plan and verify persistence.
2. **Synthetic publication:** prepare a new demo with simulated publication and
   inspect its persisted first/replay receipts.

The second run creates a **new organisation, plan and token**, with fixture
approvals. It does not publish the plan you revoked in the first run. Application
repositories remain read-only; no real GitHub/Jira/model credentials are needed.

Demo commands prepare synthetic data and execute the owned Playwright fixture;
you then inspect the results manually. There is no manual onboarding wizard,
payment application, Run Test button or Publish button. The dashboard displays
persisted evidence and manages plan decisions; publication is a separate command.

The [M0–M8 guide](test-guide-m0-m8.md) covers individual regressions. Actual live
publication has a separate [operator runbook](runbooks/test-publication.md).

## Step 1 — Prepare the environment

**Action**

1. Open a dedicated PowerShell terminal using personal tools and synthetic data.
2. Run:

   ```powershell
   Set-Location -LiteralPath 'C:\Users\David\GIT\ciceroAI'
   git status --short
   git rev-parse HEAD
   if (Test-Path -LiteralPath 'runtime-data/tools/node24/node.exe') {
     $env:PATH = (Join-Path $PWD 'runtime-data/tools/node24') + ';' + $env:PATH
   }
   node --version
   npm --version
   $env:PUBLISH_ENABLED = 'false'
   $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD 'runtime-data/browsers'
   ```

3. If dependencies/browser are not already installed, run separately:

   ```powershell
   npm ci
   npm exec -- playwright install chromium
   ```

4. Build and start the dedicated database:

   ```powershell
   npm run build
   powershell -NoProfile -File scripts/local-postgres.ps1 start
   ```

**Expected result**

- Node `v24.22.2`, npm `12.0.1`; select the pinned runtime with your version
  manager if the local binary is absent.
- Each native command succeeds with exit 0. Check `$LASTEXITCODE` immediately
  after a command if uncertain; PowerShell does not automatically stop after
  every failed native command.
- Dedicated PostgreSQL is available on `127.0.0.1:55432`. Its credentials stay
  in ignored runtime-data; it does not replace a system database service.

Keep pre-existing working-tree changes. Use a clean terminal if old scope, port
or token variables override demo configuration. Do not print an environment dump
or overwrite `.env`. First-time package/database/browser downloads need network.

**Record:** HEAD/uncommitted changes, runtime versions and command results.

## Step 2 — Prepare the normal, unpublished demo

**Action**

1. If retaining the previous demo matters, copy its four convenience files into
   a new folder under ignored `runtime-data`: `demo.env`, `demo-summary.json`,
   `demo-review.patch`, `demo-backup.json`. Protect the copied credential file.
2. Stop a helper-managed API, prepare the normal demo, then start its API:

   ```powershell
   powershell -NoProfile -File scripts/demo-api.ps1 stop
   powershell -NoProfile -File scripts/local-postgres.ps1 demo
   powershell -NoProfile -File scripts/demo-api.ps1 start
   ```

   Run commands separately and diagnose any failure before proceeding. Use Ctrl+C
   for an API running in a foreground terminal; run one API on port 3000.

3. Open `runtime-data/demo-summary.json` locally. Record `scope`, `assessmentId`,
   `featureId` and `review.planId`.

**Expected result**

- Successful completion, browser outcome `passed`, origin `trusted-synthetic`
  and `realPrCreated: false`.
- `publication` in this normal run's summary is `null`.
- The final `create_pr` plan awaits approval. Draft/execute fixture plans may
  already show synthetic approval or expiry; they are different plans.
- Previous database scopes remain; the latest demo files now contain a new
  scope/token. The API must use those new files.

The preparation actually sends signed localhost webhooks, duplicates them,
persists/processes three PRs and records an owned browser run. Synthetic source
and review signals do not prove live GitHub/Jira integration.

**Record:** completion output and scope/assessment/feature/publication-plan IDs.

## Step 3 — Check health and dashboard authentication

**Action**

1. Open <http://127.0.0.1:3000/health> in your browser.
2. Open <http://127.0.0.1:3000/> through the normal address bar.
3. Enter `wrong-token` in **Scoped operator token** and click **Connect**.
4. Open `runtime-data/demo.env` locally in VS Code. Copy only the `API_TOKEN`
   value, without surrounding quotes. Enter it in the dashboard and connect.

**Expected result**

- Health: `{"status":"ok","service":"cai-api"}`. This is process liveness,
  not database/provider readiness.
- Before connection, protected records are not loaded.
- Wrong token: **Authentication required.**
- Correct token: **Loaded records for repository 101.**
- The password field clears; the token is not saved in the URL/browser storage.

Keep tokens out of screenshots/transcripts. Visiting `/api/overview` directly
in a browser carries no bearer header and should return HTTP 401, even after
the dashboard itself has connected.

**Record:** health response and authenticated dashboard screenshot without a token.

## Step 4 — Distinguish analysis completion from readiness

**Action**

1. Find PRs #101, #102 and #103 in **Latest assessments**.
2. Click **Inspect** for PR #103. Compare its assessed revision and feature target.
3. Inspect PR #101 and #102, then return to #103.

**Expected result**

| Observation                            | Expected display                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Fresh demo rows                        | Three assessments, “Reject expired cards.” and full application revisions.                                       |
| Analysis                               | `assessment_ready`; detail says **Analysis complete (assessment_ready). Test readiness is assessed separately.** |
| PR #103 after all seeded prerequisites | **Ready for automated Playwright E2E testing**; code, feature, environment and data ready.                       |
| Current PR #103 blockers               | No prerequisite blockers recorded for this feature target.                                                       |
| Execution permission                   | A separately approved plan and configured runner are still required.                                             |
| Earlier assessed builds                | **Readiness unknown for this assessed revision: the feature now targets another build.**                         |

Earlier rows report current applicability to their assessed build. Their
historical blocked states are in Step 5. A later target's readiness must not be
copied to an earlier revision; a completed analysis alone does not prove readiness.

**Record:** PR #103's SHA/verdict and an earlier revision's unknown verdict.

## Step 5 — Inspect the persisted prerequisite history

**Action**

1. With PR #103 selected, expand **Prerequisite history (reconstructed)**.
2. Read the note, timestamps, actors and explanations.
3. Locate these transitions. Early entries while the initial dependency inventory
   is being populated can legitimately have unknown dimensions.

**Expected result**

| Stage to locate                                                   | Expected interpretation                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| End of PR #101's group, after initial prerequisites are populated | Code blocked by pending `pr102`/`pr103`; environment blocked.         |
| PR #102 / `pr102` satisfied                                       | Code still blocked by remaining `pr103`; not E2E-testable.            |
| PR #103 / `pr103` satisfied                                       | Code ready, environment blocked by deployment and/or `checkout_flag`. |
| Deployment satisfied while flag is pending                        | Environment still blocked.                                            |
| Flag satisfied with deployment and data in place                  | Ready for automated Playwright E2E testing.                           |

Data is already satisfied in the initial seeded inventory; do not invent a later
data-creation event. Explanations identify synthetic scenario signals.

History replays persisted revisions using the **current** feature target,
inventory completeness and source validity. PR labels identify the latest linked
analysis before a change, not causality. Historical target/inventory decisions
were not captured as full stage snapshots. Record that limitation. Missing or
unavailable history is not a proven historical verdict.

**Record:** code-blocked, environment-blocked and ready entries with keys/timestamps.

## Step 6 — Review execution, coverage and the generated test

**Action**

1. Under PR #103, inspect **Recorded Playwright results** and **Verified coverage**.
2. Inspect an earlier PR to see the missing-execution state, then return to #103.
3. Open `runtime-data/demo-review.patch` locally.

**Expected result**

- #103 shows **Passed (synthetic; repository-owned fixture)** with application
  SHA, test revision, `synthetic-checkout`, finish time and assertion hashes.
- Its application revision matches the assessed build. The text explains that
  a recorded pass does not establish verified coverage.
- Earlier assessments show **Execution evidence unavailable**; they do not borrow
  #103's run.
- Coverage says **Not measured** in both the summary metric and detail.
- The patch adds only `tests/expired-card.spec.ts`, with a meaningful assertion
  expecting **Card expired** and synthetic expiry input `01/20`. It changes no
  application code, workflow or existing test.

Demo application/test SHAs are synthetic content identifiers. Simulated VCS
base/head values later do not establish real GitHub commits. Display inspection
does not independently reproduce the broken-build negative control; there is
no manual toggle. The existing browser regression covers that case.

**Record:** run origin/outcome/revisions, assertion hash, coverage state and patch.

## Step 7 — Inspect the destination; approve and revoke

**Action**

1. In **Approval queue**, select the `create_pr` plan with the exact
   `review.planId` from Step 2. Do not select an already-used draft/execute plan.
2. Review its hash, revisions, checksum and **Automation destination**.
3. Click **Approve for 5 minutes**. Refresh evidence and find the plan again.
4. Click **Revoke**. Reinspect #103's readiness and recorded pass.

**Expected result**

- Application scope: repository `101`. Separate destination:
  `synthetic/playwright`, repository `202`, branch `main`, an independent base
  SHA and exact path `tests/expired-card.spec.ts`.
- The badge changes to `approved`, then `revoked`.
- Approval alone publishes/merges nothing. The normal demo's `publication`
  summary remains `null`.
- Prerequisites can remain ready and the historical pass remains recorded after
  plan revocation. These are separate states.

If approval expires before revocation, record `expired`; approve again only if
repeating that transition. Never edit plan bytes/target to reuse an old approval.
Legacy destination-less plans require a new plan/approval.

**Record:** exact plan/hash/target and approved/revoked screenshots.

## Step 8 — Verify normal restart persistence

**Action**

```powershell
powershell -NoProfile -File scripts/demo-api.ps1 stop
powershell -NoProfile -File scripts/local-postgres.ps1 stop
powershell -NoProfile -File scripts/local-postgres.ps1 start
powershell -NoProfile -File scripts/demo-api.ps1 start
```

Reload the dashboard, reconnect with the same token, and find the same records.

**Expected result**

- Assessment/feature/plan IDs, revisions, readiness and recorded run remain.
- The publication plan remains revoked after Step 7.
- A page reload requires token entry again; service restart does not publish/rerun.

This demonstrates normal restart persistence, not worker-crash, power-loss,
lost-response or disaster recovery.

**Record:** matching IDs and revoked state after restart.

## Step 9 — Corroborate the dashboard through authenticated reads

**Action**

Load the current demo configuration without printing the token or headers. Repeat
this block whenever a later step prepares a new demo:

```powershell
$manualBaseUrl = 'http://127.0.0.1:3000'
$manualSummary = Get-Content -Raw -LiteralPath 'runtime-data/demo-summary.json' | ConvertFrom-Json
$manualTokenLine = Get-Content -LiteralPath 'runtime-data/demo.env' |
  Where-Object { $_ -like 'API_TOKEN=*' } | Select-Object -First 1
if (-not $manualTokenLine) { throw 'Generated API token is missing.' }
$manualToken = ConvertFrom-Json ($manualTokenLine.Substring('API_TOKEN='.Length))
$manualHeaders = @{ Authorization = 'Bearer ' + $manualToken }
$manualOverview = Invoke-RestMethod -Uri "$manualBaseUrl/api/overview" -Headers $manualHeaders
$manualReport = Invoke-RestMethod -Uri "$manualBaseUrl/api/reports/$($manualSummary.assessmentId)" -Headers $manualHeaders
$manualPlans = Invoke-RestMethod -Uri "$manualBaseUrl/api/plans" -Headers $manualHeaders
```

Inspect these non-secret fields:

```powershell
$manualOverview.scope
$manualOverview.counts
$manualReport.report.sourceReferences | Format-Table sourceKey, version, contentHash
Invoke-RestMethod -Uri "$manualBaseUrl/api/features/$($manualSummary.featureId)/readiness" -Headers $manualHeaders | Format-List
$manualPlans | Where-Object { $_.plan.id -eq $manualSummary.review.planId } |
  Select-Object hash, approval, @{Name='Destination';Expression={$_.plan.publication}}
```

**Expected result**

- Overview scope matches the summary. Fresh untouched scope: 3 assessments,
  3 reports, 4 current sources, 1 indexed test and 0 dead letters.
- Synthetic source references carry keys, versions and hashes.
- Current readiness's application SHA/dimensions match the dashboard;
  `eligibleForPlan` is true. Its `approval` dimension is a generic blocked gate,
  not the selected plan's approval status.
- The publication plan's own approval is revoked, matching Step 7.

If scope/token differs, stop and correct API startup/configuration before
recording a pass. Never print `$manualHeaders` or the environment file.

**Record:** selected API fields, excluding headers/token.

## Step 10 — Prepare a separate synthetic publication run

**Action**

Retain the first run's evidence and copy its four convenience files if needed.
Then run:

```powershell
$manualReadinessOrganisationId = $manualSummary.scope.organisationId
powershell -NoProfile -File scripts/demo-api.ps1 stop
powershell -NoProfile -File scripts/local-postgres.ps1 publish
powershell -NoProfile -File scripts/demo-api.ps1 start
```

Repeat Step 9's connection-loading block to refresh summary/token/report/plans.
Reload the browser and enter the new token. Compare organisation IDs.

**Expected result**

- Helper action `publish` runs **`npm run demo:publish`**, with an in-memory VCS
  transport. It does not run the opt-in live publisher.
- New scope, plan and token. The earlier revoked plan is not reused.
- A real owned-fixture pass is followed by fixture approval and simulated
  branch/file/draft-PR writes.
- Console: `realPrCreated: false`, `simulated_awaiting_review`,
  `simulatedWrites: 3`, `reconciled: true`.
- Earlier DB scopes remain; latest convenience files/API refer to the new run.

**Record:** both organisation IDs and the new completion summary. This is evidence
of the seeded simulated flow, not publication under your earlier manual approval.

## Step 11 — Validate first/replay publication receipts

**Action**

1. Inspect summary metadata:

   ```powershell
   $manualSummary.publication | Select-Object mode, status, externalPullRequest, simulatedWrites, receiptArtifactId, reconciliationReceiptArtifactId
   $manualSummary.publication.automationTarget
   $manualSummary.publication.executionEvidence
   ```

2. Download the first receipt through the authenticated artifact endpoint:

   ```powershell
   $manualReceiptId = $manualSummary.publication.receiptArtifactId
   $manualReceiptRef = $manualReport.artifacts | Where-Object { $_.id -eq $manualReceiptId } | Select-Object -First 1
   if (-not $manualReceiptRef) { throw 'Receipt unavailable, revoked or expired.' }
   $manualReceiptPath = Join-Path $PWD ('runtime-data/manual-receipt-' + [guid]::NewGuid().ToString() + '.json')
   Invoke-WebRequest -UseBasicParsing -Uri "$manualBaseUrl/api/artifacts/$manualReceiptId" -Headers $manualHeaders -OutFile $manualReceiptPath
   (Get-FileHash -Algorithm SHA256 -LiteralPath $manualReceiptPath).Hash.ToLowerInvariant() -eq $manualReceiptRef.checksum
   $manualFirstReceipt = Get-Content -Raw -LiteralPath $manualReceiptPath | ConvertFrom-Json
   $manualFirstReceipt | Select-Object mode, status, externalPullRequest, planId, planHash, draftChecksum
   $manualFirstReceipt.result
   ```

3. Download and compare the replay receipt:

   ```powershell
   $manualReplayId = $manualSummary.publication.reconciliationReceiptArtifactId
   $manualReplayRef = $manualReport.artifacts | Where-Object { $_.id -eq $manualReplayId } | Select-Object -First 1
   if (-not $manualReplayRef) { throw 'Replay receipt unavailable, revoked or expired.' }
   $manualReplayPath = Join-Path $PWD ('runtime-data/manual-replay-' + [guid]::NewGuid().ToString() + '.json')
   Invoke-WebRequest -UseBasicParsing -Uri "$manualBaseUrl/api/artifacts/$manualReplayId" -Headers $manualHeaders -OutFile $manualReplayPath
   (Get-FileHash -Algorithm SHA256 -LiteralPath $manualReplayPath).Hash.ToLowerInvariant() -eq $manualReplayRef.checksum
   $manualReplayReceipt = Get-Content -Raw -LiteralPath $manualReplayPath | ConvertFrom-Json
   $manualReplayReceipt.result
   ```

4. Compare both receipts with the new `create_pr` plan shown by dashboard/API.

**Expected result**

| Check                     | Expected                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Both checksum comparisons | `True`.                                                                                       |
| Mode / external existence | `synthetic` / `externalPullRequest: false`.                                                   |
| Outcome                   | `simulated_awaiting_review`; no external PR exists.                                           |
| Scope vs target           | Application repository `101`; automation `202`, `synthetic/playwright`.                       |
| Exact binding             | Receipt plan ID/hash, draft checksum and destination/base/path match the approved plan.       |
| Recorded execution        | Matching run ID, `passed`, `trusted-synthetic`, `synthetic-checkout`.                         |
| First vs replay           | Same proposal number, branch, head SHA and URL; first `reused: false`, replay `reused: true`. |
| Total writes              | Three total, not three more on replay.                                                        |

The simulated URL is a fixture identifier; do not expect a real GitHub page.
Summary write counts describe the seeded run. Catalog-backed receipt downloads
provide persisted outcome/integrity evidence, not an independent live GitHub
audit. Publication does not turn unmeasured coverage into verified coverage.

**Record:** receipt IDs, checksum results and matching/reuse fields.

## Step 12 — Check unauthenticated access and disabled publication

**Action**

1. Visit `/api/overview` and `/api/artifacts/<receipt-id>` directly in a browser
   without a bearer header, using the actual receipt ID from Step 11.
2. Run the live command with its enable flag explicitly false:

   ```powershell
   $env:PUBLISH_ENABLED = 'false'
   npm run publish:test -- $manualSummary.review.planId $manualFirstReceipt.draftArtifactId
   $LASTEXITCODE
   ```

**Expected result**

- Both unauthenticated requests return HTTP 401 without protected payloads.
- The disabled command returns exit **1** before provider/configuration access,
  even with valid seeded plan/draft IDs. It may build first.
- No external branch/PR is created. Do not enable real publication to make this
  expected denial green. A live personal sandbox is a separate integration gate.

**Record:** HTTP status codes and expected disabled-command exit code.

## Step 13 — Inspect usage, maintenance and scoped export

**Action**

1. Read usage and notifications:

   ```powershell
   Invoke-RestMethod -Uri "$manualBaseUrl/api/usage" -Headers $manualHeaders | Format-Table
   Invoke-RestMethod -Uri "$manualBaseUrl/api/notifications" -Headers $manualHeaders | Format-Table
   ```

2. Run a bounded pass and read all output, including stderr:

   ```powershell
   npm run demo:monitor -- --once
   ```

3. Re-read notifications; repeat the unchanged pass to inspect deduplication.
4. Export the current scope:

   ```powershell
   npm run demo:export
   ```

5. Open the exact new file path printed by the command locally. Inspect
   `backup.version`, `backup.scope`, `backup.tables`, checksum and artifact refs.

**Expected result**

- Usage includes a UTC period, default `max_runner_ms: 120000`, measured
  `used_runner_ms` and settled reservations (`reserved_runner_ms: 0` in this
  fresh completed demo). Actual elapsed milliseconds vary.
- Notifications are local records. Unchanged reconciliation adds no duplicate
  notifications and sends no external messages/model calls.
- No **Scoped maintenance is degraded** output. Exit 0 with that message is
  not a successful maintenance result; record the degradation.
- Export writes a version-1 logical snapshot for the current scope, including
  plans, approvals, governance/audit, runs and artifact references. The earlier
  run's organisation must not appear as exported customer rows.
- The checksum describes the logical snapshot, not the whole pretty-printed
  envelope file. Object bytes need a separate backup.

This does not prove expiry, holds, budget exhaustion, deletion or full restore.
Use dedicated fixtures or the [recovery runbook](runbooks/data-and-recovery.md);
do not delete the inspection demo for a test result.

**Record:** selected usage/notifications, maintenance output and private export path.

## Step 14 — Record results and stop owned services

Use `Pass`, `Fail`, `Blocked` or `Not tested` for each item:

| Manual acceptance item                                                  | Result / evidence |
| ----------------------------------------------------------------------- | ----------------- |
| Health, wrong-token denial and correct dashboard entry                  |                   |
| Requirement/revision shown; analysis separate from readiness            |                   |
| Historical code/environment blockers and final prerequisites explained  |                   |
| Earlier revision and missing-execution states explicit                  |                   |
| Synthetic pass separate from unmeasured coverage                        |                   |
| Test-only patch and separate destination inspected                      |                   |
| Exact plan approved, revoked and retained across restart                |                   |
| New synthetic publication scope distinguished from earlier revoked plan |                   |
| First/replay receipts scoped, checksum-matched and reconciled           |                   |
| Unauthenticated reads and disabled live command denied                  |                   |
| Usage/maintenance/export inspected without degradation                  |                   |

Record date/time, reviewer, HEAD/uncommitted changes, runtime versions, both
scope IDs, assessment/feature/plan IDs, selected screenshots, command exit codes,
checksum results and gaps. Sources/dependency approvals/VCS responses are
synthetic. PostgreSQL persistence and owned browser execution are real local
observations only when actually observed.
Step 7's decisions are manual local-operator actions; Step 10's publishing
approval is supplied by the synthetic fixture.

Stop services you started when they are no longer needed:

```powershell
powershell -NoProfile -File scripts/demo-api.ps1 stop
powershell -NoProfile -File scripts/local-postgres.ps1 stop
git status --short
```

Data stays on disk. Close the token-bearing terminal/tab. Do not delete runtime
data or DB volumes during routine shutdown. Compare the working tree with Step 1;
credentials/generated artifacts should remain ignored.

## What this walkthrough does not establish

- Live GitHub/Jira onboarding, OAuth refresh, actual repository permissions or a
  real test PR. GitLab MRs are not implemented.
- General AI authoring or arbitrary customer-code containment. The browser path
  uses the owned expired-card fixture; no working customer sandbox is claimed.
- Complete historical feature snapshots or a labelled coverage benchmark.
- Worker-crash/lease fencing, malformed webhook/provider failures, source
  invalidation, destructive lifecycle paths or lost VCS response recovery through
  manual UI controls. Existing regression fixtures cover specific cases.
- Production encryption, backup purge, PITR, scale recovery or API billing.

Optional existing regression commands are `npm run check`, database helper
`test` and helper `e2e`. Their current expected totals are 63 unit/transport,
18 PostgreSQL and 3 browser checks. The main guide has exact commands/scope guards.
A green total does not close the untested live gates above.

## Guide verification record

Checked on 5 November 2026: formatting passed, all 16 PowerShell blocks parsed,
and relative links resolved. The connection/report/readiness/usage examples were
checked against the existing local demo. Both publication receipt downloads
matched their catalog SHA-256 values, and their first/replay flags were false/true.
Tokens were not printed. Downloads remain under ignored runtime-data.

This documentation task did not repeat fresh installation, demo preparation,
manual approval clicks, restarts, maintenance/export or the automated suites.
Application code was unchanged. Fill in the acceptance table from your own run;
the guide's checks are not a claim that all manual steps have been executed.
