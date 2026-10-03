---
id: 014
title: Eval verification sweep + baseline run
phase: 4
status: review
depends_on: [003, 005, 009]
estimate: L
updated: 2026-10-03
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

### Baseline (2026-10-02, reopening Task 21 — retrieval-only, k=8, 29 verified entries)

Ground truth: 29 entries verified — 8 pre-authored (promoted), 21 authored from independent evidence (events pipeline, chapter summaries, lexical text search — NOT the embedding retrieval being scored; per-entry sources in the eval-set `notes`). **11 remain draft for the human pass** (Q007, Q017, Q020, Q022, Q023, Q029, Q031, Q032, Q037, Q038, Q040) — `scripts/eval-helper.ts` (interactive CLI: retrieval preview → add chapters → verified, written back in place) is ready for it; `pnpm eval` skips drafts. *An earlier version of this note claimed the helper was already built — it wasn't; written during the final review fix pass (2026-10-02).*

| Query type | Entries | recall@8 |
|---|---|---|
| chapter_summary | 6 | **0.431** (was 0.097 pre-fix) |
| lore | 5 | 0.600 |
| timeline | 5 | 0.300 |
| character | 5 | 0.000 |
| pathway | 2 | 0.000 |
| dialogue | 2 | 0.000 |
| aggregation | 4 | 0.036 |
| **Spoiler leaks** | — | **0 / 29** (hard gate passed) |

Fix shipped during the baseline loop: `extractChapterPin` — questions naming an explicit "chapter N" now pin retrieval to that chapter (chat path + eval path); chapter_summary recall tripled.

Weakest types + hypotheses (the 0.7 target iteration continues in follow-up tickets):
- **character (0.000)**: "Who is X?" semantically matches X's *scenes* everywhere, not their intro chunks (expected = ch.5-7 intros). Hypothesis: entity-anchored retrieval — join `entity_mentions` first-appearance chunks into the ranking, or cross-encoder rerank (ticket 016c); entity intros also arrive via `lookupEntity` in the chat path (026 closed).
- **pathway (0.000)**: ladder-listing questions match scattered pathway chatter; the canonical ladder lives on the Blasphemy Slate chunks (ch.60-61) which don't lexically/semantically match "List all nine Sequences…". Hypothesis: 026's `lookupSummary` handles this in chat; for retrieval, wiki-ingested pathway tables (ticket 016a) become retrievable ground.
- **dialogue (0.000)**: paraphrased quote-finding is the hardest; both entries still draft-pending human phrasing (Q029/Q031-Q032 are the dialogue anchors). 019's speaker-attribution preprocessor is the structural fix.
- **aggregation (0.036)**: by design — "list every X" starves on top-8 retrieval; the chat path routes these to `aggregateEvents` (working). The eval metric here is a lower bound, not a product signal.
- **timeline (0.300)**: "when does X first happen" needs first-appearance anchoring — same hypothesis as character.

`eval_runs` rows written for all three baseline runs (pre-fix, post-pin).

### Status: review (2026-10-02 final-review re-scope)

The original AC "draft: 0, verified: 40" requires the human chapter pass — 11 entries stay draft until it runs (`pnpm tsx scripts/eval-helper.ts`; the eval runner already skips them, so the baseline above is trustworthy). 014 closes when the user finishes the sweep — everything else in this ticket (runner, scoring, spoiler gate, baseline) is delivered and green.

### Wiki-grounded note-hygiene pass (2026-10-03, post-merge board audit)

Pre-016a canon correction of the eval set via the `lotm-wiki` MCP (ticket 027 tooling) — chapter loci untouched (still the human pass):

- **Canon-wrong notes fixed:** Q004 (side-story boundaries per 003 — "bonus chapters are 1395, 1396" was wrong), Q005 (Cordu Village is Intis, not "southern Feysac"), Q014 (debut ch.5 is Clown arc — "Early-Faceless" removed), Q016 ("Rueselland/Ruen Empire" was hallucinated — Roselle is Emperor of the Intis Empire, "Son of Steam", Black Emperor S0), Q034 ("tarot_meeting" event-type doesn't exist — it's `meeting`, populated by 007), Q024/Q025 (stale wrong seed text — "roughly ch 80–100" / "around ch 215–240" — removed where the authored suffix already carried the correction).
- **Q013:** removed "Benson Moretti" from expected_entities — same defect 007 caught on Q035 (real brother, not an identity).
- **Q018:** canon-corrected (S9 Hunter → ends as Calamity of Destruction, authorities over Red Priest + Demoness; Tarot codename The Chariot; wiki reveal refs ~2|1034/2|1122/2|1178) and **downgraded verified→draft** — expected_chapters [1] cannot ground the end-state question; it joins the eval-helper sweep. Counts: **28 verified / 12 draft** (baseline table above predates this; the next `pnpm eval` reflects it). expected_entities updated to seed-existing rows: Red Priest + Demoness.
- **Q020:** Tyrant S0 deity wiki-confirmed as the **Lord of Storms** (ladder S9 Sailor → S0 Tyrant); "Crimson Moon is Tyrant Sequence 0" was wrong (Moon-pathway association, no seed row) → swapped to Lord of Storms.
- **Q022:** **Darkness pathway / The Star** wiki-confirmed (Hermit guess wrong); entities updated to seed-existing rows (Leonard Mitchell, Darkness, Sleepless, The Star); codename locus ~ch.951 still needs the human pass.
- **Q019:** full Fool ladder wiki-verified (5 Marionettist, 4 Bizarro Sorcerer, 3 Scholar of Yore, 2 Miracle Invoker, 1 Attendant of Mysteries) — recorded in the entry's notes; folding the titles into the Fool seed row is 018 issue #1, so expected_entities left untouched.
- **Systemic 018 flag:** expected_entities referencing names with no seed row — "Uniqueness" (Q009/Q020/Q040), "Magician", "Faceless" (Q019). Entity recall silently caps until 018 folds them.
- **Question-text nit for the human pass:** Q010's "True Creators" should be singular (the True Creator) — left as-is here, fix when editing questions.
- `scripts/eval-helper.ts` verification stamp now uses the run date (was hardcoded 2026-10-02).
- Gates: `pnpm eval:validate` — 40 entries, {verified: 28, draft: 12} · `pnpm typecheck` — clean.
