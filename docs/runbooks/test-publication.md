# Test-only publication to an automation repository

This increment adds a GitHub new-test proposal lane. Application repositories
remain read-only inputs. The separate Playwright repository receives one new test
on `cai/<plan-id>` and a draft PR; developers review, approve and merge in GitHub.
GitLab MRs, existing-test updates and automatic merging are not implemented.
See [ADR 0005](../adr/0005-separate-automation-publication.md) for binding/recovery
rules and the [M0–M8 guide](../test-guide-m0-m8.md) for environment setup.

## 1. Verify the safe synthetic path

Use the pinned Node runtime and dedicated local DB. Install Chromium as described
in the test guide. Stop a running helper-managed API before regenerating its demo
configuration:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD 'runtime-data/browsers'
powershell -NoProfile -File scripts/demo-api.ps1 stop
powershell -NoProfile -File scripts/local-postgres.ps1 publish
powershell -NoProfile -File scripts/demo-api.ps1 start
```

The helper's **`publish` action is synthetic**: it runs `npm run demo:publish`.
On other setups, select the dedicated local DB privately and run
`npm run demo:publish`. It runs the existing three-stage demo and a real owned
Playwright fixture, then uses only an in-memory GitHub transport. It creates a
fresh synthetic organisation and replaces the latest `demo.*` convenience files;
previous DB scopes remain. Preserve those files locally beforehand if you need
to keep inspecting an earlier demo. No real token is needed.

Expected exit 0 and summary:

- `realPrCreated: false`.
- `syntheticPublication.status: simulated_awaiting_review`.
- Exactly three simulated writes: branch, new test file, draft PR.
- A repeated publication reconciles the same proposal without further writes.
- A publication receipt and reconciliation receipt are registered as scoped
  artifacts, with governance events and source/version provenance.

Inspect the saved result without opening a fabricated GitHub URL:

```powershell
$publicationDemo = Get-Content -Raw -LiteralPath 'runtime-data/demo-summary.json' | ConvertFrom-Json
$publicationDemo.publication | Select-Object mode, status, externalPullRequest, simulatedWrites, receiptArtifactId
$publicationDemo.publication.automationTarget
$publicationDemo.publication.executionEvidence
```

Expected: application scope repository `101`, automation repository `202`
(`synthetic/playwright`), independent automation base SHA, a matching draft
checksum and a recorded `trusted-synthetic` pass. The simulated PR URL is a
fixture identifier; no external PR exists. `review.mode` remains the local review
manifest; `publication` separately records the simulated publication outcome.

Open <http://127.0.0.1:3000>, connect with the new private `API_TOKEN`, and inspect
the `create_pr` plan. Its destination, base and exact test path must be visible.
Approval controls do not send VCS requests. Coverage remains `not measured`.
Using the authenticated API setup in the main test guide, download
`/api/artifacts/<receiptArtifactId>` and compare its checksum with the report's
artifact reference. Do not share the token or raw customer exports.

## 2. Run the automated checks

```powershell
npm run check
powershell -NoProfile -File scripts/local-postgres.ps1 test
powershell -NoProfile -File scripts/local-postgres.ps1 e2e
```

Focused files:

- `packages/integrations/src/publisher.test.ts`: separate repo/base, approved
  target/hash, unsafe paths and no-op assertions, wrong remote identity,
  revocation/base movement between writes, uncertain-write reconciliation,
  unexpected files, tampering and closed proposals. HTTP is synthetic.
- `tests/integration/publication.test.ts`: real PostgreSQL approvals, scoped
  artifacts/receipts/audit, configuration changes, legacy rejection, source
  revocation and receipt-storage failure recovery. VCS is synthetic.
- `tests/e2e/dashboard.test.ts`: normal browser/token entry, visible automation
  destination and exact-plan approval/revocation. It does not publish a real PR.

## 3. Configure an authorised live sandbox later

No live configuration or provider call was exercised during this milestone.
The following path performs real GitHub writes **when explicitly enabled**; it
is absent from the default demo/worker/dashboard actions.

1. Select personal, authorised application and automation repositories. Record
   both numeric IDs and canonical `owner/name` values; they must be different.
   Keep the application connection read-only. Configure a separate automation-
   repository installation token with only the needed repository permissions.
2. Confirm the automation repository already has a compatible Playwright setup.
   This lane adds one new test only; it does not create config, helpers, lockfiles,
   workflows or application code. Customer-code runner isolation remains a
   separate, unfinished capability.
3. Create a new immutable `create_pr` plan through the existing scoped plan API,
   based on a current requirement/feature and registered draft artifact. Preserve
   application SHA, test-content revision, environment, criterion IDs and draft
   SHA-256; add this destination shape with actual authorised values:

   ```json
   {
     "publication": {
       "provider": "github",
       "repositoryId": "202",
       "repository": "your-personal-owner/your-playwright-repo",
       "baseBranch": "main",
       "baseSha": "<current automation branch SHA, 40 lowercase hex characters>",
       "path": "tests/expired-card.spec.ts"
     }
   }
   ```

   This is the destination fragment, not a complete plan. Use the actual numeric
   ID instead of the synthetic `202`. The test path must be new and match the
   approved draft; supported paths are safe `tests/**/*.spec.ts` names. A missing
   destination in a legacy plan requires a **new plan and approval**.

4. Review the exact draft, target, base SHA, source evidence and execution limits.
   Obtain the applicable existing plan approval. Changing any destination/base/
   path/content field changes the plan hash and requires a new reviewed plan.
5. In the intended private installation configuration, set:

   ```dotenv
   PUBLISH_ENABLED=true
   APPLICATION_REPOSITORY=your-personal-owner/your-application-repo
   AUTOMATION_REPOSITORY_ID=<actual numeric automation repository ID>
   AUTOMATION_REPOSITORY=your-personal-owner/your-playwright-repo
   AUTOMATION_BASE_BRANCH=main
   AUTOMATION_INSTALLATION_TOKEN=<separate short-lived installation token>
   ```

   Also provide the existing application scope/database configuration. Preserve
   `.env`; never commit these credentials. Shell variables override env files.
   Defaults in `.env.example` leave publishing disabled. This command does not
   grant approval to itself.

6. Run the explicit command with the approved plan and registered TypeScript
   artifact IDs:

   ```powershell
   npm run publish:test -- '<plan-uuid>' '<draft-artifact-uuid>'
   ```

   Replace the angle-bracket placeholders before execution. Expected live output
   contains status `created_awaiting_review`, PR URL, reuse flag and receipt
   artifact ID. Inspect the actual VCS diff; it must contain exactly the approved
   newly added test. Leave review, approval and merge to developers in the VCS.
   Publication is not evidence that coverage is verified or the new suite works
   in that repository's CI.

7. Set `PUBLISH_ENABLED=false` when the intended publishing session is over.
   Do not paste tokens or full environment dumps into failure reports.

## 4. Failures and recovery

| Condition                                              | Behaviour / next action                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Publishing disabled or configuration absent            | Command exits 1 before provider calls; configure only the authorised installation.                                                   |
| Unapproved/expired/revoked/stale plan                  | Denied; no new approval is silently created.                                                                                         |
| Application selected as destination                    | Denied by separate identity/name checks.                                                                                             |
| Operator destination differs from approved destination | Denied before VCS requests.                                                                                                          |
| Automation base moved                                  | Stop; review the new base and create a new immutable plan. No force push or base rewrite.                                            |
| Existing test at requested base path                   | Denied; this milestone supports new tests only.                                                                                      |
| Branch diff/content/PR identity differs                | Stop for investigation; do not overwrite, reopen or replace developer work.                                                          |
| Lost response after commit/PR creation                 | Repeat the same explicit command with the same plan/artifact while approval/base remain applicable; reconcile existing remote state. |
| Remote PR created but local receipt storage failed     | Inspect failed governance event and remote state; repair storage and retry the same plan. No remote rollback/deletion is automatic.  |
| Developer closed/merged/converted the draft            | No automatic reopen, ready-for-review change, merge or new PR. Review the VCS state manually.                                        |

Provider reads have bounded retries and responses; writes are single attempts.
Run one command per plan at a time. Atomic cross-system transactions, live race/
permission behaviour, GitLab, production credentials/rotation and API spend
metering remain outside the demonstrated local slice. The receipt is an artifact
with the draft's scope/expiry/sensitivity; back up its bytes separately from the
PostgreSQL reference according to the existing data/recovery runbook.
