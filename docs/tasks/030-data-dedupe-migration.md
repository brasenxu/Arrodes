---
id: 030
title: Data dedupe migration — unique keys ×3 tables + content_kind CHECK
phase: 5
status: todo
depends_on: [003, 005, 006, 007, 008]
estimate: M
updated: 2026-10-02
---

**Supersedes ticket 023** (summaries-only) — audit findings 11-12 showed `entity_mentions` and `events` have the same gap.

## Context

No unique keys on `summaries`, `entity_mentions`, or `events`: idempotency is app-level only (per-chapter "zero rows" gates). Read-side `dedupeSummaryRows` (`lib/ingest/summaries.ts:621`) is direct evidence duplicate summary rows already exist in Neon. `summaries` meta is reconstructed from mutable `chapters` rows and `validateSummaryDbRow` throws on mixed metadata — a re-run after any arc rewrite can crash the summaries phase. Also: `chunking.ts` chunk-order inversion on oversized paragraphs corrupts `chunk_index` order (fix code; do not re-chunk now).

## Scope

- `lib/rag/chunking.ts:49-59`: `flush()` the buffer unconditionally before pushing oversized-paragraph sentence chunks; unit test pinning strictly-increasing narrative order.
- One-off `scripts/dedupe-tables.ts`: dry-run by default, `--yes` applies; per table delete duplicates keeping min `id`; print before/after counts.
  - summaries key: `(book_id, level, range_start, range_end, label)` (per 023's identity definition)
  - entity_mentions key: `(chunk_id, entity_id)`
  - events key: `(entity_id, event_type, evidence_chunk_id)`
- Drizzle schema: unique indexes on the three keys + `CHECK (content_kind IN ('main','side_story','bonus'))`; `pnpm db:generate`; apply with `pnpm db:migrate`.
- Insert paths (`lib/ingest/summaries.ts`, `ner.ts`, `events.ts`): `onConflictDoNothing()`.
- Un-ignore `drizzle/meta/` in `.gitignore` (migrations reproducible on fresh clone).

## Out of scope

- Re-running ingest phases; extraction prompt changes; an `extraction_version` column scheme for events (noted for future — the key above makes re-extraction of one chapter replace-safe only via pre-dedupe + DO NOTHING).

## Deliverables

- Migration SQL + updated schema.ts; dedupe script; chunking fix + test; updated insert paths.

## Acceptance criteria

- Migration applied on Neon; dedupe script's second run is a no-op (counts unchanged).
- `pnpm test` + `pnpm typecheck` green.
- Before/after row counts recorded in Resolution.

## Verification

```bash
pnpm test && pnpm typecheck
pnpm db:migrate
tsx scripts/dedupe-tables.ts        # dry-run shows 0 remaining dupes after first --yes run
```
