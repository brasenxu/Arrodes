# Arrodes — Agent Guide

Arrodes is a chapter-grounded RAG chatbot over *Lord of the Mysteries* (lotm1) and
*Circle of Inevitability* (coi). Spoiler control is product-critical: the user's
reading position gates every retrieval path, and nothing may leak past it.

# Stack & Commands

- Runtime: Next.js App Router + TypeScript.
- Package manager: `pnpm`. Node ≥ 20.19 / pnpm ≥ 9 (see `package.json` engines);
  pnpm 9 activates via `corepack prepare pnpm@9.0.0 --activate`.
- Database: Neon Postgres + Drizzle.
- Use existing scripts from `package.json`; do not invent parallel script names.
- Install: `pnpm install` · Typecheck: `pnpm typecheck` · Tests: `pnpm test`
- Eval schema validation: `pnpm eval:validate` · Build: `pnpm build`

# Data & Eval Rules

- Reading-position and corpus filters are applied **before** ranking, never after,
  to avoid top-k starvation.
- Prefer SQL/Drizzle `sql` templates for Postgres features (vector search, CTEs,
  text search).
- Model IDs and provider config come from environment variables — never hardcode.
- If eval data or extraction logic changes, run the relevant eval commands before
  claiming done. Minimum bar: `pnpm typecheck` + `pnpm eval:validate`; `pnpm build`
  for deploy-readiness or cross-cutting changes.
- Canon discipline: for canon-sensitive claims (pathway mapping, sequence tiers,
  aliases, character identity), use LOTM wiki evidence first; treat wiki inference
  as provisional and confirm ambiguity with the user. Never silently assert
  uncertain canon in seeds, extraction output, or eval judgments — domain errors
  propagate downstream and are expensive to unwind.

# MCP Boundaries

- Configured in `opencode.json` (`mcp.servers`): `arrodes-ro` (read-only Postgres
  for inspection/validation) and `lotm-wiki` (lore/wiki grounding).
- Prefer MCP tools for DB and wiki lookups; treat MCP responses as read-first
  evidence before changing code. Never commit credentials or DSNs from MCP config.

# Workflow & Git

- Follow existing naming and project patterns before introducing new abstractions;
  avoid new dependencies when the current stack covers the need.
- Favor explicit error handling and predictable behavior.
- When closing a ticket in `docs/tasks/`, patch stale downstream references before
  marking done (index table, dependency graph, dependent tickets).
- Never commit `.env*`, `.mcp.json`, local EPUB/source material, or eval-gold
  files' secrets. No tool-attribution lines in commit messages.
