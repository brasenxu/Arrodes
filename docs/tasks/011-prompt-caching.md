---
id: 011
title: Prompt caching (system + glossary)
phase: 2
status: todo
depends_on: [010]
estimate: S
updated: 2026-10-02
---

## Context

The chat route's system prompt + a glossary of canonical aliases is stable across requests. Cache it to cut input cost materially. Post-ticket-020 reality: the chat model is `google/gemini-2.5-flash` routed via the AI Gateway — Gemini caches **implicitly** (no `cache_control` markers; those are provider-namespaced and silently ignored on Gemini).

Source-priority rerank was bundled here originally but moved to ticket 016 because it's a no-op pre-wiki.

## Scope

- Build `lib/rag/system-prompt.ts`:
  - Factor `SYSTEM_PROMPT` out of `app/api/chat/route.ts`.
  - Add `buildGlossary()` that loads canonical entity names + top 50 aliases (by mention count) from `entities`/`entity_mentions` at cold-start.
  - Keep the system prompt byte-stable across requests (static instructions + glossary block, no per-request values) so Gemini's implicit caching engages.
- Verify caching evidence for the actual provider (Gemini implicit-cache token counts via the AI Gateway / response metadata) and document it in `## Findings`.
- Glossary is loaded once per Fluid Compute instance and reused — not per request.

## Out of scope

- Source-priority rerank (moved to ticket 016).
- Per-request caching (system+glossary is the only stable surface; per-request content varies too much).
- Provider-specific cache markers (`cache_control`) — inert on the current chat model.

## Deliverables

- `lib/rag/system-prompt.ts`.
- `app/api/chat/route.ts` updated to import and use it.
- Cache-hit evidence in `## Findings` (provider-appropriate form).

## Acceptance criteria

- System prompt bytes are identical across a 5-query window (verifiable by construction — static template).
- Cached-token reuse evidenced for the current chat model across the 5-query window, or absence explained.
- Fluid Compute instance warmth: glossary load happens once at cold-start, not per request (measurable by logging instance init time).

## Verification

```bash
# run 5 chat queries in quick succession, then check AI Gateway for cache stats
```

## Findings

<!-- Paste cache-hit counts and any tuning notes. -->
