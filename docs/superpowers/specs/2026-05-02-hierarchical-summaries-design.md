# Hierarchical Summaries Design

## Goal

Implement ticket 008 as a resumable ingestion phase that precomputes chapter, arc, volume, and book-level summaries for `lotm1` and `coi`, embeds them, and stores them in the existing `summaries` table for later retrieval.

The pipeline should make "summarize chapter 245" and arc-level questions hit precomputed rows instead of live-generating prose from chunks. It should preserve the authorial arc boundaries already written to `chapters.arc` and `chapters.arc_name`.

## Current Context

The prerequisite data is already present in the database:

- `chapters`: `lotm1=1432`, `coi=1181`
- `chunks`: `lotm1=9393`, `coi=7005`
- `summaries`: empty
- Arc metadata matches ticket 021 expectations: LOTM1 has 34 main arcs plus 3 side-story arcs; COI has 32 main arcs plus 2 bonus/side arcs.

The codebase already has the required storage shape in `lib/db/schema.ts`:

- `level`: `chapter`, `arc`, `volume`, or `series`
- `bookId`
- `rangeStart`
- `rangeEnd`
- `label`
- `content`
- `embedding`

The existing ingestion style lives in `scripts/ingest.ts`: parse CLI flags, gather DB targets, run dry-run/preflight, require `--yes` for paid writes, print cost totals, and make reruns resumable by skipping existing rows.

## Architecture

Add `lib/ingest/summaries.ts` as the main pipeline module and add `summaries` to the allowed phases in `scripts/ingest.ts`.

The summary phase runs in dependency order:

1. Chapter summaries: one row per chapter, generated from the chapter metadata plus concatenated chunk contextual prefixes.
2. Arc summaries: one row per `(book_id, volume, arc, arc_name, content_kind)` range, generated from that arc's chapter summaries.
3. Volume summaries: one row per main-story `(book_id, volume, volume_name)` range, generated from that volume's main-story arc summaries.
4. Series synopsis: one row per book, generated from that book's main-story volume summaries.

Each target is independent. If generation or embedding fails for a target, no row is inserted for that target, and rerunning resumes from missing rows.

## Model And Provider Selection

Use the existing direct-provider pattern from `scripts/ingest.ts`.

- Chapter summaries use `INGEST_CONTEXT_MODEL` through the DeepSeek-compatible OpenAI provider wrapper.
- Arc, volume, and series summaries use `INGEST_SUMMARY_MODEL` if set, else `CHAT_MODEL`.
- Embeddings use `INGEST_EMBED_MODEL` through `openai.embedding(...)`, reusing `embedValues()`.

Model ID handling should reuse the existing `bareModelId()` behavior so both bare IDs and gateway-style `provider/model` values work.

`INGEST_SUMMARY_MODEL` is already listed in `.env.example`; the implementation should still validate that either `INGEST_SUMMARY_MODEL` or `CHAT_MODEL` is set before processing higher-level summaries.

## Generation Inputs

Chapter summaries should not use raw chapter text. They should use:

- book ID
- chapter number and title
- content kind
- volume name
- arc name
- ordered chunk contextual prefixes

This follows the ticket scope and keeps level 1 cheaper than re-reading every chapter through the model.

Arc summaries should use ordered chapter summaries for that arc. Volume summaries should use ordered arc summaries for that volume. Series summaries should use ordered volume summaries for that book.

Prompts should instruct the model to summarize only the supplied range and avoid future-looking interpretation. For COI, prior LOTM context is allowed only when it appears in the supplied summaries.

## Labels And Ranges

Use deterministic labels and ranges so resumability can be tested without relying on generated prose:

- Chapter: `Chapter {chapterNum}: {chapterTitle}`, `rangeStart=chapterNum`, `rangeEnd=chapterNum`
- Arc: `{volumeName} - {arcName}`, `rangeStart=min(chapterNum)`, `rangeEnd=max(chapterNum)`
- Volume: `Volume {volume}: {volumeName}`, `rangeStart=min(chapterNum)`, `rangeEnd=max(chapterNum)`
- Series: book title, `rangeStart=min(chapterNum)`, `rangeEnd=max(chapterNum)`

Side-story and bonus content should be included at the chapter and arc levels because the acceptance criteria count them there. They should not produce volume summaries: ticket 008 expects 8 volume rows per book, matching the main-story volumes only. Series synopses should also be generated from main-story volume summaries, not from side-story or bonus arcs.

## Resumability

Before generating any level, load existing `summaries` rows for the book and skip a target when a matching row already exists for:

- `level`
- `book_id`
- `range_start`
- `range_end`
- `label`

This mirrors existing ingest phases and avoids spending tokens on already-written summaries. It also prevents higher levels from running before their lower-level dependencies exist: arc targets require all chapter summaries in the arc, volume targets require all arc summaries in the volume, and series targets require all volume summaries for the book.

## CLI Behavior

Extend `scripts/ingest.ts`:

- Add `summaries` to `Phase` and `PHASES`.
- Keep `--book`, `--limit`, `--dry-run`, `--yes`, and `--reset`.
- `--dry-run` generates samples and embeddings but writes nothing.
- Without `--yes`, run cost preflight only.
- With `--yes`, process all missing targets or the limited subset.
- `--reset --yes` deletes summaries for the selected book only.

The `--limit` flag should cap generation targets in deterministic order across the pending target list. It is acceptable for a limited run to produce chapter summaries only until enough lower-level rows exist to unlock arc summaries on a later rerun.

## Cost Preflight

Preflight should sample up to:

- 20 pending chapter summaries
- 3 pending arc summaries whose chapter-summary inputs are already available

If the summaries table is empty and no arc inputs are available yet, preflight should pick up to 3 small representative arcs, generate their needed chapter summaries in memory without writes, then generate the arc summaries from those in-memory chapter summaries. This preserves the ticket's level 2 cost signal before the first real run.

It should extrapolate:

- level 1 cost from sampled chapter targets to all pending chapter targets
- level 2+ cost from sampled arc targets to pending arc/volume/series targets, using token usage from the quality model
- embedding cost from sampled summary text to all pending summary rows

The estimate is intentionally approximate. It should be conservative and visible before any real write. Passing `--yes` is required to perform DB writes.

## Testing Strategy

Use TDD for production behavior.

Focused unit tests should cover:

- chapter target grouping from chapter/chunk rows
- arc, volume, and series target grouping from prior-level summaries
- label and range calculation
- skip-existing behavior
- `--limit` target selection
- usage/cost aggregation
- insert row shaping for `summaries`

Integration-style confidence should include:

- `pnpm test lib/ingest/summaries.test.ts`
- `pnpm typecheck`
- `pnpm eval:validate`
- a small dry-run such as `pnpm ingest --book lotm1 --phase summaries --limit 3 --dry-run`

After the real run, verify:

```sql
SELECT level, count(*) FROM summaries GROUP BY level ORDER BY level;
```

Expected counts are:

- `chapter=2613`
- `arc=71`
- `volume=16`
- `series=2`

Also verify a semantic sanity check by embedding "Klein kills Lanevus after Audrey reports the clue" and querying `summaries`; the top result should be the `Death of Lanevus` arc summary or an adjacent Faceless-volume arc summary. The original ticket phrase, "Klein meets Audrey," should not be used for this assertion because their first meeting is a separate Tarot Club event in Volume 1.

## Out Of Scope

This ticket does not wire summaries into the chat route or retrieval tools. It produces and validates the stored summary data so later chat/retrieval work can consume it.

This ticket also does not implement live summary regeneration when chunks change. Existing rows remain stable until manually reset or deleted.