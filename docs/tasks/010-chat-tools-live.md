---
id: 010
title: Chat route — live tool wiring
phase: 2
status: todo
depends_on: [005, 006, 007, 009]
estimate: M
updated: 2026-04-21
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
