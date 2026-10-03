---
id: 031
title: Server-side reading position + auth (backlog)
phase: backlog
status: deferred
depends_on: [012, 017]
estimate: M
updated: 2026-10-02
---

## Context

The chat route receives `position` from the client body (validated + clamped by 010's hardening, but still client-supplied — any client can claim to have read everything). 012 defers server-side session position to post-auth; 017's entity-reveal gating assumes position integrity. Ticket 015 buries auth/rate-limiting in its out-of-scope. This ticket exists so the seam isn't lost at public-launch time.

## Scope (sketch — finalize at un-defer)

- Authenticated session carries the reading position; client body position becomes advisory or rejected.
- Rate limiting per session.
- Tool-part provenance: reject/strip client-supplied tool-result parts (forged "grounding evidence" risk noted in the 2026-10-02 audit, finding 4).

## Acceptance criteria

TBD at un-defer time (define alongside whatever auth mechanism is chosen).
