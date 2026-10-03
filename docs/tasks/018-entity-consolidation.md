---
id: 018
title: Entity consolidation — aliases, canonical coverage, type gaps
phase: 5
status: todo
depends_on: [006]
estimate: M
updated: 2026-10-03
---

## Context

The 004 seed (originally 83 canonical entities, grew to 95 during ticket 006 work: 52 character, 21 organization, 22 pathway, 0 artifact, 0 location) was built before ticket 006 NER work exposed several classes of gaps. **Post-006 DB state: 4,912 entities, 129,101 mentions.** Most of the ~4,800 auto-created entities beyond the seed are real minor characters, locations, and artifacts — but include several fragmentation and hygiene issues that this ticket addresses.

### Issues surfaced by ticket 006

1. **Sequence-title alias coverage is uneven.** S9 titles for each pathway are mostly folded in as aliases (Seer→Fool, Sailor→Tyrant, Sleepless→Darkness, etc.), but other distinctive sequence titles that appear in prose are missing — e.g., Author (Visionary S1), Clown (Fool S8), Corpse Collector (Death S9) were added ad-hoc during 006 eval iteration, but the full 22-pathway × 10-sequence grid has not been audited.
2. **Common-word aliases collide.** "Hermit" is both the Hermit Pathway canonical AND Cattleya's Tarot Club title. "Fool" is both the Fool Pathway canonical AND Klein's Mr. Fool persona. "Magician" is Fors Wall's Tarot position AND a Fool Pathway sequence title. The resolver currently lets whichever comes first win the case-insensitive name lookup. Needs a deliberate precedence policy (character Tarot alias vs pathway canonical).
3. **Zero artifact canonical rows.** Every mention of `0-08`, `2-049`, `Sun Brooch`, `Scarlet Lunar Corona`, `Blood-Stained Crown`, `Letters of the Saints`, `The Revelation of Evernight's Book of Wisdom`, etc. creates a new entity row at ingest time. Known fragmentation risk — a single sealed artifact may land under 3+ variant rows ("0-08" / "Sealed Artifact 0-08" / "Artifact 0-08").
4. **Zero location canonical rows.** Same problem for `Backlund`, `Tingen`, `East Balam`, `West Balam`, `Bansy Harbor`, `Rorsted Archipelago`, `Fog Sea`, `Minsk Street`, `Pasu Island`, etc. These are extremely frequent in the corpus.
5. **Modern-day AU aliases are thin.** `CEO Huang`, `Miss Huang`, `Old Ai`, `Officer Deng` were added during 006; other modern-day forms (`Uncle Zhou`, Lumian's alt-world names, etc.) may still fragment.
6. **Inconsistent completeness.** Some character rows have rich alias lists (Klein: 25 aliases). Others are terse (Mr. A: 1, Albus Medici: 1, Zaratul: 2). Review whether sparse rows are correct-by-scope or simply under-seeded.

### New issues surfaced after 006 ingest

7. **Ambiguous canonical-vs-alias collisions** (`scripts/ner-merge-collisions.ts` skipped these during the 006 post-run merge):
   - **"Death"** (784 mentions): seed canonical for Death Pathway AND alias of Salinger. Per seed notes: *"'Death' as a deity name refers to Salinger, not the pathway."* Needs human decision whether to migrate all 784 mentions to Salinger, split chunk-by-chunk, or leave with pathway.
   - **"Black Emperor"** (233 mentions): seed canonical for Black Emperor Pathway AND alias of Roselle Gustav. Narrative usage leans toward Roselle (his Tarot nickname) but pathway references exist.
8. **Near-duplicate characters** created by Haiku picking different forms across chunks:
   - "Saint Anthony" / "Saint Anthony Stevens" / "Saint Anthony Stevenson" — same person, 3 entity rows.
   - "Ava" / "Ava Lizier" — chunk-local vs full-name split.
   - Review via `SELECT ... FROM entities GROUP BY split_part(canonical_name, ' ', 1) HAVING count(*) > 1`.
9. **Chapter-title bleed**: ~20 entities with canonical_names like "The Adventurer 1: First Show of Strength", "The Adventurer 5: Vice Admiral Ailment" — Haiku occasionally extracted from the cached `<document title="...">` chapter header. Low mention counts, harmless but hygienic to clean.
10. **Prompt precision tuning**: the post-006 prompt revision (VERBATIM + LONGEST-MATCH + few-shot examples) scored **higher recall (0.92) but lower precision (0.69)** on the 006 eval gold vs the old prompt that produced the current DB data (0.77 / 0.88). A targeted re-run with the new prompt after this ticket's seed cleanup is an option if 014's eval sweep shows precision gaps.

## Scope

- Audit all 95 current canonical rows for missing aliases, using the 006 NER eval failures and the ingested chapter text as evidence.
- Add canonical rows for:
  - **Artifacts:** all sealed artifacts referenced with a code (`0-08`, `0-08 Spirit Cage`, etc.); named supernatural items recurring across multiple chapters; major scriptures/books.
  - **Locations:** all major cities, nations, and recurring geography. Defer one-off street names unless they appear in 5+ chapters.
- Fold distinctive sequence titles into their parent pathway as aliases (complete the pattern started in 004). Skip ambiguous common-word sequence titles (keep prompt-based disambiguation).
- **Resolve the Death/Salinger and Black Emperor/Roselle ambiguity** (#7 above). For each, either:
  - Migrate the orphaned mentions to the character entity (if narrative-usage audit confirms),
  - Split chunk-by-chunk via a small Haiku call over the 784+233 chunks (cost <$1),
  - Or accept the current pathway attribution and document why.
- **Clean near-duplicate characters** (#8): write a small sql/script merge for obvious duplicates (Saint Anthony variants, Ava/Ava Lizier, etc.) analogous to `scripts/ner-merge-collisions.ts`.
- **Drop chapter-title bleed entries** (#9): `DELETE FROM entities WHERE canonical_name ~ '^[A-Z][a-zA-Z ]+ \d+:' AND id NOT IN (seed ids)` after spot-check.
- Decide the Tarot-Club-vs-pathway alias precedence for overlapping names (Fool, Hermit, Magician, Justice, Star, Moon, Sun, World, Hanged Man). Document the decision in `aliases.json._notes`.
- **Optional: targeted re-run with revised prompt** (#10) if 014's eval sweep shows the current DB's precision floor is limiting retrieval. Use `pnpm ingest --book <X> --phase ner --reset --yes` for clean re-runs — flag already built in 006.
- Re-run `pnpm seed:entities` and `pnpm ner:score` after each batch to measure impact.

## Out of scope

- Spoiler-gating (`is_spoiler`) — still deferred to ticket 017.
- Spell/ability canonical rows (e.g., `Teleportation`, `Love Incantation`) — treat as concepts, not entities, unless later scope changes.
- Schema changes to `entities` or `entity_mentions`.

## Deliverables

- Expanded `data/entities/aliases.json` with artifact + location coverage and completed sequence-title pathway aliases.
- Ad-hoc audit notes in `aliases.json._notes` describing the Tarot-vs-pathway precedence policy.
- NER F1 re-measurement before/after (note in ticket body).

## Acceptance criteria

- All sealed-artifact codes referenced in the 006 NER gold set resolve to a canonical entity (no `raw:N-NN` keys in scorer output).
- All location names in the 006 NER gold set resolve to a canonical entity.
- Every pathway has canonical coverage of its S9 + at least one distinctive non-common-word sequence title (when one exists).
- `pnpm seed:entities` remains idempotent (0 inserted / N updated on second consecutive run).
- Ticket 006 NER eval entity F1 improves by ≥ 0.03 vs. pre-018 baseline, measured on the same gold set and prompt.

## Verification

```bash
pnpm seed:entities
pnpm ner:score --verbose

psql $DATABASE_URL_UNPOOLED -c "
  SELECT entity_type, count(*) FROM entities GROUP BY 1 ORDER BY 1;
"
```

## Findings

<!-- Paste P/R/F1 delta + audit notes after run. -->

## Surfaced during the reopening battery (2026-10-02, recorded 2026-10-03)

Found in PR #2's chat battery q04 ("Who is the Fool?"): the Fool pathway entity lacks "The Fool" as an alias. `data/entities/aliases.json` — Klein's character row carries `The Fool` / `Mr. Fool` (lines 21-22), but the pathway row (`canonical_name: "Fool"`, line 1301) only has `Fool Pathway / Pathway of the Fool / Seer / Seer Pathway / Pathway of the Seer / Clown`. Battery q04 therefore resolved deterministically to Klein via alias with no pathway candidate.

Suggested handling at execution time: add "The Fool" (and decide "Mr. Fool" placement) to the Fool pathway row's aliases — **but** that re-creates issue #2's collision (character Tarot alias vs pathway canonical), so it must land together with the precedence decision (Scope bullet on alias precedence; the 010 route's `{ambiguous, candidates}` resolution is the collision safety net in the meantime). Also verify sibling pathway rows while at it (e.g., does the Visionary row carry "Author"? — pattern matches issue #1's uneven coverage).
