# ADR 0003: Durable scoped workflows and continued milestone delivery

Date: 5 November 2026. Status: selected under founder's instruction to continue
through the plan without milestone approval pauses. Earlier stop-for-review notes
remain historical records. Product permissions, external writes, credential use
and safe execution boundaries still apply.

## M1 decision

Use PostgreSQL jobs with transactional intake and row-level `FOR UPDATE SKIP LOCKED`
claims. No Redis is needed for the first worker. Store organisation/repository
scope, immutable payload hash and head SHA, delivery identity, correlation, bounded
attempts, lease token/deadline and next-attempt time. A unique logical assessment
key includes installation, repository, PR, head and action. A delivery re-used with
different content is rejected. Persist the sanitised event, job and audit atomically
before acknowledging. Unsupported events are authenticated then ignored.

The worker validates input/output and result scope. Completion/retry compares the
current lease token so an expired worker cannot overwrite a replacement's result.
Recovery reclaims expired leases with bounded attempts/backoff and a dead-letter
state. Model tasks remain deterministic mocks; no external side effects occur in
M1. Later side effects require separate durable idempotency and approval checks.

Webhook authentication uses HMAC SHA-256 over exact request bytes and constant-time
comparison. Configured organisation, installation and numeric repository IDs are
authority; payload text cannot change them. Status uses a separate bearer token
bound to the installation scope. No source payload or credential appears in API
errors. Defaults remain loopback. Reject oversized/malformed data and unknown
actions. Do not configure real service credentials during development.

## Validation and operational limits

Run actual PostgreSQL tests for migration replay, delivery/logical deduplication,
concurrent claims, lease expiry/fencing, retries/dead-letter, organisation isolation
and reopening the connection after simulated worker loss. Injected failures prove
orchestration only; live integration claims require authorised execution later.

Docker is missing on the development host. A pinned portable PostgreSQL 18.6 binary
may run within ignored `runtime-data` on loopback, with a dedicated synthetic
database and SCRAM password. This is genuine PostgreSQL evidence, not evidence that
Compose ran. No system service, global database or customer connection is used.
The public npm binary bundle is `@embedded-postgres/windows-x64@18.6.0-beta.19`;
npm integrity pins the download. Keep binaries/data/credentials outside Git.

References:

- [PostgreSQL row locking](https://www.postgresql.org/docs/18/sql-select.html)
- [GitHub HMAC verification](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Fastify raw content parsing](https://fastify.dev/docs/latest/Reference/ContentTypeParser/)
