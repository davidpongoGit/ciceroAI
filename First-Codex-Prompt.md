# Cicero AI — First Codex Prompt (VS Code)

> **Version:** 0.4  
> **Date:** 4 November 2026  
> **Purpose:** Copy the prompt below into Codex after you add `Vision.md`, `Agent.md`, `AGENTS.md` and this file to your new *private* GitHub repository in VS Code. It starts **M0 only** and deliberately does not request real integration credentials or complete Phase 1–3 implementation.

## Copy everything between the lines into the Codex chat

---

You are the principal TypeScript engineer, system architect, and quality engineering partner building **Cicero AI (Cai)**, an independently developed commercial autonomous QA engineering platform.

**First, read `AGENTS.md`, `Agent.md`, `Vision.md`, and `First-Codex-Prompt.md` in full.** Treat `Vision.md` as product intent, with **§5 Persistent Knowledge, Organisational Intelligence and Data Governance** as the binding storage, ownership, security, retrieval, lifecycle and cost architecture. Treat `Agent.md` as your delivery/testing agreement and `AGENTS.md` as your compact repository instructions. Inspect the actual repo contents and Git state. Never assume this project already contains functioning application code.

## Product direction (understand it, do not implement it all now)

Cai will ultimately implement four phases:
1. **Phase 0:** Customer-managed install, permitted integrations, BYOK model settings, test framework discovery, indexing and approval policies.
2. **Phase 1:** Source-backed Jira/PR interpretation, cross-PR dependencies, code/test readiness, assertion-level coverage and the three reuse/update/create scenarios.
3. **Phase 2:** Approved test plans, Playwright test authoring/updating, safe sandbox execution, meaningful assertion verification and reviewable test PRs.
4. **Phase 3:** Event-driven monitoring, targeted reassessment, stale-knowledge invalidation, release-quality evidence, alerting, reliability and cost controls.

Cai **learns organisational context by persisting versioned, evidence-backed knowledge**, not by retraining the underlying LLM. PostgreSQL is the canonical knowledge + workflow + dependency graph store. S3-compatible object storage will hold large test evidence later. Search starts with relational/full-text queries; pgvector is optional only after retrieval benchmarks. Customer-specific data must remain isolated, customer-controlled and exportable. BYOK does not guarantee data never leaves customer infrastructure.

## Immediate task: milestone M0 ONLY

**Before coding:**
- Produce a concise, concrete M0 implementation plan and a short architecture decision record covering the modular TypeScript monorepo, package manager, Node.js runtime, Fastify, PostgreSQL, test strategy and future event/knowledge storage boundaries. Check current official versions and compatibility rather than inventing package versions.
- Show the proposed initial files/tree, local run commands, required dependencies, security boundaries, acceptance criteria and realistic risks.
- Choose **one** ORM (Drizzle or Prisma) and justify the choice briefly. Do not install both. Prefer a simple reproducible monorepo with minimal moving parts.
- Do not ask me for GitHub, Jira, OpenAI or customer API keys for M0.

**Then implement M0 in the repository:**
1. Create a strict-TypeScript monorepo using an appropriate workspace manager with a committed lockfile, scripts, tsconfig, linting, formatting and testing configuration.
2. Create a minimal Fastify API with `GET /health` returning a typed and tested health response.
3. Provide a docker-compose development service for PostgreSQL, a safe `.env.example`, `.gitignore` covering secrets/artifacts and documentation of how the founder starts and stops the stack.
4. Create a small `packages/contracts` module (or equivalent) for runtime-validated types and a typed mock model-provider interface; no external AI calls.
5. Establish a modular persistence boundary and tested DB connectivity/migration smoke path if viable in M0; do **not** prematurely build every knowledge table or all four phases.
6. Create `docs/adr/0001-foundation.md` and `docs/adr/0002-knowledge-storage.md` documenting: customer-managed single-customer-per-installation MVP; PostgreSQL as canonical, versioned knowledge/graph store; object storage for large artifacts later; optional pgvector after benchmarks; data ownership and access boundaries; retention/export/restore strategy; no shared training and no default vendor telemetry.
7. Write a clear README: prerequisites, install, configure, dev/test commands, database startup/migrations, health check, data boundaries and what is *not yet implemented*.
8. Add automated unit tests and a health endpoint test; add a minimally privileged GitHub Actions workflow for lint/typecheck/test/build if safely feasible without secrets.
9. Preserve the four supplied Markdown documents and any existing user changes. Do not overwrite them, commit secrets, alter protected branches or silently install unrelated infrastructure.

**Acceptance gate for M0:**
- Fresh install is reproducible from the README, assuming documented prerequisites.
- The API starts and the health route behaves as tested.
- Typecheck, lint, unit tests and build complete with actual command output, or you report exact blockers honestly.
- PostgreSQL starts via Compose and any claimed DB test is *actually executed*.
- `.env.example` contains placeholders only; `.env` and runtime data are ignored.
- No calls to real GitHub/Jira/AI providers; no execution of untrusted PR code.
- ADRs explain storage/data ownership decisions and how they evolve across M1–M8.

**Working rules:**
- Implement the smallest maintainable working slice rather than scaffolding dozens of empty packages.
- Use structured Zod schemas at boundaries, clear errors, explicit policy checks and tests for failure paths.
- Never call an acceptance criterion `verified` from a generated test or semantic similarity alone.
- Never use my employer's code, documents, infrastructure or credentials. This is an independent, synthetic-data-only project.
- Do not implement M1–M8, real connectors, the AI agent swarm, advanced vector search, billing or multi-tenant SaaS in this task.
- Do not create external accounts, push code or merge branches without my explicit approval.
- Do not claim a check passed unless you actually ran it.

**At the end:** provide the exact following summary:

```text
MILESTONE / TASK: M0
IMPLEMENTED:
FILES CHANGED:
BEHAVIOUR DEMONSTRATED:
CHECKS RUN (exact commands and actual outcomes):
MOCKED / NOT YET REAL:
SECURITY / DATA FLOW REVIEW:
OPEN RISKS OR BLOCKERS:
NEXT RECOMMENDED TASK: M1 plan only; STOP for my approval.
```

**Stop after M0. Do not begin M1 until I explicitly approve.**

---

## After Codex completes M0

Review the changed files and actual command outputs. Start the application locally and confirm its health endpoint. Verify `.env` was not committed and that docs/ADRs agree with the architecture. Commit/push from your own GitHub account after review. Only then ask Codex to plan M1.

### Future M1 prompt (do not send yet)

> Read `AGENTS.md`, `Agent.md`, and relevant `Vision.md` sections, especially §5. Implement **M1 only**: authenticated GitHub-style webhook intake with raw-body HMAC verification; idempotent PostgreSQL event persistence scoped by organisation and repo; a deterministic mock analysis worker; durable status and audit/correlation records; retry/recovery and deduplication tests. No live customer repos, external AI calls or untrusted test execution. Run checks, report actual evidence and stop for approval before M2.
