---
id: 012
title: Reading position slider (spoiler control UI)
phase: 3
status: todo
depends_on: [010]
estimate: M
updated: 2026-04-21
---

## Context

Spoiler control is a product-critical feature and cannot be retrofit safely. The UI captures the user's per-book reading position on first visit, persists it in localStorage, and passes it with every chat request. Server-side, the chat route uses it to bind `buildTools(position)` — the position pre-filters retrieval (already implemented).

## Scope

- Build `components/reading-position.tsx`:
  - Modal on first visit (detected by empty localStorage key).
  - Two sliders — LOTM1 (1–1396) and COI (1–1180, or disabled if the user hasn't started it).
  - A toggle per book: "I've finished this book" → sets to max.
  - A toggle per book: "I haven't started this book" → sets to `null`.
  - Persist to `localStorage.arrodes.position` as `{lotm1, coi, updatedAt}`.
- Build `lib/client/position.ts` — `usePosition()` hook: reads from localStorage, exposes `{position, setPosition, hasBeenSet}`.
- Thread `position` through `useChat`'s `sendMessage` body.
- Add a settings affordance (pencil icon in header) to re-open the modal.
- Edge case: when both books are `null`, chat is disabled with a message prompting the user to set a position.

## Out of scope

- Server-side session-based position (deferred to post-auth).
- Spoiler-entity masking beyond chapter-level gating (future ticket).

## Deliverables

- `components/reading-position.tsx`.
- `lib/client/position.ts`.
- Chat component updated to pass `position` with each message.
- Home page wires the modal to the `hasBeenSet` guard.

## Acceptance criteria

- First visit: modal blocks chat until position is set.
- Setting `{lotm1: 200, coi: null}`, then asking "what happens in chapter 500?" — assistant must decline (no chunk available in retrieval window).
- Edit-position path: pencil icon reopens modal; saving updates localStorage and subsequent requests.
- Refresh preserves position.

## Verification

```bash
pnpm dev
# 1. clear localStorage, verify modal blocks chat
# 2. set {lotm1: 200, coi: null}, ask "summarize chapter 500" — expect decline
# 3. reopen modal, set to full, ask same — expect answer
```

## Findings

<!-- Paste test notes. -->
