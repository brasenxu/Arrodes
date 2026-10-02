---
id: 014
title: Eval verification sweep + baseline run
phase: 4
status: todo
depends_on: [003, 005, 009]
estimate: L
updated: 2026-04-21
---

## Context

19/40 eval entries have empty `expected_chapters`. Without that, retrieval metrics are meaningless. This ticket sweeps all 40 entries to promote them to `status:"verified"` — filling in chapters, refining reference answers, and running the first real eval baseline.

Heaviest lift in Phase 4 because it requires the corpus to exist and someone (you) to read LOTM to verify. Real scope: implement `eval.ts` (currently a stub) + `eval-helper.ts` from scratch, author the 19 missing `expected_chapters`, and promote all 40 draft entries — hence the `L` estimate.

Lore/pathway entries verify **EPUB-only** for now; wiki cross-verification is deferred until ticket 016 (wiki ingest) lands, with a re-verification pass afterwards.

## Scope

- Build `scripts/eval-helper.ts` — interactive CLI:
  - Loads each draft entry.
  - Runs the question through `hybridSearch` (no LLM — just retrieval).
  - Prints top-8 chunks with their chapter numbers.
  - Prompts: `Add chapter to expected? [n]` — user types `245,732,800` or `skip`.
  - Writes updated entry back to the JSONL in place; flips to `status:"verified"`.
- Build `scripts/eval.ts` (already stubbed) — fills in:
  - For each verified entry: embed → `hybridSearch` → compute `recall@8 = |retrieved_chapters ∩ expected_chapters| / |expected_chapters|`.
  - Aggregate by query type — expect uneven quality (dialogue/quote hardest).
  - Spoiler-leak check: for entries with `reading_position`, any retrieved chunk beyond bound = hard fail.
  - Write full run to `eval_runs` table with `{config: {models, k}, results: [...], summary: {...}}`.
- Run baseline: target recall@8 > 0.7 by query type; surface weak types in the summary.
- ~~Fill unmapped COI arc ranges~~ — **Moved to ticket 021.** 021 rebuilds the arc-map with wiki-verified arc boundaries for both books (not just the COI unmapped stretches), and handles the re-ingest. By the time 014 runs, COI arc metadata is already correct.

## Out of scope

- LLM-as-judge scoring (Phase 5).
- Regression alerts / CI integration.

## Deliverables

- `scripts/eval-helper.ts`.
- Updated `scripts/eval.ts`.
- `data/eval/eval-set.jsonl` with all 40 entries `status:"verified"`.
- Baseline results pasted into `## Findings`.

## Acceptance criteria

- `pnpm eval:validate` shows `draft: 0, verified: 40`.
- `pnpm eval` runs to completion and writes a row to `eval_runs`.
- Baseline summary shows recall@8 per query type; weakest type documented with hypothesis for improvement.
- (COI arc mapping verification moved to ticket 021; 014 assumes arc-map is already correct.)

## Verification

```bash
pnpm tsx scripts/eval-helper.ts   # interactive
pnpm eval
pnpm eval:validate
```

## Findings

<!-- Paste baseline summary here:
  chapter_summary: recall@8 = …
  lore:           recall@8 = …
  character:      recall@8 = …
  pathway:        recall@8 = …
  timeline:       recall@8 = …
  dialogue:       recall@8 = …
  aggregation:    recall@8 = …
-->
