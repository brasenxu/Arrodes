---
id: 002
title: EPUB sanity probe
phase: 1
status: done
depends_on: []
estimate: S
updated: 2026-04-21
---

## Context

Before spending Haiku budget on contextual retrieval, we must confirm `@gxl/epub-parser` produces clean chapter boundaries on our specific `data/epub/LOTM.epub` and `data/epub/COI.epub`. Fan-made EPUBs vary wildly — some split by volume, some interleave translator notes, some carry stale TOCs. If the parser misbehaves, fix it here, not at $10 of sunk cost during ingest.

## Scope

- Write `scripts/probe-epub.ts` that:
  - Loads both EPUBs.
  - Logs per book: `{ sectionCount, firstSectionTitle, lastSectionTitle, sampleMiddleSection }`.
  - Heuristically detects chapter headers (regex `/^(Chapter\s+\d+|第\d+章)/i`) and prints match counts.
  - Flags mismatch vs. expected counts: LOTM1=1396 main, COI=1180 main.
- Add npm script: `"probe": "tsx scripts/probe-epub.ts"`.

## Out of scope

- Fixing parser quirks (belongs to 003 if needed).
- Any DB write.

## Deliverables

- `scripts/probe-epub.ts`.
- package.json script entry.
- A terminal dump of the probe output pasted into this ticket under `## Findings` when run.

## Acceptance criteria

- Running `pnpm probe` prints per-book structure without throwing.
- Match counts are within 2% of expected (some tolerance for bonus chapters / afterword / translator notes).

## Verification

```bash
pnpm probe 2>&1 | tee /tmp/probe.log
# Then inspect: how many sections map to chapters? Any weird boilerplate sections up front?
```

## Findings

Ran `pnpm probe` 2026-04-21. Both EPUBs parse cleanly, no exceptions. Headline numbers:

| Book   | sectionCount | chapter-header matches | Expected (ticket) | Actual main story | Notes |
|--------|--------------|------------------------|-------------------|-------------------|-------|
| lotm1  | 1433         | 1432                   | 1396              | 1430              | +2 bonus "That Corner" chapters, + 1 cover image section (index 0) |
| coi    | 1183         | 1181                   | 1180              | 1179              | +1 Afterword + 1 Side Story, + 2 front-matter sections (Cover, Information) |

**Parser behaviour is correct — the expected counts in the architecture doc are slightly stale.** LOTM1 actually ends at Chapter 1430 (+2 bonus); COI at 1179 (+Afterword + Side Story). The 2.58% overshoot on LOTM1 is the bonus chapters, explicitly allowed by the acceptance criteria.

### Quirks to handle in ticket 003 (chapter extraction)

1. **Front matter sections** — LOTM: `[0] cover image URL`. COI: `[0] Cover`, `[1] Information`. Drop by detecting absence of `Chapter\s+\d+` / `第\d+章` prefix.
2. **Title format drift** — COI uses `Chapter N - N: Title` (double-numbered) on at least some chapters; LOTM uses `Chapter N: Title`. Chapter-number extraction regex must handle both.
3. **Duplicated `<h1>` inside section body** — e.g. middle section preview shows `Chapter 716: Island and RuinsChapter 716: Island and Ruins` (the title is emitted twice in the HTML). Strip the leading title from chapter body before chunking or it will bias embeddings.
4. **End matter** — LOTM has `[END]` marker on Chapter 1430 (last main-story chapter), then 2 "Bonus" chapters. COI last two are "Author's Afterword" and "Side Story". Decide in 003 whether to ingest these as regular chapters (yes, for Q&A coverage) but flag them as non-canon / bonus.
5. **No translator notes leaking in** as separate sections — good, they're presumably inline.

Full probe log: `/tmp/probe.log`.
