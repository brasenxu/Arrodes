---
id: 026
title: Summary retrieval tool (lookupSummary)
phase: 2
status: done
depends_on: [008, 010]
estimate: M
updated: 2026-10-02
---

## Context

The `summaries` table is fully populated (2,613 chapter + 71 arc + 16 volume + 2 series rows) but no retrieval path reads it — the 2026-10-02 audit's biggest unplanned gap (finding 15). The architecture doc's core promise — "summarize chapter 245" and "what is the Red Priest arc about" answered from pre-computed summaries, not live generation — has no owning ticket. 008 explicitly scoped wiring out; this ticket picks it up.

## Scope

- `lookupSummary` tool as the 4th tool in `buildTools(position)` (`lib/rag/tools.ts`).
- Input: `{ book: "lotm1" | "coi", scope: "chapter" | "arc" | "volume" | "series", chapterNum?, name? }` — `chapter` scope requires `chapterNum`; the other three require `name`. Input schemas live in `lib/rag/schemas.ts` (pure, testable without DB imports).
- Position gating: only rows with `rangeEnd <= position[book]`; null position → `{summaries: []}`. `chapter` scope returns the chapter row plus its parent `arc` row.
- Deterministic ordering + `.limit(5)` on name lookups (same policy as entity tools).
- SYSTEM_PROMPT routing rule: "summarize chapter N" and arc/volume/series overview questions → `lookupSummary` first; fall back to `searchBook` only when no summary matches.

## Out of scope

- Embedding-based summary search (label + scope matching suffices for now).
- Generating new summaries or re-running the summaries phase.

## Deliverables

- `lookupSummary` in `lib/rag/tools.ts`; input schemas + tests in `lib/rag/schemas.ts`/`schemas.test.ts`.
- SYSTEM_PROMPT routing rule in `app/api/chat/route.ts`.
- Battery coverage for `chapter_summary` / `lore` query types.

## Acceptance criteria

- "What happens in chapter 245?" routes to `lookupSummary` and answers from the pre-computed summary, cited.
- "What is the Red Priest arc about?" returns the arc summary.
- A chapter or arc past the user's position → clean refusal, no spoiler.
- `pnpm test` + `pnpm typecheck` pass.

## Verification

```bash
pnpm test lib/rag/schemas.test.ts
pnpm dev  # battery additions: chapter summary, arc overview, past-position refusal
```

## Resolution

- `lookupSummary` added as the 4th tool in `buildTools(position)`; input schemas (`SUMMARY_LOOKUP_SCHEMA`) + spoiler gate (`withinPosition`) in `lib/rag/schemas.ts` with tests (27 pass). Embedding column never selected.
- SYSTEM_PROMPT routing rule added: chapter recaps and arc/volume/series overviews route to `lookupSummary` before `searchBook`.
- Battery (2026-10-02): "What happens in chapter 245?" → chapter + parent-arc summary, cited `(LOTM1 Ch.245)`; "What is the Red Priest arc about?" → volume-5 summary (fuzzy label match "Red Priest" → "Volume 5: Red Priest", all 3 arcs cited with ranges); "chapter 1500" → clean refusal past FULL_BOUNDS, no leak.
- Series summaries cover main story only (range_end 1394) — side stories have no series-level row; noted, acceptable.
