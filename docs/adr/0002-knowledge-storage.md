# ADR 0002: Customer-controlled canonical knowledge

Date: 4 November 2026. Status: selected for M0; governed by Vision.md §5.

## Decision and ownership

One customer-managed installation has its own PostgreSQL database and, later, its
own object namespace. PostgreSQL is canonical for workflows, versioned source
records, knowledge and graph edges, approvals, evidence metadata and audit. Start
with relational adjacency tables and indexed joins/full-text search. S3-compatible
storage holds large artifacts later, with scoped object references, checksums,
bytes, sensitivity and expiry in PostgreSQL. Do not store blobs in knowledge rows.

Customer source materials and customer-specific knowledge/evidence remain under
customer control, separated from vendor platform code. Generated-code rights and
licensing need explicit agreements. No shared training, cross-customer retrieval,
unredacted shared caches or default vendor telemetry. Persistent retrieval does not
retrain the foundation model. BYOK does not prevent external data transfer; any
future processor/model configuration must disclose content, location, retention,
training and tracing settings and require applicable approval.

## Provenance and access

As each capability arrives, every customer-owned record carries organisation scope.
Sources preserve immutable external ID, version/SHA/hash and UTC observation time.
Derived knowledge also carries actor/model/prompt/policy version, correlation ID,
certainty, explanation, retention class and supersession. Edges use source-backed
certainty and scoped foreign keys. Preserve human review and contested/rejected
relations. Never promote repeated model inference to fact.

Authenticate and filter by authorised organisation, repository, source visibility,
version and time before retrieval/ranking or export. Model output cannot grant
access. Source changes/revocations invalidate affected derivations and indexes;
passing evidence on another build/environment does not verify current criteria.
M0 has only installation metadata, no customer knowledge or retrieval endpoint;
single-customer deployment is not a claim of tested multi-tenant isolation.

pgvector is an optional reconstructible derived index only after an ADR and golden
retrieval benchmarks show a benefit. Track embedding model, dimension, source hash
and deletion/invalidation. No standalone graph or vector database in this MVP.

## Lifecycle, portability and recovery strategy

Proposed, not implemented in M0: versioned JSON/JSONL or CSV export with scoped
manifest, checksums, schema version, policies, audit and optional approved artifact
bundle. Authorise, encrypt and audit delivery. Export is not a backup substitute.

Before pilots, configure category-specific retention, legal holds and transitions
active → superseded → archived → delete_pending → deleted. Minimise raw payloads
and prompts; do not persist confidential raw model I/O by default. Delete derivations,
embeddings and eligible objects with their source. Preserve justified minimal
deletion audit. Backups have a documented delayed-purge schedule; never promise
instant erasure from retained backups.

Customer operators will own encrypted PostgreSQL backups, recovery objectives and
separate secret storage. M8 must demonstrate restore into an isolated installation,
relational integrity and artifact-reference consistency, and export/delete/hold
failure cases. M0 named-volume persistence is not a tested backup or recovery plan.
Do not delete the development volume during ordinary shutdown. Production TLS,
encryption at rest, least-privilege service/migration roles and secrets management
require deployment work beyond the local harness.

Meter database/index/backup/object bytes, model usage/retries and runner time per
customer/workflow as capabilities arrive. Separate estimates and measured spend,
version tariffs, and fail closed on budget exhaustion. No hard-coded provider prices.

## Reviewed evolution

| Milestone | Storage work / required evidence                                                                  |
| --------- | ------------------------------------------------------------------------------------------------- |
| M0        | ADRs, minimal installation metadata, reviewed migration and real DB smoke harness                 |
| M1        | Scoped durable signed events, hashes, idempotency, correlation, workflow and audit; restart tests |
| M2–M3     | Versioned authorised sources and derived provenance; permission/revocation tests                  |
| M4        | Versioned relations, review and targeted invalidation; source-change tests                        |
| M5        | Exact AC/assertion/test/build/environment evidence; wrong-build negative tests                    |
| M6        | Approval-bound policy and honest freshness/footprint metrics; denied/revoked approval tests       |
| M7        | Scoped artifact adapter, checksums, retention and access; real isolated execution evidence        |
| M8        | Configurable retention/export/deletion/hold, tested backup restore and cost caps                  |

Alternatives rejected: raw model memory as truth, full-repo indefinite storage,
separate graph/vector service without measurements, shared SaaS tenancy in M0.
Migration path: additive reviewed SQL, explicit data migrations and backups before
destructive changes; rebuild derived indexes from authorised source versions.

Canonical requirement source: [Vision.md §5](../../Vision.md).
