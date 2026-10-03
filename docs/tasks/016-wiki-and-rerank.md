---
id: 016
title: Wiki ingestion + source-priority rerank + cross-encoder rerank
phase: 5
status: todo
depends_on: [014]
estimate: L
updated: 2026-10-02
---

> **Pre-split note (2026-10-02):** `L` — split likely. Three workstreams in one ticket: 016a wiki ingest (scrape + strip + chunk/embed 2,000–5,000 rows), 016b source-priority rerank, 016c cross-encoder rerank (hosting decision needed). Split into 016a/016b/016c at execution time unless all three measurably improve the eval baseline together.

## Context

Three Phase 5 quality upgrades, bundled because each depends on or amplifies the previous:
1. **Wiki ingestion** — LOTM Fandom wiki fills lore gaps the EPUB under-represents (Pathway tables, sealed artifact lists). Tag `source: wiki`, `reliability: secondary`. Makes source-priority meaningful.
2. **Source-priority rerank** — once chunks come from mixed sources, prefer `epub > wiki > forum` on fact overlap. Implement as a post-RRF stable sort, not a filter. No-op until wiki is ingested, which is why it lives here instead of in Phase 2.
3. **Cross-encoder rerank** — after hybrid retrieval returns top-20, re-rank with `bge-reranker-v2-m3` and take top-8. Per Anthropic's numbers: 67% fewer retrieval failures vs 49% from Contextual Retrieval alone.

Ship together only if all three improve the eval baseline measurably; otherwise split.

## Scope

### Wiki ingestion
- Build `scripts/ingest-wiki.ts`:
  - MediaWiki API: `https://lordofthemysteries.fandom.com/api.php?action=query&list=allpages&aplimit=500`.
  - Fetch pages in batches; strip MediaWiki markup via `wikiparser-node` or similar.
  - Chunk each page with the same chunker, tag `meta.source='wiki'`, `meta.reliability='secondary'`.
  - Skip Contextual Retrieval on wiki chunks — wiki structure is already compact.
  - Embed + insert into `chunks` table with `book_id='wiki'` (new synthetic row in `books`).

### Source-priority rerank
- Build `lib/rag/rerank.ts` — `sourcePriorityRerank(chunks: RetrievedChunk[])`: stable sort by `(epub > wiki > forum)` with score tiebreak.
- Wire into `hybridSearch` return path behind a feature flag (`RAG_SOURCE_RERANK=1`).
- Unit-test: given `[{source:'wiki',score:0.9},{source:'epub',score:0.7}]`, output is `[epub, wiki]`.

### Cross-encoder rerank
- Host `bge-reranker-v2-m3` via a Vercel Function with a Bun runtime (no GPU needed at this scale; CPU is fine for ~100 qps ceiling).
- Alternative: use Cohere Rerank 3 API ($0.002/1k docs).
- Integrate into `hybridSearch` behind flag `RAG_CROSS_RERANK=1`: retrieve top-20, rerank, return top-8.

### Re-run eval
- Compare recall@8 across three states: pre-wiki baseline, +wiki+source-priority, +wiki+source-priority+cross-encoder. Record in `eval_runs`.

## Out of scope

- Forum ingestion (deferred further — low priority per Notion doc).
- Dedupe between wiki and EPUB chunks.

## Deliverables

- `scripts/ingest-wiki.ts`.
- `lib/rag/rerank.ts`.
- Cross-encoder integration (Cohere or self-hosted — pick based on cost at evaluation time).
- A/B/C eval results in `## Findings`.

## Acceptance criteria

- Wiki ingest produces 2000–5000 `chunks` rows tagged `meta.source='wiki'`.
- A/B eval shows recall@8 improved on **lore** and **pathway** query types specifically after wiki + source-priority.
- Source-priority rerank actually changes result order in at least 3/40 eval queries (otherwise the rerank is effectively inert).
- Cross-encoder A/B shows recall@8 improvement on **dialogue** and **quote-specific** queries specifically (where word-order fidelity matters).

## Verification

```bash
pnpm tsx scripts/ingest-wiki.ts
pnpm eval                                       # post-wiki baseline
RAG_SOURCE_RERANK=1 pnpm eval                   # +source-priority
RAG_SOURCE_RERANK=1 RAG_CROSS_RERANK=1 pnpm eval # +cross-encoder
```

## Findings

<!-- Paste A/B/C comparison here. -->
