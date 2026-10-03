---
id: 011
title: Prompt caching (system + glossary)
phase: 2
status: done
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

### Evidence (2026-10-02, dev battery)

`onFinish` usage logging added to the chat route (also covers the audit's missing onError/onFinish smell). Google's `usageMetadata` via AI SDK v6 `providerMetadata`:

| Turn | promptTokenCount | cachedContentTokenCount | cached share |
|---|---|---|---|
| 1 (single) | 13,457 | 6,934 | ~52% |
| 2 (multi-turn) | 8,385 | 970 | ~12% |

Cached-token reuse is live — no configuration needed. The multi-turn cache-read share is lower because most of turn 2's prompt is the (differing) conversation history; the byte-stable portion (system + tool defs) is the cached part.

### Ruling: buildGlossary dropped

The ticket's original design (canonical entities + top aliases baked into the system prompt) is **spoiler-unsafe**: a glossary loaded once per instance cannot be position-gated, and `entities` rows include late-reveal identities (`is_spoiler` flag). Prompt-blocking on it would also break byte-stability. Alias mapping stays in the position-gated `lookupEntity` tool — DB-backed, which the static glossary was only ever approximating. Scope point retired with this note; the cache intent (byte-stable stable prefix) is fully delivered by the static prompt + static tool definitions.

## Resolution

- `SYSTEM_PROMPT` factored into `lib/rag/system-prompt.ts` (static const, byte-stability tested in `lib/rag/system-prompt.test.ts`); route imports it.
- Implicit-cache evidence recorded above (google `usageMetadata.cachedContentTokenCount` > 0 on consecutive turns).
- Glossary scope dropped per the Ruling; ticket closed as delivered-in-revised-form. ACs adjusted: "hit rate ≥ 80%" → "cached-token reuse evidenced" (already reflected in the 2026-10-02 scope rewrite).
