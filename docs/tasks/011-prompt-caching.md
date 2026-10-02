---
id: 011
title: Prompt caching (system + glossary)
phase: 2
status: todo
depends_on: [010]
estimate: S
updated: 2026-04-21
---

## Context

The chat route's system prompt + a glossary of canonical aliases is stable across requests. Cache it with Anthropic's `cache_control` to cut input cost materially — relevant even at personal-use volumes because Haiku/Sonnet input tokens accumulate fast when a glossary of 200+ entities is in every request.

Source-priority rerank was bundled here originally but moved to ticket 016 because it's a no-op pre-wiki.

## Scope

- Build `lib/rag/system-prompt.ts`:
  - Factor `SYSTEM_PROMPT` out of `app/api/chat/route.ts`.
  - Add `buildGlossary()` that loads canonical entity names + top 50 aliases (by mention count) from `entities`/`entity_mentions` at cold-start.
  - Construct the system prompt as two cacheable blocks: static instructions + dynamic glossary. Apply `cache_control: { type: "ephemeral", ttl: "1h" }` to both.
- Verify cache hits via Anthropic response headers surfaced by the AI SDK (`response.providerMetadata`).
- Glossary is loaded once per Fluid Compute instance and reused — not per request.

## Out of scope

- Source-priority rerank (moved to ticket 016).
- Per-request caching (system+glossary is the only stable surface; per-request content varies too much).

## Deliverables

- `lib/rag/system-prompt.ts`.
- `app/api/chat/route.ts` updated to import and use it.
- Cache-hit evidence in `## Findings`.

## Acceptance criteria

- Prompt-cache hit rate ≥ 80% across a 5-query test (first query primes, 4 hit).
- Sonnet input token count drops visibly in the AI Gateway dashboard across the 5-query window.
- Fluid Compute instance warmth: glossary load happens once at cold-start, not per request (measurable by logging instance init time).

## Verification

```bash
# run 5 chat queries in quick succession, then check AI Gateway for cache stats
```

## Findings

<!-- Paste cache-hit counts and any tuning notes. -->
