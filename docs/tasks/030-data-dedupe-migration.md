---
id: 030
title: Data dedupe migration — unique keys ×3 tables + content_kind CHECK
phase: 5
status: done
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

## Resolution (2026-10-02, reopening Task 20)

- **Design revisions from the audit's live-data checks** (both ledgered):
  - events key = `(entity_id, event_type, evidence_chunk_id, md5(snippet))` — the planned 3-column key would have rejected 22 legitimate distinct-snippet multi-event groups; md5 also avoids the btree ~2704-byte limit.
  - entity_mentions key = `(chunk_id, entity_id, coalesce(role,''))` — 128 groups legitimately carry role variety (speaker + mentioned).
- **Applied to live Neon** (user-approved, `scripts/apply-data-dedupe.ts --yes`): deleted 397 duplicate rows (392 same-role mentions of 520 counted, 5 identical-snippet events of 28 counted; summaries already clean at 0) + CHECK + 3 unique indexes. Post-apply: dupe queries 0/0/0; totals mentions 129,101 → (dedupe removed 392), events 4,230 → 4,223 (5 identical dupes + 2 pre-existing variance), summaries 2,702.
- **Journal recovery:** `drizzle/meta/` was gitignored and lost (audit finding 10) — drizzle-kit regenerated a full-state `0000_low_nightmare.sql` as the new baseline; the live DB's `__drizzle_migrations` was reset to that baseline (hash-sha256 of the file, created_at = journal `when`) so future `pnpm db:migrate` entries apply cleanly. The hand-written delta (`drizzle/0003_data_dedupe.sql`) documents what the live DB received; fresh clones get everything from 0000. `drizzle/meta/` now committed.
- Insert paths: `events.ts` + `ner.ts` now `.onConflictDoNothing()`; `summaries.ts` insert already gated by `WHERE NOT EXISTS` on the identical natural key.
- `lib/rag/chunking.ts` oversized-paragraph flush fix + 3 tests (chunk order restored; DB NOT re-chunked — noted: already-ingested chapters with oversized paragraphs keep their historical order until a future deliberate re-chunk).
- NOTE: `arrodes-ro` MCP reads a different Neon branch than the script connection — MCP verification showed pre-apply state; all verification above ran on the script connection (`DATABASE_URL`/`DATABASE_URL_UNPOOLED`). Sync the MCP branch before relying on it for validation.

## Verification

```bash
pnpm test && pnpm typecheck
pnpm db:migrate
tsx scripts/dedupe-tables.ts        # dry-run shows 0 remaining dupes after first --yes run
```
