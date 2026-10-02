---
id: 012
title: Reading position slider (spoiler control UI)
phase: 3
status: done
depends_on: [010]
estimate: M
updated: 2026-10-02
---

## Context

Spoiler control is a product-critical feature and cannot be retrofit safely. The UI captures the user's per-book reading position on first visit, persists it in localStorage, and passes it with every chat request. Server-side, the chat route uses it to bind `buildTools(position)` — the position pre-filters retrieval (already implemented).

## Scope

- Build `components/reading-position.tsx`:
  - Modal on first visit (detected by empty localStorage key).
  - Two sliders — LOTM1 (1–**1432**, FULL bounds) and COI (1–**1181**, or disabled if the user hasn't started it), with a labeled tick at the main-story end (LOTM1 **1394**, COI **1179** — arc-map `MAIN_BOUNDS`/`FULL_BOUNDS`; the 2026-10-02 audit corrected the originally assumed 1396/1180: side stories are 1395–1432 on LOTM1, bonus+side 1180–1181 on COI).
  - A toggle per book: "I've finished this book" → sets to `FULL_BOUNDS`.
  - A toggle per book: "I haven't started this book" → sets to `null`.
  - Persist to `localStorage.arrodes.position` as `{lotm1, coi, updatedAt}`.
- Build `lib/client/position.ts` — `usePosition()` hook: reads from localStorage, exposes `{position, setPosition, hasBeenSet}`.
- Thread `position` through `useChat`'s `sendMessage` body.
- Add a settings affordance (pencil icon in header) to re-open the modal.
- Edge case: when both books are `null`, chat is disabled with a message prompting the user to set a position.
- **017 seam (2026-10-02):** the hook reserves a session-only `spoilMe` override flag (NOT persisted) so ticket 017's in-session "spoil me" affordance doesn't rework the hook/modal later.

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

<!-- Paste test transcript + any bugs found and fixed. -->

### Resolution (2026-10-02, reopening Task 17)

- `lib/client/position.ts`: `parseStoredPosition`/`serializeStoredPosition` (pure, 8 tests green) + `usePosition()` hook over `localStorage.arrodes.position`; **017 seam delivered** (session-only `spoilMe`, not persisted).
- `components/reading-position.tsx`: controlled modal — first-visit open (when unset), sliders to FULL bounds (1432/1181) with main-story tick labeled (1394/1179), finished/not-started toggles, Cancel on edit.
- `components/app-shell.tsx` (new): single `usePosition` owner — header pencil, modal, and chat share one state instance (per-consumer instances would desync modal state).
- `components/chat.tsx`: position threaded into every `sendMessage` body; chat disabled with a set-position prompt when unset or both-null.
- Route: position now REQUIRED (400 without it) — dev default removed.
- Programmatically verified: no-position → 400; explicit full position → cited answer; side-story chapter at main-only position → refusal; both-null → graceful. Slider/persistence interaction in a real browser left as a user smoke test (code + build verified).
- Slider max corrected to arc-map truth: 1432/1181 FULL, 1394/1179 main (audit + DB-verified; the ticket's original 1396/1180 sat inside the side-story range).
<!-- Paste test notes. -->
