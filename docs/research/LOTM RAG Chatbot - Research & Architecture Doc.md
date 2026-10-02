# LOTM RAG Chatbot — Research & Architecture Doc

# Overview

A Retrieval-Augmented Generation (RAG) chatbot that answers precise chapter-level and lore-level questions about *Lord of the Mysteries* (LOTM) and *Circle of Inevitability* (COI), with citations back to the source text. The core problem: LLMs have fuzzy, secondhand knowledge of long fiction — unreliable for questions like "summarize chapter 245" or "list all Tarot Club meetings." This system grounds answers in the canonical English translation.

> **Doc status:** Revised 2026-04-20. Original draft's model/stack recommendations were stale; this version reflects current reality.
> 

---

# Problem Statement

LLMs fail on long fiction for compounding reasons:

- **Length.** LOTM1 + COI together are ~2,575 chapters, ~10M tokens — far beyond any context window in practical use.
- **Secondhand knowledge.** LLMs train on wiki articles, Reddit, fan summaries — all noisy, speculative, spoiler-conflated.
- **No chapter-level indexing.** "What happens in chapter 245" becomes a guess.
- **Webnovel underrepresentation.** Smaller wiki footprints than mainstream fiction.
- **Translation inconsistency.** Generally a problem for CN/KR webnovels; **not an issue here** — CKTalon's translation is the single canonical English version.

---

# Source Material

## Primary Source — EPUB

### LOTM Vol 1 (Klein Moretti)

- **1,394 main chapters + 2 bonus = 1,396.** Serialized on Qidian April 2018 – May 2020.
- 8 narrative arcs (volumes):

| # | Arc | Chapters |
| --- | --- | --- |
| 1 | Clown | 1–213 |
| 2 | Faceless | 214–482 |
| 3 | Traveler | 483–732 |
| 4 | Undying | 733–946 |
| 5 | Red Priest | 947–1150 |
| 6 | Lightseeker | 1151–1266 |
| 7 | The Hanged Man | 1267–1353 |
| 8 | Fool | 1354–1394 |

### LOTM Vol 2 / Circle of Inevitability (Lumian Lee)

- **1,179 main chapters + 1 afterword.** **Fully complete** — Chinese serialization finished January 16, 2025; CKTalon's English translation finished approximately March 2025.
- 8 arcs; different protagonist (Lumian Lee), set in southern Feysac / Intisian Empire.
- Known arcs include: Nightmare (1–109), Lightseeker (110–263), Conspirer, Sinner, Demoness, Dream Weaver (885–1034), Second Law, Eternal Aeon.

### EPUB availability

Complete 8-volume EPUB set of LOTM1 is on the Internet Archive. COI is complete on Webnovel and freely-available fan EPUBs exist. Single canonical translation = no deduplication headaches.

### Parsing

EPUB HTML preserves chapter boundaries as `<h1>`/`<h2>` tags. Use a **TypeScript EPUB parser** (`@gxl/epub-parser` or `epubts`) — no Python needed. Both return structured TOC + HTML sections.

## Secondary Source — LOTM Fandom Wiki

- URL: [https://lordofthemysteries.fandom.com/wiki/](https://lordofthemysteries.fandom.com/wiki/)
- Coverage: Characters, Pathways (Beyonder sequences), Sealed Artifacts, Organizations, Timeline, Terminology.
- Strengths: cross-referenced synthesis. Weaknesses: errors; mixes LOTM1 and COI spoilers; not always chapter-cited.
- Scraping: MediaWiki API (`api.php`) or MediaWiki XML dumps.
- Tag chunks with `source: wiki`, `reliability: secondary`.

## Tertiary Source — Forums

- r/LordofTheMysteries, NovelUpdates forums.
- Lowest priority; only for what EPUB + wiki can't answer.
- Tag `source: forum`, `reliability: tertiary`, filter by upvotes.

## Source Priority

```
EPUB (primary) > Fandom Wiki (secondary) > Forum (tertiary)
```

Always prefer and cite EPUB chunks over wiki over forum when multiple sources cover the same fact.

---

# Architecture (Revised)

**Original draft proposed:** Python FastAPI on Railway + spaCy + Supabase + separate Next.js frontend on Vercel. Two services, two languages, two cold-start profiles. Over-engineered.

**Revised:** single Next.js 16 app on Vercel + Vercel AI SDK v6 + Neon Postgres (pgvector). One deploy, one language, streaming out of the box.

```
                       ONE-SHOT (local)
book.epub ─→ scripts/ingest.ts
             │ @gxl/epub-parser → {chapter, text}
             │ Contextual Retrieval (Haiku 4.5 + prompt cache)
             │ chunk (400-600 tok, chapter-aware, 100 overlap)
             │ entity + event extraction (LLM-based, curated alias table)
             │ hierarchical summaries (chapter → arc → volume)
             │ embedMany() via AI Gateway
             ▼
        Neon Postgres
        ├─ chunks(chapter, content, embedding vector, tsv tsvector)
        ├─ entities(name, alias, chapter, chunk_id, role)
        ├─ events(character, event_type, chapter, evidence_chunk_id)
        └─ summaries(level, range, text, embedding)
                   ▲
                   │ hybrid SQL (RRF: dense ⊕ tsvector)
                   │
             RUNTIME (Vercel Fluid Compute)
user ─→ useChat ─→ /api/chat route
            │         streamText({
            │           model: 'anthropic/claude-sonnet-4-6',
            │           system: [instructions, glossary+cache_control],
            │           tools: { searchBook, lookupEntity, aggregateEvents }
            │         })
            ▼
      streamed tokens + tool-results rendered by useChat
```

## Why this stack

1. **No Python service.** TS EPUB parsers handle chapter structure. AI SDK v6 handles LLM + embeddings + streaming. spaCy is overkill for a novel — LLM-based NER with a curated alias table does better on LOTM's adversarial naming (Klein / Zhou Mingrui / Gehrman Sparrow / Sherlock Moriarty).
2. **One deploy.** `useChat` + `streamText` + tool-call RAG (official AI SDK cookbook pattern) replaces a bespoke SSE proxy.
3. **Neon over Supabase.** Auto-provisioned env vars via Vercel Marketplace; no 7-day auto-pause penalty; same pgvector feature set; branching for schema changes.
4. **Vercel AI Gateway** gives one-line provider swaps (Anthropic/Google/Groq/OpenRouter) with zero markup PAYG and BYOK.

## Storage math

~25,000 chunks (LOTM1 + COI) × 1,536-dim embedding × 4 bytes = **~150 MB raw vectors**. With HNSW index + text + tsvector + entity tables: **~400–500 MB**. Fits Neon's 0.5 GB free tier with headroom. `halfvec` (2 bytes/dim) halves vector storage if tight.

---

# Chunking Strategy

**Hierarchical hybrid:**

1. **Level 1 — Chapter boundary split.** Each chapter is a top-level unit with `chapter_num`, `volume`, `chapter_title`. Enables direct lookup ("summarize chapter 245").
2. **Level 2 — Sub-chapter chunks.** ~400–600 tokens, ~100 token overlap.
3. **Contextual Retrieval (Anthropic).** Before embedding, prepend LLM-generated chapter context to each chunk. Anthropic reported **49% fewer retrieval failures, 67% with reranking.** This is the single highest-ROI technique for this project.

## Chunk metadata

```json
{
  "source": "epub",
  "book": "lotm1" | "coi",
  "volume": 1,
  "volume_name": "Clown",
  "chapter_num": 245,
  "chapter_title": "...",
  "chunk_index": 3,
  "total_chunks_in_chapter": 7,
  "entity_ids": [101, 203],
  "contextual_prefix": "In Chapter 245, Klein meets Audrey at..."
}
```

Entity tags use IDs into the `entities` table — curated alias list handles LOTM's identity-swapping characters.

---

# The Hard Problems — Concrete Patterns

## 1. Contextual Retrieval (do this day 1)

Anthropic's technique: before embedding each chunk, ask an LLM "give 50–100 tokens of context situating this chunk within its chapter." Prepend that context to the chunk text before embedding and before indexing in tsvector. Drops retrieval failures 49–67%.

Cost: ~$20 one-shot for both books using Haiku 4.5 with prompt caching (cache the full chapter, run over each chunk in that chapter).

## 2. Aggregation queries ("list all Tarot Club meetings")

Pure top-k dense retrieval fails — distant mentions get pushed below the cutoff. Two-tier approach:

- **Entity + event index at ingest.** Store `(entity, chapter, chunk_id, role, snippet)` rows in Postgres. Aggregation becomes a `WHERE entity='Tarot Club'` SQL scan. Seed with a curated LOTM alias table — LLM NER alone fragments Klein/Zhou Mingrui/Gehrman Sparrow/Sherlock Moriarty into separate entities.
- **Multi-query decomposition** for soft aggregation. A query classifier routes `lookup | semantic | aggregation`. For aggregation, an LLM rewrites into 3–5 sub-queries, each hits the index, results merged via Reciprocal Rank Fusion.

Skip full Microsoft GraphRAG (historically expensive, LazyGraphRAG dropped cost ~1000x but LightRAG/HippoRAG match it cheaper for narrative content).

## 3. Hierarchical summaries

Pre-compute at ingest, respecting authorial arc boundaries:

```
chunk → chapter summary → arc summary → volume summary → series synopsis
```

Store as retrievable nodes with `chapter_range` metadata. Route "summarize chapter 245" and "what is the Red Priest arc about" to pre-computed summaries, not live generation. RAPTOR-style but arc-aware (don't let k-means clustering override authorial structure).

## 4. Spoiler control

Literature is thin here — build it yourself:

- **UI reading slider** on first visit, persisted per session. Don't infer from query.
- **Metadata pre-filter** (not post-filter — post-filter starves top-k): `WHERE chapter_num <= session.max_chapter`.
- **Spoiler entity table** for canonical reveals (Klein's final identity, Sequence 0 secrets) masked even if chunk chapter ≤ max.
- **Explicit override** for power users ("spoil me" / `/unlocked`).

## 5. Specific-quote retrieval ("what does Klein say to Audrey in ch 400")

Scope first, then hybrid:

1. Structured filter: `WHERE chapter=400`.
2. Hybrid search within slice (dense + tsvector, RRF).
3. Cross-encoder rerank (bge-reranker-v2-m3).

Contextual Retrieval on the chunks makes this dramatically better than naive chunks because the chapter context encodes speaker/addressee.

## 6. Long-range factoids ("when does Klein reach Sequence 5?")

Build an **event timeline index** at ingest: `(character, event_type, chapter, evidence_chunk_id)`. Route "first/last/when" questions to SQL, not retrieval. Structured extraction beats retrieval+synthesis every time for single-event factoids.

---

# Hybrid Search (single SQL query)

Dense (pgvector) + sparse (tsvector) combined with Reciprocal Rank Fusion:

```sql
WITH dense AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1) AS r
  FROM chunks WHERE chapter_num <= $maxChapter
  ORDER BY embedding <=> $1 LIMIT 20
),
sparse AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, plainto_tsquery($2)) DESC) AS r
  FROM chunks WHERE tsv @@ plainto_tsquery($2) AND chapter_num <= $maxChapter
  LIMIT 20
)
SELECT c.*, SUM(1.0/(60+r)) AS score
FROM (SELECT id,r FROM dense UNION ALL SELECT id,r FROM sparse) u
JOIN chunks c USING (id)
GROUP BY c.id ORDER BY score DESC LIMIT 8;
```

`ts_rank` lacks IDF (worse than true BM25), but with `pg_trgm` added and RRF, quality is ~90% of BM25 with zero ops. Upgrade to `pg_textsearch` (TigerData) if recall on rare character names suffers — `pg_search` (ParadeDB) is no longer available for new Neon projects as of March 2026.

---

# Models (April 2026)

## LLMs — corrections from draft

| Role | Model | Why |
| --- | --- | --- |
| Dev / best quality | **Claude Sonnet 4.6** ($3/$15, 1M ctx) | Best balance of quality + cost for long-context RAG. Prompt caching universal. |
| Premium fallback | Claude Opus 4.7 ($5/$25, 1M ctx) | Only if Sonnet quality insufficient on reasoning. |
| Ingest contextualization | **Claude Haiku 4.5** ($1/$5, 200K ctx) | Cheap, fast, strong enough for Contextual Retrieval prompts. |
| Free-tier production | **Gemini 3 Flash** (1M ctx, free) | Gemini 3 Pro (2M) is **paid only** as of Apr 1, 2026. |
| Free open-weight | **Llama 4 Maverick** or **Gemma 4 31B** via Groq / OpenRouter | Gemma 4 released Apr 2, 2026; Apache 2.0; 256K ctx. |

**Stale picks to avoid:** Claude Sonnet 4.6 is still current but draft called it "best quality overall" — that's Opus 4.7 now. Gemini 2.0 Flash is ~18 months old; Gemini 3 is current. Llama 4 Scout's 10M context is an advertised ceiling, not effective — don't design around it.

## Embeddings

| Model | Score | License | Notes |
| --- | --- | --- | --- |
| **Qwen3-Embedding-8B** | 70.58 MTEB multilingual | Apache 2.0 | Still top open model for fiction; strong long-text |
| Microsoft Harrier | #1 MTEB-v2 multilingual (Apr 6, 2026) | Open | New — verify production readiness |
| Gemini Embedding 001 | 68.32 MTEB English | Proprietary | Top English MTEB |
| BGE-M3 | 63.0 | MIT | Dense + sparse + multi-vector in one model |
| OpenAI text-embedding-3-small | — | Proprietary | Dev default, $0.02/1M |

**Recommendation:** OpenAI `text-embedding-3-small` for dev ($0.02/1M); Qwen3-Embedding-8B self-hosted for production. BGE-M3 if you want dense+sparse from one model.

## Rerankers

- **bge-reranker-v2-m3** — <600M params, consumer GPU, excellent value
- **Qwen3-Reranker-8B** — pair with Qwen3 embeddings
- **Cohere Rerank 3** — if you want API convenience

## Inference hosts

| Provider | Free tier | Notes |
| --- | --- | --- |
| **Vercel AI Gateway** | $5/mo credit | **Recommended** — zero markup PAYG, one-line provider swap, failover |
| Groq | 6K tok/min all models | Fast LPU |
| Cerebras | 60K tok/min | Higher cap than Groq |
| OpenRouter | 50 req/day (1K with $10+ balance) | Unified API if not using AI Gateway |

---

# Tech Stack — Final

## Backend

| Layer | Technology | Rationale |
| --- | --- | --- |
| Runtime | **Next.js 16 App Router** (Vercel) | One deploy, Fluid Compute, streaming native |
| LLM + embeddings | **Vercel AI SDK v6** via AI Gateway | Provider abstraction, `streamText`, `embedMany`, tool calls |
| EPUB parsing | **`@gxl/epub-parser`** (TS) | Chapter-structure-preserving |
| Chunking | Custom TS (30 lines) | Chapter-aware hybrid |
| Entity extraction | Claude Haiku w/ curated alias table | LLM NER > spaCy for LOTM identity swaps |
| Contextualization | Claude Haiku 4.5 + prompt caching | Anthropic Contextual Retrieval |
| DB | **Neon Postgres (pgvector + tsvector + pg_trgm)** via Vercel Marketplace | Free tier, branching, auto-provisioned env |
| ORM | Drizzle | Typed pgvector queries, AI SDK cookbook standard |

## Frontend

| Layer | Technology |
| --- | --- |
| UI | Next.js 16 + `useChat` from AI SDK |
| Styling | Tailwind CSS |
| Hosting | Vercel (same deploy as backend) |

## Ingestion

One-shot local TS script (`scripts/ingest.ts`). Not a service — runs on laptop, writes directly to Neon via HTTP driver. Re-run: `TRUNCATE chunks; pnpm ingest book.epub`.

---

# Cost Estimate

## One-time ingestion (~$30–40)

| Item | Cost |
| --- | --- |
| Embeddings (OpenAI `text-3-small`, 10M tokens × $0.02/M) | ~$0.20 |
| Contextual Retrieval (Haiku 4.5, ~25k chunks × chapter context w/ prompt caching) | ~$20 |
| Hierarchical summaries (chapter/arc/volume) | ~$10 |
| **Total** | **~$30** |

If self-hosting Qwen3-Embedding-8B, drop embedding cost to $0.

## Ongoing (~$0–5/month at personal use)

| Item | Cost |
| --- | --- |
| Vercel Hobby | $0 |
| Neon free tier (0.5 GB, 100 CU-h) | $0 |
| LLM inference (~100 queries/mo, Sonnet 4.6 w/ prompt caching) | ~$3 |
| LLM inference (~100 queries/mo, Gemini 3 Flash free tier) | $0 |
| **Total (Sonnet)** | **~$3/mo** |
| **Total (Gemini 3 Flash)** | **$0/mo** |

**Realistic first-year total: ~$30 one-time + $0–36/year** — well under $100.

## Scale triggers

- Public sharing with auth/rate limiting → Vercel Pro ($20/mo)
- Cross-request retrieval cache → Vercel KV ($10/mo)
- Gemini 3 Pro (2M ctx) → PAYG ~$5–15/mo at low volume
- Multi-series corpus (10+ books) → Neon Pro ($19/mo)

---

# Build Phases

## Phase 0 — Eval set (do before writing retrieval code)

- 30–50 question / expected-chunk pairs covering each query type (chapter summary, lore Q&A, character tracking, pathway details, timeline, specific dialogue, aggregation)
- Without this, "retrieval quality is insufficient" has no meaning

## Phase 1 — Ingestion & retrieval core

- TS EPUB parser → chapter extraction
- Hybrid chunking (chapter-level + sub-chunk)
- **Contextual Retrieval prepend** (Haiku + prompt caching)
- Neon setup (pgvector + tsvector + pg_trgm)
- Embed + store; seed curated alias table; extract entities/events
- Hybrid SQL (RRF) query working

## Phase 2 — Chat backend

- Next.js API route using AI SDK `streamText` + tool calls
- `searchBook`, `lookupEntity`, `aggregateEvents` tools
- Source priority reranking
- Prompt caching on system+glossary (1-hour TTL)

## Phase 3 — Frontend

- `useChat` UI with inline citations
- **Reading-position slider** for spoiler control
- Deploy to Vercel

## Phase 4 — Wiki integration

- MediaWiki API scrape
- Ingest + tag `source: wiki`
- Test lore Q&A improvement

## Phase 5 — Polish & scale

- Series selector (LOTM1 / COI / both)
- Two-stage retrieval (embed → bge-reranker-v2-m3)
- Forum ingestion (optional)
- Switch LLM to Gemini 3 Flash free tier for cost-free production

---

# Scalability to Other Series

Architecture generalizes cleanly:

1. Drop a new EPUB → run ingestion script → new `book_id` namespace in Neon
2. Scrape corresponding wiki (if exists)
3. Chat UI exposes a series selector

Challenges for other series:

- **Multiple translations** (older xianxia): pick one canonical, tag with `translation`
- **No EPUB** (web-scraped HTML only): different ingest script, same chunking
- **Poor wiki coverage**: EPUB is authoritative anyway

---

# Open Questions

1. **Wiki vs EPUB conflict resolution.** When they disagree, cite both with EPUB flagged authoritative
2. **COI + LOTM1 cross-book retrieval.** Allow querying both simultaneously, or force series selection? Default to current book with explicit cross-series opt-in.
3. **Reranker in Phase 1?** Skip initially; add in Phase 5 if eval shows retrieval misses.
4. **Auth / rate limiting.** Personal use only initially. Add auth + rate limits if sharing publicly.
5. **Contextual Retrieval cost control.** If $20 ingest proves too expensive, scope to a single book first and validate eval lift before running the full corpus.

---

# References

- LOTM Fandom Wiki: [https://lordofthemysteries.fandom.com/wiki/](https://lordofthemysteries.fandom.com/wiki/)
- Internet Archive LOTM1 EPUB: [https://archive.org/details/lotm-full-english-novel-translations](https://archive.org/details/lotm-full-english-novel-translations)
- Vercel AI SDK: [https://ai-sdk.dev/docs/introduction](https://ai-sdk.dev/docs/introduction)
- AI SDK RAG cookbook: [https://ai-sdk.dev/cookbook/guides/rag-chatbot](https://ai-sdk.dev/cookbook/guides/rag-chatbot)
- Neon pgvector: [https://neon.com/docs/extensions/pgvector](https://neon.com/docs/extensions/pgvector)
- Anthropic Contextual Retrieval: [https://www.anthropic.com/news/contextual-retrieval](https://www.anthropic.com/news/contextual-retrieval)
- Anthropic prompt caching: [https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching)
- Anthropic pricing: [https://platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Gemma 4 launch: [https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)
- Google Gemini models: [https://ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)
- ParadeDB hybrid search manual: [https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual)
- Qwen3 embeddings: [https://qwenlm.github.io/blog/qwen3-embedding/](https://qwenlm.github.io/blog/qwen3-embedding/)
- Microsoft Harrier (April 2026): [https://blogs.bing.com/search/April-2026/Microsoft-Open-Sources-Industry-Leading-Embedding-Model](https://blogs.bing.com/search/April-2026/Microsoft-Open-Sources-Industry-Leading-Embedding-Model)
- RAPTOR: [https://github.com/parthsarthi03/raptor](https://github.com/parthsarthi03/raptor)
- LightRAG / HippoRAG (narrative RAG): [https://github.com/HKUDS/LightRAG](https://github.com/HKUDS/LightRAG), [https://github.com/OSU-NLP-Group/HippoRAG](https://github.com/OSU-NLP-Group/HippoRAG)