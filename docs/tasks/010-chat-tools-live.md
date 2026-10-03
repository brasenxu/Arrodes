---
id: 010
title: Chat route — live tool wiring
phase: 2
status: done
depends_on: [005, 006, 007, 009]
estimate: M
updated: 2026-10-02
---

## Context

`app/api/chat/route.ts` and `lib/rag/tools.ts` are scaffolded. This ticket exercises them end-to-end with real data, tunes the system prompt, and validates the three tools produce useful outputs for the assistant.

## Required pre-work from ticket 007 (shipped 2026-04-24)

## Remaining checklist (2026-10-02 audit — everything left before this ticket closes)

1. **Enum fix** (audit defect 1, HIGH): `aggregateEvents` eventType at `lib/rag/tools.ts:89-98` — drop `location_change`, source the enum from `EVENT_TYPES` (`lib/rag/types.ts:31-40`) via `lib/rag/schemas.ts`; currently 4 of 8 ingested event types fail zod validation and `location_change` silently returns 0 rows.
2. **Ambiguity guard** (defect 2, HIGH): `lookupEntity`/`aggregateEvents` resolve entities first-row-wins with no ORDER BY — "Fool" collides (pathway entity vs Klein aliases). Deterministic ordering + `{ambiguous: true, candidates: [...]}`.
3. **Position/body validation** (defects 3-4): validate `body.position` shape, clamp to arc-map bounds, 400 on malformed JSON, strip client `system`-role messages.
4. **Bounded aggregateEvents** (defect 5): ORDER BY + `.limit(200)` + `truncated` flag.
5. **Embed resolution + `.env.example` truthing** (defect 6): normalize bare/gateway model IDs in `lib/rag/tools.ts`; document that `AI_GATEWAY_API_KEY` is required by the chat route.
6. **Types cleanup** (defects 8-9): delete/reshape `EventExtra` (zero importers, wrong shape); trim `RetrievedChunk.source` to `"epub"`; drop the wiki/forum line from SYSTEM_PROMPT.
7. **Error surfacing**: friendly UI error on provider 429 / tool failure (minimal in Task 12; full UX in 029).
8. **10-question battery** (below) → transcript in `## Findings`, close 010, backfill 020.

---

The `aggregateEvents` tool's `eventType` enum (`lib/rag/tools.ts:89`) needs reshaping to match what 007 actually writes to the `events` table:

- **Drop:** `location_change` (no longer extracted)
- **Add:** `digestion`, `organization_join`, `battle`, `identity_assume`

Final enum: `sequence_advance, digestion, meeting, organization_join, battle, death, identity_assume, identity_reveal, any` (9 values including `any`).

Update the tool's `description` string to match the new vocabulary, and consider surfacing selected `extra` fields when rendering tool output — `events.extra` is now a structured `EventExtra` discriminated union defined in `lib/rag/types.ts`:
- `meeting.extra.attendees` is `number[]` (entity IDs) — join back to `entities` if the UI wants names
- `identity_assume.extra.identity` + `identity_reveal.extra.identity` are strings
- `sequence_advance.extra.sequence` + `digestion.extra.sequence` are ints 0-9

The 4,230-row events corpus has known noise in `identity_assume` for Klein (multiple rows for "Klein", "Klein Moretti", "The Fool", "The World" — canonically defensible but noisy for aggregation). Consider UI-side dedup or filtering.

## Scope

- End-to-end test: from `pnpm dev`, ask ~10 questions covering all query types — watch network panel for tool calls.
- Iterate on the system prompt in `route.ts`:
  - Make sure the assistant calls `aggregateEvents` first for "list / all / every" queries.
  - Make sure it calls `lookupEntity` for named-entity questions before falling back to `searchBook`.
  - Citations format: `(Book Ch.N)` inline after every factual claim.
- Fix edge cases in tool executors:
  - `lookupEntity` with a name that has no match should return `{entity: null, mentions: []}` — verify it doesn't throw.
  - `lookupEntity` for ambiguous strings ("Death", "Black Emperor", "Fool", "Hermit") where the name matches both a pathway canonical and a character alias: decide precedence. Ticket 018 will finalize the policy in the seed; in the meantime, verify the tool doesn't silently return the wrong entity type. Consider returning `{ambiguous: true, candidates: [...]}` if the name resolves to > 1 entity via case-insensitive match across canonical and alias columns.
  - `aggregateEvents` with `eventType="any"` should return all types — verify join + order.
  - `hybridSearch` when one book's position is null should still return results from the other book — verify the `bookCeilings.length === 0` branch never triggers when at least one book is read.
- Rate-limit guard: if the chat provider rejects with 429, surface a clean error to the UI.

## Out of scope

- Spoiler UI (ticket 012).
- Citation rendering refinements (ticket 013).
- Prompt caching on system + glossary (ticket 011).

## Deliverables

- Tuned `SYSTEM_PROMPT` in `route.ts`.
- Any bugfixes in `lib/rag/tools.ts` and `lib/rag/retrieval.ts` surfaced during testing.
- A short test-session transcript in `## Findings` showing each tool getting called.

## Acceptance criteria

- Every tool gets exercised in at least one session (grep for `tool-searchBook`, `tool-lookupEntity`, `tool-aggregateEvents` in the UI parts).
- Assistant responses contain inline `(Book Ch.N)` citations on every factual claim in test sessions.
- No uncaught exceptions in the server console during a 10-question test run.

## Verification

```bash
pnpm dev
# visit http://localhost:3000 and run the 10-question battery
```

## Findings

<!-- Paste test transcript + any bugs found and fixed. -->

### Battery transcript (2026-10-02, plan Task 13 — programmatic, `scripts/parse-battery.mjs`)

Setup: `pnpm dev` on Node v24.21.0; chat model `gemini-2.5-flash` via **direct** google provider (`@ai-sdk/google@^3`), embeds via direct OpenAI — gateway key absent (see Ruling in the plan ledger).

| # | Question | Tools fired | Citations | Verdict |
|---|---|---|---|---|
| q01 | "What happens in chapter 245?" | searchBook | — | Honest refusal: chapter-targeted question missed by semantic top-8 — **the ticket 026 gap** (chapter summaries), not a bug. |
| q02 | Seer pathway abilities | searchBook | (LOTM1 Ch.65/237/96/1164/463) | Grounded, cited. |
| q03 | Who is Audrey? | lookupEntity | (LOTM1 Ch.5) | Entity + pathway, cited. |
| q04 | Who is the Fool? | lookupEntity | (LOTM1 Ch.1) | Deterministic single-match resolution (Klein via alias). |
| q05 | Tarot Club meetings < ch500 | aggregateEvents, searchBook | (LOTM1 Ch. 7/390/483/489) | Correct list; **emits `(LOTM1 Ch. 7)` with a space** — 013's parser must tolerate optional space (ledger ruling). |
| q06 | Klein battles < ch200 | aggregateEvents | 10+ battle citations | New enum values (`battle` etc.) queryable — the enum fix works live. |
| q07 | "I don't want to be a hero" quote | searchBook ×6 | — | First run burned all 6 steps on searches, never answered (0 text). Fixed: prompt "max 3 tools, don't repeat empty searches" + `stepCountIs(8)`. Re-run: honest "couldn't find" — correct grounded behavior. |
| q08 | In Modern Day ch.1405 | — | — | Refusal past default position (side stories gated) ✓ |
| q09 | Seer question, position both null | lookupEntity, searchBook | — | Tools correctly return empty; graceful "unable to find" ✓ |
| q10 | Audrey, `{lotm1:100, coi:null}` | lookupEntity | (LOTM1 Ch.5) | One-book-null flows results from the read book ✓ |
| q11 | position `{999999,999999}` | searchBook | (LOTM1 Ch. 65/96/237/463) | Accepted + clamped to FULL_BOUNDS ✓ |
| e1 | malformed JSON body | — | — | 400 ✓ |
| e2 | messages not an array | — | — | 400 ✓ |
| e3 | position `{lotm1:999999}` (partial) | — | — | 400 (strict shape) ✓ |
| e4 | all-system-role messages | — | — | 400 after system-role strip ✓ |

Fixes made during the battery (prompt tuning only, per 010 scope):
- SYSTEM_PROMPT: citation rule strengthened (incl. entity/event claims); tool-budget rule added ("max 3 tools; don't repeat empty searches").
- `stopWhen: stepCountIs(6)` → `stepCountIs(8)`.
- Route: all-system-message requests → 400 (was a mid-stream error event).

Known gaps carried forward: chapter-summary routing (→ 026); citation format drift tolerance (→ 013, parser side); aggregateEvents meetings for THE organization entity (Tarot Club as org) may need 018's consolidation.
