---

## id: 004
title: Entity alias seed data
phase: 1
status: done
depends_on: []
estimate: M
updated: 2026-04-22

## Context

LOTM's adversarial naming (Klein / Zhou Mingrui / Gehrman Sparrow / Sherlock Moriarty / Dwayne Dantes / Benson Moretti) will fragment into separate entities under naive LLM NER. A curated alias table solves this cheaply: during NER we prefer matches against the seed before creating new entities. Per the DAB's open questions #6, seed ~30 canonical entries; let NER discover the long tail.

## Scope

- Build `data/entities/aliases.json` with ~30 seed entities covering:
  - **Tarot Club members:** Klein (Fool), Audrey Hall (Justice), Alger Wilson (Hanged Man), Leonard Mitchell, Fors Wall (Magician), Derrick Berg (Sun), Emlyn White (Moon)
  - **Nighthawks:** Dunn Smith, Old Neil, Rozanne, Leonard Mitchell
  - **Antagonists:** Amon, Adam, Medici, Mr. A (resolve aliases)
  - **Roselle:** Emperor Roselle Gustav / Zhou Mingrui-era figure
  - **Organizations:** Nighthawks, Machinery Hivemind, Tarot Club, Church of the Fool, Aurora Order, Secrets Supplicant
  - **Pathways:** Fool, Seer, Sun, Tyrant, Red Priest, Hanged Man, Hermit, Sailor, Spectator, Apprentice, Visionary, Error
- Schema: `{ canonical_name, entity_type, aliases: string[], is_spoiler: 0|1, meta?: {...} }`.
- **Set `is_spoiler: 0` for every seed entry.** Entity-level reveal gating is deferred (see ticket 017). The existing chunk-level reading-position filter (pre-filter in `hybridSearch`) is the only spoiler mechanism for now — if a reveal chunk is past the user's position, it simply isn't retrieved.
- Write `scripts/seed-entities.ts` — reads the JSON, upserts into `entities` (idempotent by `canonical_name`).

## Out of scope

- NER runtime (ticket 006).
- Full alias coverage — seed is a starting set; NER fills in the rest.

## Deliverables

- `data/entities/aliases.json`.
- `scripts/seed-entities.ts`.
- npm script: `"seed:entities": "tsx scripts/seed-entities.ts"`.

## Acceptance criteria

- `pnpm seed:entities` inserts ~30 rows (idempotent on re-run).
- All rows have `is_spoiler=0` (entity-level gating deferred to ticket 017).
- Alias lookup works: `SELECT canonical_name FROM entities WHERE 'Sherlock Moriarty' = ANY(SELECT jsonb_array_elements_text(aliases));` returns `Klein Moretti`.

## Verification

```bash
pnpm seed:entities
psql $DATABASE_URL_UNPOOLED -c "SELECT canonical_name, entity_type, jsonb_array_length(aliases) FROM entities ORDER BY entity_type, canonical_name;"
```

## Resolution

**Files created:**
- `data/entities/aliases.json` (**57 entries**: 28 characters, 7 organizations, 22 pathways)
- `scripts/seed-entities.ts` (zod-validated idempotent upsert via `ON CONFLICT DO UPDATE … RETURNING (xmax = 0)`)
- `package.json` — added `seed:entities` script

**Went beyond ticket spec (user directed scope expansion):**

- **Covered both LOTM1 and COI.** Ticket listed only LOTM1 entities; retrieval spans both books, so COI cast is seeded to prevent the same NER fragmentation the seed is meant to solve for LOTM1.
- **All 22 canonical pathways seeded** (ticket listed 12). Pathway count is a closed set — trivial to exhaustively enumerate.
- **Tarot Club Major Arcana: 11 of ~13 active positions** seeded (Fool, Magician, Hanged Man, Justice, Sun, Moon, Star, Hermit/Cattleya, Judgement/Xio Derecha, Chariot/Lumian, Empress/Franca). Plus the believed-but-unofficial "Death" position (Azik Eggers). Minor Arcana coverage intentionally thin — NER discovers the long tail.

**Corrections to ticket's own content (via fandom wiki + user review):**

1. **Surnames:** Ryan is `Vitia` (not Mabis), Franca is `Roland` (not Soest), Lumian is `Lee` (not Lund).
2. **Roselle Gustav** is on the **Black Emperor** pathway, not Sun. Modern-day identity `Huang Tao` is distinct from Zhou Mingrui.
3. **"Secrets Supplicant"** in the ticket's org list was wrong — it's an alternate name for the **Hanged Man Pathway** (aka Secrets Suppliant). Moved into Hanged Man pathway aliases. Replaced in the org list with `Rose School of Thought` (COI) + `Church of the Evernight Goddess` (parent of Nighthawks).
4. **Mr. A ≠ Amon.** Ticket implied they were aliases. Mr. A is a distinct Sequence 5 Beyonder on the Hanged Man Pathway, one of the 22 Aurora Order Oracles. Separate entity.
5. **Albus Medici ≠ Medici.** Albus is a descendant (Red Priest Sequence 5, Iron & Blood Cross Order); the original Medici is the War Angel (Red Priest Sequence 1). Separate entity — this is exactly the adversarial-naming case the seed is meant to pre-disambiguate.
5b. **Azik ≠ Death.** Azik Eggers is Salinger's son; he is NOT Death. Salinger is SEQ0 of Death Pathway (also SEQ0 Red Priest secondary), founder of Balam Empire, deceased in the Pale Era. Added Salinger as its own character entity; `Death` as an alias resolves to Salinger. Azik's valid titles are `Mr. Azik`, `Death Consul` (SEQ2 tier), `Baron Lamud` (former mortal identity), `Angel of Death` (role under Church of the Fool).
6. **Pathway naming convention — Sequence 9 tier names folded into parent pathway as aliases:**
   - `Seer` → `Fool` (Seer = SEQ9 of Fool)
   - `Sailor` → `Tyrant` (Sailor = SEQ9 of Tyrant)
   - `Spectator` → `Visionary` (Spectator = SEQ9 of Visionary)
   - `Apprentice` → `Door` (Apprentice = SEQ9 of Door)
   - `Mystery Pryer` → `Hermit` (Mystery Pryer = SEQ9 of Hermit)
   - `Prisoner` → `Chained` (Prisoner = SEQ9 of Chained)
   - `Sleepless` → `Darkness` (Sleepless = SEQ9 of Darkness)
   - Hermit and Visionary are **distinct pathways** (despite Adam's title "Visionary" and his founding the Twilight Hermit Order — user-verified during review).

**Verification output:**
- `pnpm typecheck` — exit 0.
- `pnpm seed:entities` first run (after intermediate updates): 21 inserted / 35 updated. Subsequent run: 0 inserted / 56 updated (idempotent confirmed).
- All 56 rows have `is_spoiler = 0` (entity-level gating deferred to ticket 017).
- `SELECT canonical_name FROM entities WHERE 'Sherlock Moriarty' = ANY(...)` → `Klein Moretti`.
- Bonus resolutions: `Mr. A` → `Mr. A` (not Amon); `Spectator` → `Visionary`; `Sailor` → `Tyrant`; `Apprentice` → `Door`.

**Known side-issue (not fixed here):**

`scripts/seed-entities.ts` explicitly loads `.env.local` via `dotenv.config({ path: '.env.local' })` rather than relying on `import "dotenv/config"` (which only loads `.env`). `scripts/ingest.ts` has the same `dotenv/config` pattern and will fail with `DATABASE_URL is not set` until changed. Flag for ticket 005 (ingest) — trivial one-liner fix when that ticket fires.

