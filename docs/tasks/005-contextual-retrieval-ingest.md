---
id: 005
title: Contextual retrieval + embed + chunk insert
phase: 1
status: done
depends_on: [001, 003]
estimate: L
updated: 2026-04-23
---

## Resolution (2026-04-23)

Ingest complete for both books. Measured results:

- **LOTM1**: 9,393 chunks (1432 chapters), avg 489 tokens/chunk, $37.13
- **COI**: 7,005 chunks (1181 chapters), avg 482 tokens/chunk, ~$31
- **Total chunks in DB: 16,398**
- **Total spend: ~$68** (3× the $20 Haiku estimate; cost envelope in the DAB updated to reflect reality)

Verification (Neon SQL, post-reset of claude-sandbox branch):
- Null embeddings: 0
- Short / empty prefixes: 0
- HNSW self-match cosine_dist = 0.0000; semantic clustering of near-neighbors confirmed (same-chapter siblings at 0.13–0.22, cross-chapter thematic matches at 0.22–0.24)
- content_kind distribution: LOTM1 main=9214, side_story=179; COI main=6985, bonus=14, side_story=6

Key design decisions captured during the run:
1. **Direct provider wiring, not AI Gateway.** Gateway required card-on-file; user had direct Anthropic access. Added `@ai-sdk/anthropic` + `@ai-sdk/openai`, switched `lib/ingest/contextualize.ts` + `embed.ts` signatures from `model: string` → provider-instance types. Gateway still available via `bareModelId()` helper that strips `provider/` prefixes.
2. **Series primer padding.** Haiku 4.5 has a 4096-token minimum cacheable prefix. Most LOTM chapters (~3000–5000 tokens) were borderline; without padding, ~99% of input tokens paid noCache rate. `lib/ingest/primer.ts` contains a ~2000-token primer with strict anti-anachronism / anti-contamination rules. Cost dropped from ~$0.027 → ~$0.019–0.026 per chapter once caching fired reliably.
3. **Idempotency via existence check.** Script skips chapters that already have chunks. Made the LOTM1 full run resumable and let us delete+re-ingest the first 100 chapters (done before the primer was wired) for corpus consistency.

Known deviations from original acceptance criteria:
- "~13–15k chunks for LOTM1" → actual 9,393. DAB's chunks/chapter estimate was optimistic; real density is 6.6 chunks/chapter. Not a quality issue — avg token count is in the 400–600 target range.
- "Token spend within 50% of $20 estimate" → fails strictly ($37 for LOTM1 alone); user accepted the overrun and updated the DAB cost envelope.

Unblocks: 006 (NER), 008 (summaries), 009 (hybrid retrieval integration test).

## Context

The single highest-ROI technique for this project (per the DAB and Anthropic's blog): before embedding each chunk, prepend 50–100 tokens of LLM-generated chapter context. Anthropic reported 49% fewer retrieval failures (67% with reranking). Cost: ~$20 via Haiku 4.5 + prompt caching (cache the full chapter once, query per chunk).

This ticket does chunk+contextualize+embed+insert as one pipeline because they share the per-chapter prompt cache window — splitting them would duplicate the cache setup cost.

## Scope

- Build `lib/ingest/contextualize.ts`:
  - Loads one chapter's full text into a prompt-cached block (`cache_control: { type: "ephemeral", ttl: "1h" }`).
  - For each chunk in the chapter, calls Haiku with the cached chapter + chunk, asking for 50–100 tokens situating the chunk.
  - Returns `{ chunk_index, contextual_prefix }[]`.
- Build `lib/ingest/embed.ts`:
  - `embedMany({ model: EMBED_MODEL, values: [prefix + "\n\n" + content, …] })` batched in groups of 100.
  - Returns `number[][]`.
- Build `lib/ingest/chunks.ts`:
  - Orchestrates: chunkChapter → contextualize → embedMany → insert rows.
  - Transactional per chapter (partial chapter failure should roll back that chapter, not the whole book).
- Integrate into `scripts/ingest.ts --phase chunks`.
- Honor a `--dry-run` flag that skips DB writes and logs a sample output for the first 3 chapters.
- Honor a `--book lotm1` / `--book coi` / `--limit N` so we can incrementally ingest and pause.
- Track token spend in an aggregate counter and print a running total at the end.
- **Cost-estimate pre-flight:** before starting the full run, process 5 sample chapters, extrapolate total cost from per-chunk Haiku + embedding tokens, print `Estimated cost: $X.XX for N chapters`, and require `--yes` to proceed. Prevents accidental $50+ runs.

## Out of scope

- NER / events / summaries (tickets 006/007/008).
- Retry / resume semantics beyond "re-run and it skips chapters whose chunks already exist" — implement via a per-chapter existence check.

## Deliverables

- `lib/ingest/contextualize.ts`, `lib/ingest/embed.ts`, `lib/ingest/chunks.ts`.
- Updated `scripts/ingest.ts` with phase + limit + dry-run flags.
- npm scripts updated if needed.

## Acceptance criteria

- `pnpm ingest data/epub/LOTM.epub --book lotm1 --phase chunks --limit 5 --dry-run` prints 5 chapters' worth of `{chunk_index, content_sample, contextual_prefix}` without writing.
- Full run produces ~13–15k chunks for LOTM1 (estimate: 1396 chapters × 9–11 chunks/chapter).
- `SELECT count(*), avg(token_count) FROM chunks WHERE book_id='lotm1';` shows average token count 400–600.
- HNSW index query on any sample embedding returns reasonable neighbors (no nulls, no zero-vectors).
- Token spend log shows Haiku cost within 50% of the $20 estimate.

## Verification

```bash
pnpm ingest data/epub/LOTM.epub --book lotm1 --phase chunks --limit 3 --dry-run
# inspect output

pnpm ingest data/epub/LOTM.epub --book lotm1 --phase chunks
# full run — expect 30–60 min

psql $DATABASE_URL_UNPOOLED -c "SELECT book_id, count(*) FROM chunks GROUP BY book_id;"
psql $DATABASE_URL_UNPOOLED -c "SELECT chapter_num, count(*) FROM chunks WHERE book_id='lotm1' GROUP BY chapter_num ORDER BY 1 LIMIT 10;"
```
