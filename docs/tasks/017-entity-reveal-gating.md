---
id: 017
title: Entity-level reveal gating
phase: backlog
status: deferred
depends_on: [004, 006, 012]
estimate: M
updated: 2026-04-21
---

## Context

Chunk-level reading-position filtering (pre-filter in `hybridSearch`) handles most spoiler cases: a reader at LOTM1 ch 300 cannot retrieve a chunk from ch 800. But it doesn't handle identity reveals that rely on alias resolution. Example: a reader at ch 200 asks "who is Sherlock Moriarty?" — the chunks from ch 200+ are blocked, but the `lookupEntity` tool would still resolve "Sherlock Moriarty" → canonical "Klein Moretti" via the alias table and leak the reveal.

**Deferred** because the current user (project owner) has read both books and doesn't need this. Ship if/when the app is shared publicly.

**Post-006 note**: the entity pool is ~4,900 canonical rows (not 200–500 as originally planned — see ticket 006 Resolution). Most are auto-created minor entities with no need for reveal gating. The Option B schema (child table `entity_aliases`) is clearly the right call at this scale — JSON-column per-alias reveal metadata would be painful to query with thousands of rows. Also: some aliases were added during 006 iteration (bare first names, tier titles, etc.) that should be marked as pre-reveal (ch 1) rather than gated — review the full alias list, not just the original 83 seeded.

## Scope

### Schema change
- Add columns to `entities`:
  - `reveal_chapter int` (nullable) — chapter at which the canonical name or identity is revealed.
  - `reveal_book text` (nullable) — `'lotm1'` or `'coi'`; which book the reveal happens in.
- Add columns to individual aliases — reveal may happen per-alias, not per-entity. Either:
  - **Option A:** restructure `entities.aliases` from `string[]` to `{alias: string, reveal_chapter?: int, reveal_book?: string}[]`.
  - **Option B:** add an `entity_aliases` child table with `(entity_id, alias, reveal_chapter, reveal_book)` and drop the JSON column.
  - Recommend B — cleaner for querying, and the JSON shape is already small.

### Seed data
- Extend the alias seed JSON (004) with `reveal_chapter` / `reveal_book` per alias. Start with the known identity swaps:
  - Sherlock Moriarty → Klein Moretti (reveal chapter TBD — verify against EPUB)
  - Gehrman Sparrow → Klein Moretti
  - Dwayne Dantes → Klein Moretti
  - Zhou Mingrui → Klein Moretti (ch 1 reveal to the reader, but treat as fully-read-only — it's the framing device)
  - Amon / Adam (if distinct identities)

### Runtime filter
- Update `lookupEntity` tool in `lib/rag/tools.ts`: when resolving an alias, skip aliases whose `reveal_chapter > position[reveal_book]`. If all matching aliases are post-reveal, return `{entity: null}` — pretend the name doesn't resolve.
- Add a "spoiler-safe" mode toggle to the system prompt so the assistant knows not to volunteer unlinked information about gated entities.

### UI affordance
- Add a "spoil me" button to the reading-position modal (ticket 012) — sets an in-session flag that bypasses entity gating without changing the chapter ceiling. Useful for "I've read this book before and I'm re-reading, don't hide identities from me."

## Out of scope

- Spoiler masking inside retrieved chunk content itself (e.g., redacting "Sherlock Moriarty" occurrences from the prose shown to the user). Chunk-level pre-filter already handles the case where the chunk itself is past the ceiling.
- Reveal timing for side characters (only gate primary identity swaps + canonical-reveal pathway sequences).

## Deliverables (when un-deferred)

- Drizzle migration for schema change (option B preferred).
- Updated seed JSON + `seed-entities.ts` to handle per-alias reveals.
- Updated `lookupEntity` tool implementation.
- Updated reading-position UI with "spoil me" toggle.
- Eval entries Q013 and Q035 (identity list queries) run successfully with `reading_position: { lotm1: 300, coi: null }` and correctly hide post-ch-300 aliases.

## Acceptance criteria

- When user position is ch 200: `lookupEntity({ name: "Sherlock Moriarty" })` returns `{entity: null}`.
- When user position is ch 1000: same call returns `{entity: Klein Moretti, ...}`.
- Spoil-me toggle: bypasses the gate without changing chapter ceiling.

## Why deferred

- Personal use only right now; the project owner has read both books.
- Schema change touches core `entities` shape — cheaper to defer until we've confirmed the alias data model works at all (ticket 006 will stress-test it).
- Chunk-level filter already handles 80% of spoiler cases.
