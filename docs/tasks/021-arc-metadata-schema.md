---
id: 021
title: Arc-level metadata schema (sub-arcs within volumes)
phase: 1
status: done
depends_on: [005]
estimate: M
updated: 2026-04-24
---

## Context

Current `chapters` table has `volume` + `volume_name` but no concept of narrative arcs within a volume. `lib/ingest/arc-map.ts` conflates arc with volume (one range per volume). Ticket 008 (hierarchical summaries) needs arc summaries distinct from volume summaries — "Klein meets Audrey" should retrieve the Faceless-arc summary, not the whole Vol 2 Faceless summary. Volumes also contain multiple arcs in both books (e.g., Vol 6 Dream Weaver's `The Fool's Dream` covers 131 chapters of a 150-chapter volume; LOTM1 Vol 1 Clown has 5 distinct narrative phases), so the current schema is insufficient.

Arc boundaries have been derived from the LOTM fandom wiki (Volume N timelines + `{{Main|X}}` event-page references + Category:Events). Full derivation and proposed arc list is in `.claude/plans/2026-04-23_Arc-Derivation.md` *(machine-local, no longer on disk — `lib/ingest/arc-map.ts` is now the sole authoritative canon; see References below).*

This ticket also absorbs the "Fill unmapped COI arc ranges" sub-task previously on ticket 014 — now obsolete since 021 rebuilds the whole arc-map with verified boundaries.

## Scope

- **Schema change (`lib/db/schema.ts`)** — add two columns to `chapters`:
  - `arc` — integer, 1-based index within the volume (0 for side/bonus content).
  - `arc_name` — text, exact name matching wiki canonical anchor when available, else a 3–6-word descriptive noun phrase.
- **Migration** — new `drizzle/0002_<name>.sql`:
  - `ALTER TABLE chapters ADD COLUMN arc integer NOT NULL DEFAULT 0;`
  - `ALTER TABLE chapters ADD COLUMN arc_name text NOT NULL DEFAULT '';`
  - Drop default after backfill (or leave defaults for side/bonus rows where arc=0 is correct).
  - Optional: add index on `(book_id, volume, arc)` if retrieval plans filter by arc.
- **Rewrite `lib/ingest/arc-map.ts`:**
  - `Range` type gains `arc: number` + `arcName: string`.
  - `ArcAssignment` return type gains `arc` + `arcName`.
  - Replace 11 LOTM1 ranges + 7 COI ranges (total 18) with 37 LOTM1 + 34 COI (total 71), one `Range` per arc.
  - Arc names: use `{{Main|X}}` verbatim for the 19 canonical-anchored arcs (see plan doc); descriptive 3–6-word noun phrases for the rest.
  - Contiguity: each chapter in a book maps to exactly one arc; no gaps, no overlaps.
- **Update `lib/ingest/arc-map.test.ts`:**
  - Per-arc sample tests (~10 representative chapters per book hitting different arcs).
  - Contiguity test: iterate all chapters per book, assert every chapter lands in an arc with valid `(volume, arc)` tuple.
  - Arc-count test: distinct arc names per book match expected (34 main + 3 side for LOTM1; 32 main + 2 bonus/side for COI).
  - Arc chapter-count test: per-volume arc counts match the plan doc.
- **Update chapters ingestion (`lib/ingest/chapters.ts` or wherever `assignArc` is consumed):** write `arc` + `arc_name` to the insert row alongside `volume` + `volume_name`.
- **Backfill chapters (non-destructive)** via `scripts/backfill-arcs.ts` — the `pnpm ingest --phase chapters` path DELETEs chapters, which cascades to `chunks` (and therefore wipes `entity_mentions` + `events`). Backfill UPDATEs existing rows in place:
  - `pnpm backfill:arcs --book lotm1`
  - `pnpm backfill:arcs --book coi`
  - **COI rows** also get corrected `volume` (previously all `volume=0` — now 1–8) and `volume_name` (previously `unmapped` in 2 ranges) in the same pass.

## Out of scope

- Arc-aware retrieval filtering in `lib/rag/retrieval.ts` — deferred to 008 (summaries) or later.
- Tool definitions that expose arc metadata — deferred to 008 / 010.
- Live arc-map updates (triggering re-ingest when chapters shift between arcs) — N/A since books are finished.
- Arc summary generation itself — that's ticket 008. This ticket only provides the metadata foundation.

## Deliverables

- `drizzle/0002_<name>.sql` with column additions.
- Updated `lib/db/schema.ts` (chapters table).
- Rewritten `lib/ingest/arc-map.ts` with 71 arc ranges.
- Updated `lib/ingest/arc-map.test.ts` with new test coverage.
- Updated `lib/ingest/chapters.ts` (`ChapterRecord` + `extractChapters`) and `scripts/ingest.ts` insert row to write new columns on fresh ingests.
- New `scripts/backfill-arcs.ts` (and `pnpm backfill:arcs` script alias) for non-destructive backfill of existing rows.
- Chapters table in Neon backfilled for both books.

## Acceptance criteria

- `pnpm typecheck` passes.
- `pnpm test lib/ingest/arc-map.test.ts` passes (contiguity, coverage, per-arc samples).
- `pnpm db:migrate` applies cleanly.
- `SELECT book_id, count(DISTINCT arc_name) FROM chapters GROUP BY book_id;` returns `lotm1=37, coi=34`.
- `SELECT arc_name, count(*) FROM chapters WHERE book_id='lotm1' AND volume=1 GROUP BY arc_name ORDER BY min(chapter_num);` returns 5 arcs with chapter counts summing to 213.
- `SELECT count(*) FROM chapters WHERE arc=0 AND content_kind='main';` returns 0 (no main-story chapter left with `arc=0`).
- `SELECT count(*) FROM chapters WHERE arc_name='unmapped';` returns 0 (COI deferrals now resolved).
- Canonical anchor sanity: `SELECT count(*) FROM chapters WHERE arc_name='The Fool''s Dream';` returns between 130–132 (the 131-chapter COI Vol 6 sub-arc).

## Verification

```bash
pnpm typecheck
pnpm test lib/ingest/arc-map.test.ts
pnpm db:generate && pnpm db:migrate
# Non-destructive backfill — replaces the ticket's original chapters --reset path
# so chunks/entity_mentions/events are preserved. Run AFTER ticket 007 finishes.
pnpm backfill:arcs --book lotm1
pnpm backfill:arcs --book coi
psql $DATABASE_URL_UNPOOLED -c "SELECT book_id, count(DISTINCT arc_name) FROM chapters GROUP BY book_id;"
psql $DATABASE_URL_UNPOOLED -c "SELECT arc_name, min(chapter_num), max(chapter_num), count(*) FROM chapters WHERE book_id='lotm1' GROUP BY arc_name ORDER BY min(chapter_num);"
psql $DATABASE_URL_UNPOOLED -c "SELECT arc_name, min(chapter_num), max(chapter_num), count(*) FROM chapters WHERE book_id='coi' GROUP BY arc_name ORDER BY min(chapter_num);"
```

## References

- **Authoritative arc list:** `.claude/plans/2026-04-23_Arc-Derivation.md` — see the **Implementation table** section at the bottom. 71 rows total (37 LOTM1 + 34 COI). Copy verbatim into `arc-map.ts` — `arc_name` values are final, do not rename. *(Machine-local file, no longer on disk; `lib/ingest/arc-map.ts` is now the sole authoritative arc canon — do not re-derive from memory.)*
- Source: LOTM fandom wiki Volume N pages (Synopsis + Timeline of Major Events) + Category:Events.
- Schema context: current `arc-map.ts` at `lib/ingest/arc-map.ts`, current chapters schema at `lib/db/schema.ts:40-57` (chapters table), existing tests at `lib/ingest/arc-map.test.ts`.

## Implementation hint

Start by reading the **Implementation table** in the plan doc. Each table row maps 1:1 to a `Range` entry in `arc-map.ts`. The existing file at `lib/ingest/arc-map.ts` has 18 ranges keyed on `(start, end, volume, volumeName, contentKind)`; replace with 71 ranges keyed on `(start, end, volume, volumeName, arc, arcName, contentKind)`. The `assignArc()` function signature changes to return `{ volume, volumeName, arc, arcName, contentKind }`.

## Resolution

Closed 2026-04-24. All acceptance criteria verified against the claude-sandbox Neon branch (post `neonctl branches reset claude-sandbox --parent`):

- `distinct arc_name per book`: `lotm1=37`, `coi=34` ✓
- `arc=0 AND content_kind='main'`: `0` rows ✓
- `arc_name='unmapped'` / `volume_name='unmapped'`: `0` rows ✓
- `arc_name='The Fool''s Dream'`: `131` rows ✓
- LOTM1 Vol 1 arc breakdown: 5 arcs summing to 213 (57+49+65+31+11) ✓
- Main-story volume arc distribution: LOTM1 = 5+5+5+5+5+3+3+3 = 34 arcs (1394 ch); COI = 4+4+4+5+4+3+4+4 = 32 arcs (1179 ch) ✓

### Files changed

- `lib/ingest/arc-map.ts` — rewritten with 71 ranges, added `arc`/`arcName` to `Range` and `ArcAssignment`.
- `lib/ingest/arc-map.test.ts` — 75 tests covering per-arc samples, contiguity, distinct-arc-name counts, per-arc chapter counts, and canonical-anchor sanity (The Fool's Dream = 131).
- `lib/db/schema.ts` — added `chapters.arc` (int, default 0) + `chapters.arc_name` (text, default '') + index `chapters_book_volume_arc_idx` on `(book_id, volume, arc)`.
- `lib/ingest/chapters.ts` — `ChapterRecord` gains `arc`/`arcName`; `extractChapters()` passes them through.
- `lib/ingest/chapters.integration.test.ts` — added arc-count assertions for both books.
- `scripts/ingest.ts` — chapters insert row includes new fields for fresh ingests.
- `drizzle/0002_material_tusk.sql` — generated; additive + non-blocking.
- `scripts/backfill-arcs.ts` + `pnpm backfill:arcs` alias — new non-destructive backfill.

### Deviations from original plan

- **Replaced `pnpm ingest --phase chapters --reset` with a standalone backfill script** (`scripts/backfill-arcs.ts`). The original path DELETE+INSERTs chapters, which cascades through `chunks.chapter_id ON DELETE CASCADE` and would wipe the entity_mentions + events already ingested. The backfill UPDATEs volume / volume_name / arc / arc_name in place. Used `UPDATE ... FROM (VALUES ...)` with explicit first-row casts after an initial CASE-based attempt failed on Neon with `column "volume" is of type integer but expression is of type text` (bare parameters default to text in a pure CASE).
- **COI volumes were also rewritten**, not just arc-annotated. The previous COI_RANGES had `volume=0` for everything plus two `unmapped` mid-ranges; the new ranges set `volume=1..8` with real volume names. Backfill picked this up automatically.
