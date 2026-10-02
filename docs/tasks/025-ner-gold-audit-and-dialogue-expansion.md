---
id: 025
title: NER gold audit + targeted dialogue expansion
phase: 5
status: todo
depends_on: [006]
estimate: M
updated: 2026-10-02
---

> **Waves (2026-10-02):** Wave 1 = thin gold pass (audit current 26-chunk gold, re-adjudicate ambiguous roles) — depends on 006 only, runs **before** 019 so the preprocessor measures against stable gold. Wave 2 = targeted dialogue expansion — after 019. 014 was dropped from `depends_on`: the NER-gold files are independent of the retrieval eval set. Wave 2 also absorbs event-gold expansion from 007's carried-forward gaps (`organization_join`/`identity_reveal` 0 labels, `sequence_advance` 1 noisy label) if it fits, or spins a follow-up ticket.

## Context

Current `ner:score` results are being used to guide role-attribution work, but the eval set is still small (`data/eval/ner-gold.jsonl`, 26 chunks) and likely has label drift/gaps in difficult dialogue patterns. This creates a risk that model and rule changes optimize to annotation noise instead of true extraction quality.

The highest-risk area is `addressee`: sparse positives, ambiguous prose cues, and potential rubric inconsistency can move F1 significantly with only a few disputed labels.

## Recommended sequencing (with ticket 019)

If the goal is to avoid tuning the pipeline to label noise, prefer **025 before 019** in spirit—but split 025 into two waves so 019 is not blocked on the full expansion:

1. **Thin pass (this ticket, first):** reconcile the current 26 chunks against DB text and re-adjudicate only the high-leverage slices (ambiguous `speaker`/`addressee`, `mentioned` vs role, and chunks that show `MISSED` / `HALLUCINATED` / `ROLE_MISMATCH` in `ner:score`).
2. **019 next:** implement preprocessor + LLM-hint integration and measure deltas against that stabilized core set.
3. **Full expansion (this ticket, second wave):** add targeted dialogue-heavy chunks once failure modes from 019 are visible, so new gold rows stress real gaps instead of random prose.

Exception: you can start **019 first** if you explicitly accept iterating on a noisier eval and plan a gold reset afterward—otherwise the default ordering above keeps metrics trustworthy.

## Scope

- Audit the current 26 labeled chunks against the exact DB chunk text used by scoring.
- Re-adjudicate ambiguous role labels (`speaker` vs `addressee` vs `mentioned`) using a written rubric with evidence-span requirements.
- Expand gold with targeted dialogue-heavy chunks, biased toward known failure modes:
  - missing/indirect attribution verbs,
  - interrupted quote/narration patterns,
  - explicit "said to X" and vocative addressee cases,
  - scorer disagreement buckets (`MISSED`, `HALLUCINATED`, `ROLE_MISMATCH`).
- Keep `notes` and provenance metadata clear so changes are traceable across iterations.
- Re-run scoring and report before/after deltas with updated label counts per role.

## Annotation workflow (human + LLM)

Labeling can be **human-only**, **LLM-assisted**, or **mixed**. If using models (company API, Cursor, or consumer ChatGPT/Claude chat), keep humans in the loop for disputes and spot checks.

- **Propose + adjudicate:** one pass proposes `gold_mentions`; a second pass critiques against the rubric and must cite **minimal evidence substrings** from the chunk before changing a role. Prefer **two different model families or providers** (e.g. GPT vs Claude) so errors are less correlated than same-stack double prompts.
- **Fallback without two APIs:** same model, **second prompt role** (“adversarial reviewer”) with temperature 0 for both passes; weaker than cross-vendor but still useful.
- **Spend control:** run full adjudication on **disagreements**, **low-confidence** outputs, and **schema failures**; spot-check a **random sample** of agreements.
- **Mechanics:** batch chunks into a single file; require **machine-parseable output** (JSONL matching existing gold shape); validate before merge; record **provenance** (tool, model id if known, date) in `notes` or sidecar where useful.
- **Policy:** confirm employer rules for sending excerpted prose through third-party tools before scaling.

## Out of scope

- Rewriting the runtime NER extraction pipeline itself (covered by ticket 019).
- Full-corpus relabeling.
- New schema work for eval storage.

## Deliverables

- Updated `data/eval/ner-gold.jsonl` with adjudicated labels and added chunks.
- Short rubric doc for role labeling decisions (or appended rubric section in existing eval docs).
- Change log summarizing label corrections, newly added chunks, and rationale.
- Refreshed `pnpm ner:score` metrics with role breakdown.

## Acceptance criteria

- All original 26 eval chunks are reconciled against DB chunk text and pass rubric review.
- Gold set size increases by at least 2x with targeted dialogue coverage (minimum 52 labeled chunks).
- Role label distribution is reported before/after expansion, including addressee count.
- At least one independent verification pass (human or adjudication workflow) is documented for changed labels.
- `pnpm ner:score` runs cleanly on the expanded set and outputs stable metrics without schema/format errors.

## Verification

```bash
pnpm ner:score --verbose

psql $DATABASE_URL_UNPOOLED -c "
  SELECT book_id, chapter_num, chunk_index
  FROM chunks
  WHERE id IN (/* eval chunk ids */)
  ORDER BY book_id, chapter_num, chunk_index;
"
```

## Findings

<!-- Paste adjudication summary, added-chunk stats, and metric deltas after run. -->
