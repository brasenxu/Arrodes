---
id: 008
title: Hierarchical summaries (chapter → arc → volume)
phase: 1
status: done
depends_on: [005, 021]
estimate: M
updated: 2026-05-04
---

## Context

"Summarize chapter 245" or "what is the Red Priest arc about" should hit pre-computed summaries, not live-generate from retrieved chunks. Summaries respect authorial arc boundaries (not k-means clusters — RAPTOR-style but structured).

## Model tiers

Two tiers are required — cheap+fast for bulk chapter work, quality for arc/volume rollups:

| Level | Task | Env var | Default (Anthropic) | Default (post-migration) |
|---|---|---|---|---|
| 1 | Chapter summaries (~2,600 calls) | `INGEST_CONTEXT_MODEL` | claude-haiku-4-5 | deepseek-v4-flash |
| 2–4 | Arc / volume / series (~90 calls) | `INGEST_SUMMARY_MODEL` | claude-sonnet-4-6 | deepseek-v4-pro or gemini-2.5-flash |

`INGEST_SUMMARY_MODEL` is a new env var introduced by this ticket (see ticket 020 scope).
It defaults to the value of `CHAT_MODEL` if unset, which is a reasonable fallback since both
use the higher-capability tier.

### Why two models

Level 1 is ~2,600 short calls (one per chapter). `INGEST_CONTEXT_MODEL` (V4-Flash or
equivalent) is fast, cheap, and fully capable of writing 200-word chapter summaries from
pre-computed contextual prefixes. Levels 2–4 are ≤ 90 calls total but each takes a long
input (concatenated chapter or arc summaries) and must produce coherent narrative prose that
a user will actually read. The quality tier earns its price here.

### Prompt caching opportunity at level 1

Each chapter summary call can include the series primer (same as contextual retrieval /
NER) as a cached prefix, keeping the model anchored to the canon. Reuse the existing
`SERIES_PRIMER` from `lib/ingest/primer.ts` via the same `providerOptions: { anthropic: {
cacheControl: ... } }` pattern — silently ignored on non-Anthropic providers, automatic
caching fires on DeepSeek / Gemini regardless.

## Scope

- Build `lib/ingest/summaries.ts`:
  - Level 1 — Chapter summaries: per chapter, concatenate chunks' contextual prefixes +
    call `INGEST_CONTEXT_MODEL` to produce ~200 words.
  - Level 2 — Arc summaries: concat chapter summaries for the arc → `INGEST_SUMMARY_MODEL`
    → ~400 words. Arc boundaries come from `chapters.arc` + `chapters.arc_name` (set up
    by ticket 021) — multiple arcs per volume in both LOTM1 and COI.
  - Level 3 — Volume summaries: concat arc summaries → `INGEST_SUMMARY_MODEL` → ~400 words.
  - Level 4 — Series synopsis: one per book → `INGEST_SUMMARY_MODEL` → ~600 words.
- Embed each summary with `INGEST_EMBED_MODEL` (same as chunks).
- Insert into `summaries` table with `{level, book_id, range_start, range_end, label,
  content, embedding}`.
- Integrate into `scripts/ingest.ts --phase summaries`.
- **Cost-estimate pre-flight**: sample 20 chapters (level 1) + 3 arcs (level 2), extrapolate
  total spend for both models, print estimate, require `--yes`.

## Out of scope

- Live summary regeneration (future ticket — trigger via updateTag when chunks change).
- Multi-book series synopsis.

## Deliverables

- `lib/ingest/summaries.ts`.
- `scripts/ingest.ts` phase.
- `INGEST_SUMMARY_MODEL` added to `.env.example` and `.env.local`.

## Acceptance criteria

- LOTM1 produces: 1432 chapter summaries (1394 main + 38 side_story) + 37 arc summaries
  (34 main + 3 side) + 8 volume summaries + 1 series synopsis.
- COI produces: 1181 chapter summaries (1179 main + 1 bonus + 1 side_story) + 34 arc
  summaries (32 main + 2 bonus/side) + 8 volume summaries + 1 series synopsis.
- `SELECT level, count(*) FROM summaries GROUP BY level;` matches expected counts.
- Semantic sanity: embed the string "Klein meets Audrey" and query `summaries` — top-1
  should be a `Death of Lanevus` or adjacent Faceless-volume arc summary.
- **Resumable**: re-running skips chapters/arcs that already have a row in `summaries`.

## Verification

```bash
pnpm ingest --book lotm1 --phase summaries --yes
psql $DATABASE_URL_UNPOOLED -c "SELECT level, count(*) FROM summaries GROUP BY level;"
```

## Resolution

- Implemented `lib/ingest/summaries.ts` with hierarchical target planning and generation flow: chapter → arc → volume → series.
- Wired `scripts/ingest.ts --phase summaries` with reset safety, preflight sampling, cost/token reporting, and resumable inserts.
- Added tests in `lib/ingest/summaries.test.ts` covering planning/grouping, usage accounting, preflight helper behavior, and generation/embedding guardrails.
- Hardening updates applied during live runs:
  - capped representative arc preflight chapter generation to bound first-run cost/time,
  - fixed inserted-row reporting to count only true inserts,
  - added fallback handling for empty model output before embedding.
- Final verification completed:
  - `pnpm test lib/ingest/summaries.test.ts` passed,
  - `pnpm typecheck` passed,
  - real ingest runs for `lotm1` and `coi` completed until `pending: chapter=0 arc=0 volume=0 series=0`,
  - read-only DB validation matched expected counts for both books (including 1 series summary each), with no duplicate summary keys detected.

### Post-close notes (future tickets)

- Summary-tier model selection is intentionally constrained to DeepSeek IDs in code (`resolveDeepSeekSummaryModelId`). If future work wants Gemini (or other providers) for rollup summaries, this guard must be relaxed with tests.
- Duplicate protection is currently application-level (`INSERT ... WHERE NOT EXISTS`) and adequate for single-run workflows; if concurrent summary ingesters are introduced later, add a DB-level unique constraint on `(level, book_id, range_start, range_end, label)`.
- Recommended optional follow-up verification: run the semantic sanity nearest-neighbor probe from this ticket’s acceptance criteria and record the top-k labels as a baseline artifact.
