---
id: 027
title: Tooling port — OpenCode MCP + curated AGENTS.md
phase: 0
status: done
depends_on: []
estimate: S
updated: 2026-10-02
---

## Context

Cursor Pro expired; the project moved to OpenCode Go. `.cursor/mcp.json` + six `.mdc` rules needed porting; there was no `AGENTS.md` and `.env.example:5` still referenced Cursor. Node needed the ≥ 20.19 floor recorded (vitest 4 crashed on Node 20.11).

## Scope

- `"engines"` floor in `package.json` (`node >=20.19`, `pnpm >=9`).
- `opencode.json` registering `arrodes-ro` + `lotm-wiki` as local MCP servers (v2 `mcp.servers` shape; no credentials in the file).
- Curated `AGENTS.md`: Project / Stack & Commands / Data & Eval Rules / MCP Boundaries / Workflow & Git — merged from the five kept `.mdc` files; `plugin-vs-rule-ownership.mdc` dropped (Cursor-specific).
- `.env.example` MCP comment updated to OpenCode.
- `docs/` un-ignored and committed (user-approved durability fix — the tracker was machine-local-only).

## Out of scope

- Deleting `.cursor/` (user decision: keep; gitignored).

## Deliverables

- `package.json` engines; `opencode.json`; `AGENTS.md`; `.gitignore` docs/ un-ignore; docs/ committed.

## Acceptance criteria

- `pnpm test` + `pnpm typecheck` green on Node 24.
- Both MCP servers connect in OpenCode; one read-only `arrodes-ro` query returns data.
- AGENTS.md auto-loads in OpenCode sessions.

## Resolution

- Commits: `648d58c` (engines), `a4f6ac5` (docs/ committed, 33 files), `225a90d` (opencode.json), `7571b15` (AGENTS.md).
- Verified: 200 tests pass / 14 skipped (EPUB integration auto-skip), typecheck clean on Node v24.21.0; `arrodes-ro` live query `SELECT COUNT(*) FROM chunks` → 16398; both MCP servers present in the OpenCode tool catalog; AGENTS.md auto-loaded.
