# Implementation status

Historical M0 record below. Current sequential implementation and executed evidence
through M8 are recorded in [milestones.md](milestones.md) and the root README.
The founder authorised continuing without milestone approval pauses on 5 November 2026. PostgreSQL and the pinned runtime have since been executed; Docker remains
unavailable. Do not interpret the old M0-only limits below as the current code state.

## M0 — implementation ready for review; acceptance gate incomplete

Observed on 4 November 2026, Windows PowerShell, Node **24.16.0**, npm **12.0.1**.
The pinned recommended Node **24.22.2** runtime was not installed or executed on
this host. No database or CI success is inferred from generated configuration.

### Implemented

- `apps/api/src`: Fastify liveness, local-only configuration and shutdown handlers;
  endpoint and config tests beside the implementation.
- `packages/contracts/src`: strict Zod health and source-scoped foundation-probe
  schemas, typed model-provider interface and deterministic mock, with tests.
- `packages/database/src`: bounded Drizzle/pg connection boundary, explicit safe
  CLI errors and installation-only metadata schema. `packages/database/drizzle`
  retains generated SQL, journal and snapshot. No customer knowledge tables.
- `tests/integration/database.test.ts`: real database migration replay and
  transactional write/read/rollback harness, requiring explicit PostgreSQL config.
- Root workspace/toolchain/lockfile/ignore configuration; PostgreSQL Compose;
  least-privilege CI with pinned actions; README, M0 plan and ADRs 0001/0002.
- `First-Codex-Prompt.md`: exact byte copy of the supplied attachment. Existing
  AGENTS.md, Agent.md and Vision.md remain byte-for-byte unchanged.

### Observed commands and results

| Exact command                                                                                                      | Actual outcome                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node --version` / `npm --version`                                                                                 | v24.16.0 / 12.0.1                                                                                                                                                                                                                    |
| `npm install`                                                                                                      | Initial install succeeded; initial audit reported 14 moderate findings through minimatch and esbuild. Documented patched dependency overrides reduced the follow-up install audit to zero.                                           |
| `npm ci`                                                                                                           | Exit 0; 218 packages added, 222 audited, zero vulnerabilities. Three esbuild install scripts were blocked by npm policy; installed platform binaries still supported all exercised commands. No script approval policy was weakened. |
| `npm run format`                                                                                                   | Exit 0; formatted maintained files, excluded the four supplied Markdown documents.                                                                                                                                                   |
| `npm run check`                                                                                                    | Final run exit 0: Prettier, ESLint with zero warnings, strict source/test typecheck, **4 test files / 19 tests passed**, and build.                                                                                                  |
| `npm run db:generate`                                                                                              | Exit 0; generated one-table SQL migration. After dependency overrides, a second run reported no schema changes. This is SQL generation, not DB execution.                                                                            |
| `npm audit`                                                                                                        | Final exit 0; zero reported vulnerabilities. Not a general security certification.                                                                                                                                                   |
| `npm audit --omit=dev`                                                                                             | Exit 0; zero reported production dependency vulnerabilities.                                                                                                                                                                         |
| `npm ls --depth=0`                                                                                                 | Exit 0; three local workspaces and all pinned direct packages resolve.                                                                                                                                                               |
| `npm start`                                                                                                        | Built API started on 127.0.0.1:3000 with no .env, database or provider keys.                                                                                                                                                         |
| `curl.exe --fail --include http://127.0.0.1:3000/health`                                                           | Exit 0; HTTP 200, application/json, exact body `{"status":"ok","service":"cai-api"}`.                                                                                                                                                |
| `npm run dev`                                                                                                      | Watch-mode API started successfully.                                                                                                                                                                                                 |
| `curl.exe --fail --silent --show-error http://127.0.0.1:3000/health`                                               | Exit 0 against the development process; same exact JSON.                                                                                                                                                                             |
| Ctrl+C in API terminal, then `curl.exe --fail --max-time 2 http://127.0.0.1:3000/health`                           | API port closed; curl error 7. Windows npm terminal wrapper exited 1 on Ctrl+C; this does not establish POSIX graceful-signal behaviour.                                                                                             |
| `$env:HOST = '0.0.0.0'; npm start`                                                                                 | Exit 1; generic safe startup error, no public listener.                                                                                                                                                                              |
| `docker --version` / `docker compose version`                                                                      | Docker not recognised.                                                                                                                                                                                                               |
| `npm run db:up`                                                                                                    | Exit 1: `'docker' is not recognized as an internal or external command`. PostgreSQL did not start.                                                                                                                                   |
| `npm run test:integration`                                                                                         | Exit 1, one failed test: `DATABASE_URL must be an explicit PostgreSQL URL with a database name.` No .env was present. No real DB test passed.                                                                                        |
| `$env:DATABASE_URL = 'postgresql://synthetic:placeholder@127.0.0.1:1/cai_missing'; npm run db:migrate`             | Exit 1 against a deliberately closed local port; safe generic error, credentials absent from output. No migration was applied.                                                                                                       |
| `git check-ignore .env .env.local runtime-data/probe.txt artifacts/probe.txt apps/api/dist/server.js node_modules` | All listed secrets/artifact/build/dependency paths ignored.                                                                                                                                                                          |
| `git check-ignore .env.example`                                                                                    | Exit 1 / no match, so the example is reviewable in Git.                                                                                                                                                                              |
| `Get-FileHash -Algorithm SHA256 -LiteralPath AGENTS.md,Agent.md,Vision.md`                                         | All three hashes match the pre-edit baseline below.                                                                                                                                                                                  |
| SHA-256 of prompt and attachment                                                                                   | Both `624C8EBF5438AEB27F0B26589F268D6A95745A9CFEC1270530084EE5CBAF9BA7`.                                                                                                                                                             |

The first unit run caught a refinement calling `new URL` on malformed strings
before the safe failure path. Corrected the validator to catch URL parsing errors;
all 19 tests then passed. A first lint run also caught a void arrow shorthand;
fixed it and reran lint through the passing full check.

Baseline SHA-256 values:

```text
AGENTS.md A11562CF3CE9DCCDDD34A4597227AA62B2CA2127348C1B86CDD32B82DE2B1C20
Agent.md  A41E5D6D29756C412F33EF768612487C6923C37A73B645B13DE558BC920D85D0
Vision.md F3E06062FD1F0AD0A838926BE84DE195BEBEF33DD1C9EF639DCD4A8D752A263E
```

### Simulated / not tested

The foundation probe is deterministic mock output (`unknown`, no external calls),
not AI analysis, verified coverage or a persisted workflow. No real GitHub/Jira/AI
provider calls, customer data or untrusted PR execution occurred. Public docs and
package metadata were consulted; npm downloaded dependencies.

**Not tested:** PostgreSQL image pull/startup, real connectivity, migrations,
transaction/rollback/replay, fresh-volume persistence, Compose stop/restart,
backup/restore, Linux, pinned Node 24.22.2 and remote GitHub Actions execution.
CI includes a real PostgreSQL job, but no workflow was dispatched or pushed.

### Risks, recovery and next gate

M0 is **not fully accepted** until the real PostgreSQL gate is demonstrated. On a
personal machine with Docker/Compose and the pinned Node/npm installed, configure
`.env` as documented, then run:

```sh
npm ci
npm run check
npm run db:up
npm run db:migrate
npm run db:smoke
npm run test:integration
npm run db:down
```

Record actual PostgreSQL and later CI results before calling those gates passed.
No substitute in-memory database was introduced. Cross-major patched dev dependency
overrides need review on upgrades; Drizzle Kit still carries deprecated loader
packages. Production auth, TLS, role separation, encryption and lifecycle controls
remain later milestone work per ADRs and Vision §5.

No commits, pushes, external accounts, branch-protection changes or production
actions were performed. Source and lockfile remain uncommitted for founder review.
No `.env` was created. Processes started for HTTP validation were stopped.

Next recommended task: **M1 plan only; STOP for founder approval.** Resolve the
remaining M0 database gate before moving to M1 implementation.
