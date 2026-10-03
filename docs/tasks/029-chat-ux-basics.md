---
id: 029
title: Chat UX basics — stop, regenerate, error retry
phase: 3
status: done
depends_on: [010]
estimate: S/M
updated: 2026-10-02
---

## Context

Audit finding: `components/chat.tsx` uses bare `useChat()` — refresh loses every message; there is no stream-error interaction beyond ticket 010's minimal error display; no stop button; no regenerate. 010's 429 guard covers provider rejections; this ticket owns the interaction affordances.

## Scope

- Decide and record: chat history stays **ephemeral** (no persistence in this pass — persistence is a post-015 nicety). Write the decision here before implementing.
- Stop button (AI SDK `stop()`).
- Regenerate last response on error without resubmitting.
- Empty-state hint pointing at reading-position setup.

## Out of scope

- History persistence, message editing, multi-session transcripts.

## Deliverables

- Updated `components/chat.tsx`; decision note in this ticket.

## Acceptance criteria

- Stop halts generation mid-stream cleanly.
- A failed turn can be regenerated in place.
- `pnpm build` + typecheck green.

## Resolution (2026-10-02, reopening Task 19)

- **Decision recorded:** chat history stays **ephemeral** — no persistence in this pass (post-015 nicety). Sessions live in component state; a refresh clears them.
- Stop button (AI SDK `stop()`) appears while streaming.
- Error banner gains "Retry last message" (`regenerate()`).
- Empty-state hint describing what to ask (added alongside the 012 disabled-state prompt).

## Verification

```bash
pnpm dev  # stop mid-stream; force an error; regenerate
```
