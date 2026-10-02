---
id: 020
title: Provider migration — Anthropic → DeepSeek V4 / Google Gemini
phase: 5
status: done
depends_on: []
estimate: S
updated: 2026-05-01
---

## Context

The project currently runs on Anthropic API keys (company-provided, temporary). Once access
expires, all inference must move to a self-funded provider. This ticket captures the
migration decision, the required code changes, and the acceptance criteria for verifying
the new provider is drop-in compatible.

### Current setup

| Env var | Current value | Role |
|---|---|---|
| `INGEST_CONTEXT_MODEL` | `claude-haiku-4-5` | Contextual retrieval, NER, event extraction |
| `INGEST_EMBED_MODEL` | `text-embedding-3-small` | Embeddings (OpenAI — unaffected) |
| `CHAT_MODEL` | `anthropic/claude-sonnet-4-6` | Chat route, streamed responses |
| `ANTHROPIC_API_KEY` | (company key) | Auth for both ingestion + chat |

### Decision: DeepSeek V4-Flash (ingestion) + DeepSeek V4-Pro or Gemini 2.5 Flash (chat)

**Updated 2026-04-24**: DeepSeek V4 released today. It changes the recommendation.

#### DeepSeek V4 (released 2026-04-24)

Two MoE models, both MIT-licensed open weights, 1M context, available via API now:

| Model | Params (total/active) | Input | Cache hit | Output |
|---|---|---|---|---|
| **V4-Flash** | 284B / 13B | $0.14/M | $0.028/M | $0.28/M |
| **V4-Pro** | 1.6T / 49B | $1.74/M | $0.145/M | $3.48/M |

The critical detail: **V4-Flash has explicit prompt caching with an 80% cache-hit discount**
($0.028 vs $0.14). This project's ingestion pipeline is built around exactly this pattern —
prompt caching a large chapter context and amortising it across all chunks. V4-Flash is the
only non-Anthropic model that matches this architecture natively.

**Recommended mapping:**

| Role | Current | Replacement | Cost vs current |
|---|---|---|---|
| `INGEST_CONTEXT_MODEL` | claude-haiku-4-5 | `deepseek-v4-flash` | ~$0.14 input vs $1.00 — ~7× cheaper uncached; cache hits $0.028 vs $0.10 — same order |
| `CHAT_MODEL` | claude-sonnet-4-6 | `deepseek-v4-pro` or `gemini-2.5-flash` | V4-Pro: $1.74/$3.48 vs $3.00/$15.00; Gemini 2.5 Flash: $0.15/$0.60 |

Note: `deepseek-chat` currently routes to V4-Flash (non-thinking). It will be retired
2026-07-24; migrate to `deepseek-v4-flash` explicitly before that date.

#### Why DeepSeek V4-Flash for ingestion over Gemini

- **Explicit cache pricing** — V4-Flash publishes $0.028/M for cache hits. Gemini uses
  implicit/automatic caching with no guaranteed per-hit discount published. For a pipeline
  that fires 7–9 cache reads per chapter after one write, the difference matters.
- **Anthropic-compatible API format** — DeepSeek's API supports both OpenAI ChatCompletions
  and Anthropic API formats. The `providerOptions: { anthropic: { cacheControl: ... } }`
  annotations already in `lib/ingest/` may translate directly (needs verification —
  see Scope item 2).
- **Quality** — V4-Flash benchmarks significantly above Haiku 4.5 for structured extraction.

#### Why Gemini Flash is the better chat choice (not just cheaper)

Three reasons beyond price:

1. **Instruction following**: Gemini 2.5 Flash scores 79 on IFEval — the benchmark for
   rule-adherence (cite as (Book Ch.N), never speculate past reading position, always call
   tool before answering). The Arrodes system prompt is pure IFEval territory: clear rules,
   well-defined output format. Flash was explicitly tuned for this class of task.

2. **Streaming latency**: DeepSeek API servers are in China. From US regions, TTFT is
   ~300–1000ms vs Gemini's ~150ms — a 2–6× gap that is visible in the streaming chat UI.
   Gemini Flash also generates tokens ~2× faster after the first chunk.

3. **Price at this workload's token profile**: RAG turns are input-heavy (system prompt +
   prior messages + retrieved chunks). At 4–8k input tokens per request, DeepSeek V4-Pro
   at $1.74/M is ~6× more expensive than Gemini 2.5 Flash at $0.30/M.

V4-Pro's quality ceiling is genuinely higher, but the chat workload here (grounded RAG,
structured tool calls, strict citation rules) plays to Flash's strengths. The upgrade path
is a single env var change: if Flash drops citations or leaks spoilers, swap `CHAT_MODEL`
to `deepseek-v4-pro` with zero code changes.

#### Gemini model lineup (April 2026) — choosing the right Flash tier

The 3.x family is now the recommended production tier; 2.5 is moving to legacy.

| Model | Input /1M | Output /1M | Notes |
|---|---|---|---|
| Gemini 3.1 Pro | $2.00 (≤200K) / $4.00 (>200K) | $12.00 / $18.00 | Frontier. Overkill for RAG chat. |
| Gemini 3 Flash | $0.50 | $3.00 | Mid-tier new model. More expensive than 2.5 Flash with no clear advantage here. |
| **Gemini 2.5 Flash** | **$0.30** | **$2.50** | **Recommended default.** Proven IFEval (79), solid tool calling. |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | Cheapest. Worth testing — if multi-step tool chains hold up, this becomes the long-term default as 2.5 moves to legacy. |

Note: "$0.15/M" figures seen elsewhere for 2.5 Flash are the **batch/flex** rate (async
queue, no latency SLA) — not suitable for a live streaming chat route.

#### Other alternatives considered

- **Gemini 2.0 / 2.5 Flash-Lite**: $0.10/$0.40, implicit caching, 1M context. Best
  pure-price option for ingestion if DeepSeek V4 cache annotations don't work. Fallback if
  V4-Flash quality regresses on NER/events by > 5 pp F1.
- **GPT-4o-mini**: $0.15/$0.60, implicit caching. Already have `@ai-sdk/openai`.
  Solid fallback, no new packages.
- **Kimi K2.6** (Moonshot AI, released 2026-04-20): $0.60/$2.80 per 1M, automatic
  caching at ~$0.10–$0.15 on cache hits, 256K context, open weights (Modified MIT).
  Strong coding/agentic benchmarks (80.2% SWE-Bench Verified). OpenAI-compatible API
  (`https://api.moonshot.ai/v1`). Not a strong contender for ingestion (output at $2.80
  vs DeepSeek V4-Flash's $0.28). More interesting as a mid-tier chat model — comparable
  quality to V4-Pro at lower cost, though Gemini 2.5 Flash at $0.15/$0.60 beats it on
  price for a RAG-heavy chat workload where large input context dominates.
- **GPT-5.5** (OpenAI, released 2026-04-23): $5.00/$30.00 per 1M, 1M context. Flagship
  tier — more expensive than the Sonnet we are replacing. API not fully live at launch
  ("coming very soon"). Not relevant to this migration.
- **Open source hosted (Groq, Together AI, Qwen 2.5 72B)**: viable for batch ingestion;
  most lack prompt caching support; adds operational complexity. Lower priority.

### Prompt caching: what changes

Ingestion currently uses Anthropic-specific explicit `cacheControl` markers:

```typescript
providerOptions: {
  anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
},
```

These are scattered across `lib/ingest/contextualize.ts`, `lib/ingest/ner.ts`, and
`lib/ingest/events.ts`. **They are provider-namespaced and silently ignored by
non-Anthropic providers** — they will not cause errors on Gemini or OpenAI.

For **DeepSeek V4-Flash specifically**: DeepSeek's API supports the Anthropic API format,
which means the `cacheControl` annotations _may_ be honoured and trigger the $0.028 cache-
hit rate. This needs to be verified during implementation. If they are ignored, V4-Flash
still lands at $0.14/M uncached which beats cached Haiku ($0.10/M cache read, $2.00/M
cache write). Either way it's viable.

The `providerOptions: { anthropic: ... }` blocks can be left in place until verified.

## Scope

1. **Add `@ai-sdk/openai` custom base URL config** for DeepSeek (uses OpenAI-compatible
   endpoint — no new package needed). Or verify if `@ai-sdk/deepseek` exists.
2. **Test whether DeepSeek V4-Flash honours Anthropic-format `cacheControl`** via a small
   dry-run of `pnpm ingest --phase ner --limit 1 --dry-run`. Inspect response headers /
   usage metadata for `cache_read_input_tokens` to confirm.
3. **Swap provider construction** in the five scripts that hardcode `@ai-sdk/anthropic`:
   - `scripts/ingest.ts`
   - `scripts/ner-score.ts`
   - `scripts/event-score.ts`
   - `scripts/event-review.ts`
   - `scripts/event-debug-1099.ts`
4. **Update env-var guards** — replace `ANTHROPIC_API_KEY` presence checks with
   `DEEPSEEK_API_KEY` (or whichever key name DeepSeek uses) in each script.
5. **Update `.env.local`** — set new model IDs and API key.
6. **Update `CHAT_MODEL`** — change to `deepseek-v4-pro` or `gemini-2.5-flash` depending
   on quality benchmark result. If using Gemini, wire `@ai-sdk/google`.
7. **Add `INGEST_SUMMARY_MODEL`** (introduced by ticket 008) — higher-capability tier used
   for arc/volume/series summaries. Set to `deepseek-v4-pro` or `gemini-2.5-flash` to
   match the chat model tier. Add to `.env.example` and `.env.local`.
8. **Update the cost-tracking `PRICING` constants** in `scripts/ingest.ts` to reflect
   DeepSeek V4-Flash pricing ($0.14 input no-cache, $0.028 cache-read, output $0.28).

## Out of scope

- Stripping the dead `providerOptions: { anthropic: ... }` blocks from `lib/ingest/`
  (purely cosmetic; fine to defer — especially if they end up being active on DeepSeek).
- Switching the embed model (`text-embedding-3-small` / OpenAI — unaffected, stays).
- Re-running ingestion phases — ingestion is complete for both books. This migration only
  matters for future re-ingestion runs and for the live chat route.

## Deliverables

- Provider wired for DeepSeek V4-Flash in all five ingestion scripts.
- `.env.example` updated: `INGEST_CONTEXT_MODEL=deepseek-v4-flash`,
  `INGEST_SUMMARY_MODEL=deepseek-v4-pro`, `CHAT_MODEL=google/gemini-2.5-flash`
  (start with 2.5 Flash; migrate to 3.1 Flash-Lite once tool-calling is verified).
- `PRICING` constants updated in `scripts/ingest.ts`.
- A short note in this ticket's Resolution section documenting whether `cacheControl`
  annotations were honoured by DeepSeek V4 (so future tickets know).

## Acceptance criteria

- `pnpm ingest --book lotm1 --phase ner --limit 1 --dry-run` completes without error using
  the DeepSeek key (proves NER prompt + provider work end-to-end).
- `pnpm ingest --book lotm1 --phase events --limit 1 --dry-run` completes without error.
- NER scorer (`pnpm ner-score`) produces an F1 within **5 pp** of the Haiku baseline. If
  regression > 5 pp, fall back to `gemini-2.0-flash` or `gemini-2.5-flash-lite` before
  accepting.
- Chat route (`POST /api/chat`) returns a streamed response with tool calls exercised.
- No `ANTHROPIC_API_KEY` references remain in code paths that execute at runtime (grep
  check; dead `providerOptions` annotations in `lib/ingest/` are acceptable).

## Verification

```bash
# 1. NER dry-run with DeepSeek V4-Flash
DEEPSEEK_API_KEY=... pnpm ingest --book lotm1 --phase ner --limit 1 --dry-run
# Inspect output for cache_read_input_tokens > 0 to confirm caching is active.

# 2. Events dry-run
DEEPSEEK_API_KEY=... pnpm ingest --book lotm1 --phase events --limit 1 --dry-run

# 3. NER quality regression check
pnpm ner-score
# Compare F1 to Haiku baseline. If > 5 pp regression, switch to gemini-2.0-flash fallback.

# 4. Chat route smoke test
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Who is Klein Moretti?"}]}'

# 5. Grep for stale ANTHROPIC_API_KEY runtime references
rg "ANTHROPIC_API_KEY" scripts/ app/ lib/ --no-filename
```

## Notes

- DeepSeek V4 API docs: https://api-docs.deepseek.com — uses OpenAI-compatible base URL,
  just swap the `model` parameter to `deepseek-v4-flash` or `deepseek-v4-pro`.
- DeepSeek offers **5M free tokens** for new API accounts, no credit card required — good
  for smoke-testing the migration at zero cost.
- `deepseek-chat` currently routes to V4-Flash (non-thinking mode). Retire before
  **2026-07-24** when the legacy endpoints are shut down.
- If DeepSeek caching doesn't fire on the ingestion prompts, Gemini 2.0 Flash at $0.10/$0.40
  (implicit caching) is the immediate fallback — `GOOGLE_GENERATIVE_AI_API_KEY` is already
  a named slot in `.env.example`.

## Resolution

- Runtime code paths now use `DEEPSEEK_API_KEY` instead of `ANTHROPIC_API_KEY` for
  ingestion/eval scripts, with DeepSeek wired through `@ai-sdk/openai` using
  `https://api.deepseek.com/v1`.
- `PRICING` in `scripts/ingest.ts` now reflects DeepSeek V4-Flash rates:
  no-cache input `$0.14/M`, cache-read `$0.028/M`, output `$0.28/M`.
- `.env.example` and `.env.local` defaults now point to:
  - `INGEST_CONTEXT_MODEL=deepseek-v4-flash`
  - `INGEST_SUMMARY_MODEL=deepseek-v4-pro`
  - `CHAT_MODEL=google/gemini-2.5-flash`
- Verification snapshot (26-chunk gold set):
  - Haiku baseline: `P=0.88, R=0.77, F1=0.82`
  - DeepSeek V4-Flash: `P=0.686, R=0.927, F1=0.788`
  - Gemini 2.5 Flash-Lite: `P=0.667, R=0.913, F1=0.771`
  - Gemini 2.5 Flash: `P=0.663, R=0.945, F1=0.780`
- Final provider decision:
  - **Ingestion**: DeepSeek V4-Flash (`INGEST_CONTEXT_MODEL`)
  - **Ingestion summaries**: DeepSeek V4-Pro (`INGEST_SUMMARY_MODEL`)
  - **Chat**: Gemini 2.5 Flash (`CHAT_MODEL`)
- Chat route acceptance check is deferred to ticket `010` (chat tools/live route
  ownership). This ticket finalized provider defaults and ingestion/eval migration.
- Follow-up verification (2026-05-01): repeated DeepSeek dry-runs now show
  non-zero cache reads on NER prompts:
  - Run A: `noCache=66 cacheRead=44288 cacheWrite=0 output=360`
  - Run B: `noCache=66 cacheRead=44288 cacheWrite=0 output=603`
  Verdict: cache reuse is active for this prompt shape; keep current
  Anthropic-style `providerOptions.anthropic.cacheControl` markers.
