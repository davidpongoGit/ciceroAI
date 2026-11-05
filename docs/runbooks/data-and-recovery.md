# Scoped data operations and recovery

Status: development baseline, tested on personal PostgreSQL 18.6 and Node 24.22.2.
All exercised content is synthetic. See docs/milestones.md for exact evidence.

## Ownership and authority

One customer-managed installation owns its PostgreSQL database and object namespace.
All customer rows carry organisation/repository scope. API scope comes from trusted
configuration; browser or model output cannot change it. Data operations require
the `data.manage` capability and explicit maintenance enablement. Never point these
development commands at employer or production resources without separate authority.

The logical snapshot includes scoped sources/versions, relationships, assessments,
test inventory, mappings, runs, plans, approvals, audit/notifications, usage, lifecycle
records and an artifact manifest. It excludes credentials, vendor implementation,
other scopes and installation-wide bootstrap metadata. Source minimisation is
conservative, not a complete secret/PII detection system. Protect exported files as
customer data; local cleartext development storage is not production encryption.

## Export / backup

1. Configure the intended personal scope and database; enable maintenance explicitly.
2. Run `npm run data -- export` (or `npm run demo:export` for the generated demo).
3. Retain the versioned JSON, checksum and compatible application/migration release.
4. Back up object bytes separately, preserving scoped keys and checksums. A DB
   reference is not an object backup. The development adapter supports checksum-
   validated `restoreObject`; a production S3/versioning backup policy is not built.
5. Encrypt and restrict exported material using customer-approved tooling and keys.

Exports use a repeatable-read database snapshot, UTC timestamps, a table allowlist,
at most 2,000 rows per table and a 5 MiB envelope. Larger installations require an
evaluated streaming/export-job implementation. Failure is explicit, never a silent
partial export. SHA-256 checksums detect corruption, not authenticity or entitlement.
The current format version is 1 and requires the matching complete table layout;
unsupported older layouts are rejected rather than guessed.

## Restore drill

1. Provision a new isolated PostgreSQL development database, with no customer rows.
2. Use the same application release and apply reviewed migrations there.
3. Restore artifact bytes into a separate namespace under their original keys and
   verify checksums; retain expiry/hold metadata. Do not fetch revoked objects into
   another customer's namespace.
4. Configure the original organisation/repository IDs, the new destination URL,
   `MAINTENANCE_ENABLED=true` and `RESTORE_ENABLED=true`.
5. Place a trusted exported snapshot under ignored runtime-data and run
   `npm run data -- restore runtime-data/exports/<snapshot>.json`.
6. Inspect source/report/graph integrity, objects, notifications and usage before
   enabling integrations or workers. Imported approvals are revoked; queued/running
   assessments become dead letters, action leases are fenced, and reserved budgets
   are charged conservatively. Re-enable only specifically reviewed work.

Observed automated drill: created a fresh `cai_restore_<random>` PostgreSQL DB,
migrated it, restored scoped rows and a copied artifact, compared report content and
readiness, verified object bytes and revoked approvals, rejected a second overwrite,
then dropped only that validated temporary test database. This proves the tested
logical path, not disaster recovery objectives, PITR, roles, instance configuration,
encrypted backup tooling, large-volume restores or real S3 recovery. Configure
those production capabilities and measure RPO/RTO before a pilot.

## Retention and holds

Current configurable categories: webhook metadata (14 days initially) and artifact
maximum age (30 days initially), each adjustable from 1–365 days. Metadata expiry
retains delivery ID/source hash to preserve idempotency. Large objects have explicit
expiry. Referenced knowledge/history and audit are preserved until approved scoped
deletion; a complete contractual category matrix and backup purge scheduler remain
production work. No raw model prompt/completion persistence is introduced.

Maintenance minimises expired metadata in bounded batches and marks object deletion
pending before I/O. Failed deletion remains retryable and emits an audit failure;
successful retry marks expiry. A legal hold preserves the object and blocks full
scope deletion. Revoked source access denies retrieval even if a hold retains bytes.

## Offboarding / live deletion

Disable external connections and workers, confirm the exact scope, export if
authorised, and verify any holds. The CLI requires the literal
`<organisation-uuid>:<repository-id>` confirmation. `deleteScope` disables intake,
purges that local object prefix and removes live scoped derivations in FK order.
It preserves a disabled-scope tombstone and minimal job/deletion receipts. A failed
purge remains visible and retryable; it is not reported completed.

Retained exports, off-host backups, database WAL/storage snapshots and S3 object
versions have separate schedules. **Do not claim instant irrevocable erasure.** The
prototype does not implement a production legal-hold service or backup purge proof.

## Operational recovery and costs

Assessment leases are fenced, attempt-limited and recoverable. Manual dead-letter
replay is capability-gated, audited and capped at three replays. Long provider
`Retry-After` beyond retry policy becomes a dead letter rather than early retry.
PR creation reconciles its plan-specific branch/file/PR before a repeated write.
Its real-network behaviour remains untested; no publication daemon is enabled.

Actions reserve per-scope UTC-month runner milliseconds and are unique per immutable
plan. Completion records measured time; lost leases charge the reservation and
cannot complete later. The default allowance is 120 seconds/month for the local
prototype, configurable up to one hour. This is a bounded development allowance,
not commercial pricing. Model calls are absent, and storage/cloud billing is not
measured. No made-up monetary savings or quality percentages are displayed.

No customer-code sandbox is configured. Trusted-synthetic runs accept only the
owned fixed template, with scoped approvals, exact byte/build checks, a restricted
environment, timeout/output bounds and approval polling. They do not establish
untrusted-code containment. A production runner needs independently reviewed
isolation, CPU/RAM/filesystem/egress limits, cancellation and escape testing before
customer PRs may run. The current untrusted boundary rejects all requests.
