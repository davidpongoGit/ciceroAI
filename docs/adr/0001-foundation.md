# ADR 0001: M0 TypeScript foundation

Date: 4 November 2026. Status: selected for M0 founder review.

## Context and decision

The repository initially contains only AGENTS.md, Agent.md and Vision.md, with no
commits. The supplied first-session prompt is preserved as First-Codex-Prompt.md.
Build M0 only: a health API, validated contracts, deterministic mock provider and
minimal database harness. No worker, UI, queue or real integration yet.

Use npm workspaces, ESM and strict TypeScript. Three modules are sufficient:
apps/api (Fastify transport), packages/contracts (Zod and mock-provider contract),
packages/database (Drizzle schema, SQL migrations and bounded pg pool). Imports use
package exports and built JS; tsc project references define build order. Tests use
Vitest and Fastify injection; a separate integration suite requires real PostgreSQL.

Use Drizzle, not Prisma: SQL-oriented schemas and checked-in generated migrations
keep PostgreSQL constraints visible without an additional generated client/runtime.
Do not use schema push on customer databases. Apply reviewed additive migrations
with a single operator; back up before changing a populated installation. Replacing
the ORM later must preserve SQL history and the persistence boundary.

## Versions and compatibility

Checked public package registry metadata and official docs on 4 November 2026:

| Component                  | Selected version | Licence / compatibility                                   |
| -------------------------- | ---------------- | --------------------------------------------------------- |
| Node.js                    | 24.22.2 LTS      | Node project licence; pin in .nvmrc and .node-version     |
| npm                        | 12.0.1           | Artistic-2.0; supports Node >=24.15 within 24.x           |
| TypeScript                 | 6.0.3            | Apache-2.0; current ESLint parser requires <6.1           |
| Fastify                    | 5.12.8           | MIT; Node 20+ major baseline                              |
| Zod                        | 4.6.7            | MIT                                                       |
| Drizzle ORM / Kit          | 0.45.4 / 0.31.11 | Apache-2.0 / MIT                                          |
| pg                         | 8.23.1           | MIT; Node >=16                                            |
| PostgreSQL                 | 18.6             | PostgreSQL licence; supported major through November 2030 |
| Vitest                     | 5.1.0            | MIT; supports Node 24                                     |
| ESLint / typescript-eslint | 10.14.0 / 8.72.1 | MIT; peer-compatible with TS 6.0                          |
| Prettier / tsx             | 3.9.10 / 4.23.15 | MIT                                                       |

Exact direct dependencies and transitive integrity hashes live in package-lock.json.
Two explicit development dependency overrides address the initially observed audit:
minimatch 11.0.1 replaces vulnerable 10.x in lint tooling, and esbuild 0.25.12
replaces 0.18.x under Drizzle Kit's deprecated esbuild-kit loader. These cross-major
overrides require exercised lint and migration generation compatibility; remove
them when upstream versions resolve the advisories. They do not disable auditing.
See [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) and
[esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99).

Use npm ci, never floating installs in CI. Node 26 is also LTS, but the established
24 LTS line limits initial churn. The host has Node 24.16.0; evidence must state
which runtime actually executed checks. Package popularity or licences do not prove
security: review npm audit results, advisories and changes on upgrades. No paid
runtime services are introduced. Docker is absent on the initial host; no claim of
executed Compose or PostgreSQL tests is permitted without execution evidence.

## Initial tree and commands

```text
apps/api/src/{app,config,server}.ts
packages/contracts/src/{index,model}.ts
packages/database/{src,drizzle,drizzle.config.ts}
tests/integration/database.test.ts
docs/{adr,implementation-status.md,m0-plan.md}
.github/workflows/ci.yml
docker-compose.yml
```

Root commands: npm ci; npm run dev; npm run check; npm run build; npm start;
npm run db:up; npm run db:migrate; npm run test:integration; npm run db:down.
README gives prerequisites, configuration and exact startup/shutdown sequence.

## Boundaries and consequences

Health is public, process liveness only, and reveals no configuration or DB state.
Bind to 127.0.0.1, reject non-loopback API configuration in M0, omit request logging
and provider SDKs. No authenticated data API exists; add authorisation before any
customer-data routes. DB credentials are explicit local configuration, excluded
from Git; errors must not echo URLs or raw database exceptions. Pool and query
timeouts bound failure. Compose has loopback publishing and a named data volume;
it is development infrastructure, not encrypted production deployment.

The mock has no tools, network, shell or write capability. Its response always
reports unknown and zero external usage; this does not demonstrate AI analysis.
M1 decides durable event/job/audit design, not M0. PostgreSQL remains authoritative
even if later queue transport is Redis. No untrusted PR code is executed in M0.

## References

- [Node LTS release](https://nodejs.org/en/blog/release/v24.22.2)
- [npm workspaces](https://docs.npmjs.com/cli/v12/using-npm/workspaces/)
- [Fastify support](https://fastify.dev/docs/latest/Reference/LTS/)
- [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)
- [PostgreSQL support](https://www.postgresql.org/support/versioning/)
- [Vitest](https://vitest.dev/guide/)
- [TypeScript strict mode](https://www.typescriptlang.org/tsconfig/strict.html)
- Package versions, licences, engines and peers: public registry npm view metadata.
