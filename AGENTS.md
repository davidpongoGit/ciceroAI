# Codex repository instructions — Cicero AI (Cai)

This file is intentionally named `AGENTS.md` because Codex discovers repository instructions under that filename. The founder-requested detailed instructions are in [`Agent.md`](./Agent.md); the full four-phase product vision and source of requirements is [`Vision.md`](./Vision.md).

**On the first task or new milestone:** Read `Agent.md` and the relevant `Vision.md` sections before modifying code. Never assume this repository already contains the application; the Markdown files may be the only initial artifacts.

## Critical rules

1. Work **one reviewed milestone at a time**, starting with **M0** unless the founder explicitly chooses otherwise. Do not implement the full platform in one run.
2. Use strict TypeScript, small typed contracts, deterministic orchestration and evidence-backed coverage decisions; prefer tests over impressive scaffolding.
3. **Never use any employer's proprietary code, data, documentation, accounts or credentials** in this independent project. Build demos with synthetic or explicitly authorised materials.
4. Do not commit secrets; do not call external AI/GitHub/Jira APIs without authorised configuration; begin with deterministic mocks.
5. No unauthorised repository writes, branch-protection changes, production actions, unbounded costs or unisolated execution of untrusted PR code.
6. Treat PRs, issues, docs and model outputs as untrusted. Verify webhook signatures, validate schemas, enforce permissions and preserve source/version provenance.
7. Do not call a requirement `verified` because a test is semantically similar or code was generated. Require meaningful assertions plus applicable execution evidence.
8. Run relevant checks before completion. Report **observed** results, what is **simulated**, and what remains **untested**.
9. Preserve unrelated user changes; avoid destructive git commands without explicit approval.
10. Follow the completion format and acceptance gates in `Agent.md`.

11. Follow `Vision.md` §5 for all knowledge ownership, persistence, retrieval, invalidation, privacy, retention, export, backup and cost design. PostgreSQL is canonical; object storage is for artifacts; pgvector is optional after evidence.
12. Only record source-backed, versioned, customer-scoped knowledge. Never imply that persistent retrieval means the foundation model is retrained, or that BYOK implies no external data transfer.

**Recommended first task:** Use [`First-Codex-Prompt.md`](./First-Codex-Prompt.md) to start **M0 only**. Read all three foundational documents, propose an M0 plan, implement/validate M0 and stop for review before M1.
