# ADR 0004: Conservative intelligence and supervised actions

Date: 5 November 2026. Status: selected for M3–M8 implementation.

Explicitly labelled acceptance criteria are deterministic source-backed records.
Unsupported prose remains unknown, and conflicting shared criterion IDs require
clarification. This bounded parser does not claim broad semantic understanding.
Source versions, reports and graph revisions live in PostgreSQL with scoped keys.
Changes invalidate dependent reports/edges; revoked sources are excluded from
retrieval. A Playwright AST index records exact assertions without evaluating source
or config. Human-reviewed mappings and matching run evidence are needed for verified
coverage. Titles/similarity, static generation and past runs on other builds do not
establish verification.

M6 plans are immutable revisions with a content hash, exact source/test/build refs,
policy version, operation, environment and budget. Append-only approval/rejection/
revocation decisions bind that hash and expire. Server-side checks apply at approval
and immediately before an action. Plan execution never inherits authority from a
model, source description or browser-supplied organisation. Revocation and source
staleness deny pending work. No merge/prod permission exists.

The first UI is a small same-origin administration page served by the existing
Fastify API, with vanilla DOM rendering and a scoped bearer token kept only in
memory. This avoids adding a second server/framework before the workflow is useful.
It does not weaken server-side permissions; the page only calls authenticated APIs.
One configured local installation operator is the initial principal, not an
enterprise multi-user RBAC implementation. Production identity/TLS review remains
required before confidential deployments. Migration to React/Next.js can retain
the same authenticated service contracts.

Read-only adapters accept already-authorised short-lived installation/OAuth tokens.
They do not implement real app registration, OAuth consent/refresh or secret vault
operations. Synthetic providers are the default. No automatic outbound AI calls,
telemetry or cross-customer retrieval is added.

Without Docker, arbitrary PR code execution remains disabled. Only repository-owned
synthetic fixtures may use an explicitly labelled trusted-synthetic runner; that
evidence cannot verify customer code. An isolated container runner must fail closed
when isolation is unavailable. Artifacts and exports have separate scoped storage
and lifecycle controls, with PostgreSQL metadata as authority.
