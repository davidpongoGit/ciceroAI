# ADR 0005: Publish test proposals only to a separate automation repository

Date: 5 November 2026. Status: implemented with synthetic transport validation;
live GitHub installation and publication remain untested.

## Boundary and decision

Application code, developer PRs/MRs and requirements are read inputs. Cai's VCS
writes are limited to a named proposal branch and a test-only draft PR in a
separately configured Playwright automation repository. Developers review,
approve and merge in the VCS. No merge, protected-branch update, workflow-file
change, application write or GitLab adapter is added here.

The assessment's organisation/repository scope continues to identify the
application and its evidence. A new optional `TestPlan.publication` binds provider,
automation repository ID/name, base branch/SHA and exact new test path into the
immutable plan hash. Application SHA, test-content revision and automation base
SHA are distinct identities. The publisher compares the complete approved plan
with its trusted destination configuration and checks remote numeric repository
identity/name. Application and automation IDs/names cannot be the same.

The optional field preserves reading/hashing of legacy plans. A legacy
`create_pr` plan without a destination cannot be newly created, approved or
authorised for publication; replace it with a new reviewed immutable plan. Existing
draft/execute plans retain their meaning. No database migration or new export
table is required; use the matching application release for backup/restore.

## Supported publishing lane

This increment supports one newly added `tests/**/*.spec.ts` file per GitHub
plan, with bounded content and a supported meaningful Playwright assertion. It
does not update existing tests or bootstrap configuration. A registered scoped
TypeScript artifact must belong to the assessment and match the approved digest.
Provenance and applicable recorded run identifiers/outcomes/origins accompany the
proposal; absence of execution evidence stays explicit. A test-only path/static
assertion check is not proof that arbitrary code is safe to execute or that a
requirement is verified.

The publisher checks the independent automation base and exact current approval
before each write. It creates only `cai/<plan-id>`, verifies exact file bytes and
Git blob identity at an immutable commit, and requires one added test and one
commit ahead of the approved automation base. PR responses must match the
expected repository, branch, base and head, remain draft/open/unmerged and use
the canonical repository PR URL. Redirects, oversized responses and unbounded
retries are not allowed.

The CLI requires `PUBLISH_ENABLED=true` and a separate automation installation
token/configuration. It has no approval-granting capability. Dashboard approval
alone causes no publication; no publication daemon or HTTP write endpoint is
enabled. The default worker remains unchanged.

## Recovery, audit and limits

Writes are not automatically retried. Repeating the explicit command reconciles
the same plan-specific branch/file/PR after a lost response. Source revocation,
approval expiry/revocation, changed destination/base/content and conflicting
branches stop further work. Closed, merged or developer-converted non-draft
proposals are not reopened or replaced automatically.

PostgreSQL retains started/recorded/failed governance events and scoped artifact
references. The local artifact adapter stores a checksummed publication receipt,
including target, source application revision, exact plan hash, proposal identity,
execution provenance, mode and limitations. Receipts inherit the draft artifact's
expiry/sensitivity. Synthetic receipts explicitly say no external PR exists.
If a remote write succeeds but local receipt persistence fails, audit failure
and retry reconciliation are required; never delete a developer branch to hide
the partial outcome. Objects/backups follow existing lifecycle controls.

Pre-write checks do not make GitHub and PostgreSQL one transaction. A ref or
approval can change during a network request; independently reviewed live race,
permission and concurrent-operator testing remains necessary. Operate one command
per plan at a time. No automatic cleanup, production identity rollout, external
API cost measurement or untrusted-code execution is claimed.

## API references

The request/response contracts were checked against GitHub's official
[draft PR API](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request),
[file contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents),
[reference API](https://docs.github.com/en/rest/git/refs#create-a-reference) and
[commit comparison API](https://docs.github.com/en/rest/commits/commits#compare-two-commits).
An installation token should be limited to the automation repository with the
Contents and Pull requests write permissions needed by these operations. Real
grant/branch-rule behaviour must be demonstrated in an authorised personal sandbox.
