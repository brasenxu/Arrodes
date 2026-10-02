---
id: 013
title: Inline citation rendering
phase: 3
status: todo
depends_on: [010]
estimate: S
updated: 2026-04-21
---

## Context

The assistant emits citations like `(LOTM1 Ch.245)`. The UI currently renders these as plain text; they should become hover-expandable tags that show the retrieved chunk excerpt. This makes the product feel grounded rather than "same old chat."

## Scope

- Parse citation tokens from message text: regex `/\((LOTM1|COI) Ch\.(\d+)\)/g`.
- Replace matches with a styled `<Citation>` component.
- `Citation` opens a popover on hover/click showing:
  - Chapter title
  - Top-1 retrieved chunk excerpt (first ~200 chars)
  - A "copy link" button (future — links to an external chapter reader).
- Stream-safe: citation rendering must work mid-stream, not wait for message completion.
- Map citation → retrieved chunk: the route already returns tool results in `message.parts`; correlate citations to results by `(book_id, chapter_num)`. If multiple chunks match, pick highest score.

## Out of scope

- External-link generation (no canonical reader URL yet).
- PDF/print-ready citation formatting.

## Deliverables

- `components/citation.tsx`.
- `lib/client/citations.ts` — parser + chunk correlator.
- Chat component updates: text parts get passed through the citation parser before rendering.

## Acceptance criteria

- In a test session: assistant emits `(LOTM1 Ch.245)` inline, UI shows it as a styled pill, hover shows the chapter excerpt.
- Two citations on the same chapter render correctly.
- Stream doesn't flicker — partial citation tokens (e.g., `(LOTM1 Ch.2` mid-stream) render as plain text until complete.

## Verification

```bash
pnpm dev
# ask a question that forces multiple citations, verify rendering
```
