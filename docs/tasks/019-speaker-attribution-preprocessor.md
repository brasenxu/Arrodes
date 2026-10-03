---
id: 019
title: Speaker attribution preprocessor
phase: 1
status: todo
depends_on: [006]
estimate: M
updated: 2026-05-05
---

## Context

Ticket 006 shipped NER at entity F1 = 0.82 (P=0.88, R=0.77, role accuracy = 0.85). Current scorer snapshot (2026-05-05) reports entity F1 = **0.795** (P=0.690, R=0.936; role accuracy = 0.932), speaker F1 = **0.89** (P=0.93, R=0.86), and addressee F1 = **0.31** (P=0.40, R=0.25). Addressee remains the weakest role — chronic LLM role-attribution weakness. The attribution pass exhibits a well-documented role-commitment bias: it hedges toward `mentioned` because it's the majority label and is never strictly wrong. The failure mode shows up clearly in the scorer — `mentioned` has inflated false positives (entities that should have been `speaker`/`addressee`), while `speaker`/`addressee` suffer low recall.

**Current baseline for this ticket branch**: speaker F1 = 0.89, addressee F1 = 0.31 against the 26-chunk `data/eval/ner-gold.jsonl` from `pnpm ner:score` (2026-05-05 run).

The corpus is clean, consistent LOTM prose with regular dialogue conventions. Dialogue attribution in this style is highly regular:
- `"Quote," X said.`
- `"Quote," said X.`
- `X said, "Quote."`
- `"Quote," X whispered / replied / asked / muttered / chuckled / exclaimed / hissed.`

Research-quality dialogue-attribution systems (BookNLP, Muzny et al. 2017, Elson & McKeown 2010) achieve ~80–90% speaker accuracy using rule-based preprocessors on fiction. A deterministic preprocessor for this corpus should beat LLM-only attribution on speaker F1 significantly.

Current implementation note: despite legacy `Haiku` naming in some symbols/comments, `scripts/ner-score.ts` currently routes model calls through DeepSeek (`https://api.deepseek.com/v1`) using `INGEST_CONTEXT_MODEL`.

## Scope

- **Cost driver (2026-10-02 note):** this ticket's mandatory re-ingest is a **full-corpus NER re-run for both books** (`--phase ner --reset --yes` × 2; 16,398 chunks; paid API time measured in hours). Plan the re-run window and budget for it; the original 006 runs cost ~$63 before the DeepSeek migration.

- Build a preprocessor that, per chunk:
  - Extracts quoted-speech spans (U+201C/U+201D, ASCII `"`).
  - For each quoted span, searches a narrow window (≤60 chars before/after) for a speech verb (said, replied, asked, muttered, whispered, chuckled, exclaimed, sighed, snapped, continued, added, began, remarked, observed, noted, stated, declared, …) paired with a named entity.
  - Resolves the named entity through the existing alias index.
  - Emits a `{ quotedSpan → { entityId, role: "speaker" } }` map per chunk.
- Update `extractChunkMentions` in `lib/ingest/ner.ts`:
  - Run preprocessor first.
  - Pre-populate `speaker` mentions from the deterministic pass.
  - Feed the pre-computed speaker list to the LLM attribution pass as a hint in the prompt (so it doesn't re-attribute).
  - Have the LLM attribution pass handle only `addressee` attribution and `mentioned` entities not yet captured.
- Update `scripts/ner-score.ts` to measure per-role F1 improvement against `ner-gold.jsonl`.
- Re-ingest `entity_mentions` for both books after preprocessor is verified — use `pnpm ingest --book <X> --phase ner --reset --yes` (flag added in 006) since role info is changing.

## Out of scope

- Coreference resolution across chunks (e.g., "he" → Klein when Klein spoke two chunks ago). Defer indefinitely.
- Multi-speaker quoted spans (crowds, choruses). Rare in LOTM prose.
- Fine-tuning a dedicated role classifier.
- Gold-set auditing/relabeling and eval-set expansion; tracked separately in ticket 025.

## Deliverables

- `lib/ingest/speaker-attribution.ts` with the preprocessor + speech-verb vocabulary.
- Integration into `lib/ingest/ner.ts`.
- Expanded `scripts/ner-score.ts` output showing preprocessor-only F1 AND preprocessor+LLM F1 separately, so you can tell which layer is doing the work.
- Re-ingested `entity_mentions` table.

## Acceptance criteria

- Speaker F1 on `ner-gold.jsonl` remains **≥ 0.85** and does not regress by > 0.01 from the current baseline (`0.89`).
- Addressee F1 improves to **≥ 0.40** from the current baseline (`0.31`); vocatives and "said to X" patterns are the primary deterministic win target.
- Overall entity F1 does not regress by > 0.01 from the current baseline (`0.795`).
- Preprocessor runs in < 50ms per chunk on commodity hardware — it's pure text operations.
- Re-ingest via `pnpm ingest --book <X> --phase ner --reset --yes` (flag added in 006) completes without changing any chunk/embedding row.

## Verification

```bash
pnpm ner:score                              # establish post-preprocessor baseline
pnpm ingest --book lotm1 --phase ner --yes  # re-run ingest
pnpm ingest --book coi --phase ner --yes

psql $DATABASE_URL_UNPOOLED -c "
  SELECT role, count(*) FROM entity_mentions GROUP BY role ORDER BY 2 DESC;
"
```

## Findings

<!-- Paste before/after F1 and role-breakdown after run. -->
