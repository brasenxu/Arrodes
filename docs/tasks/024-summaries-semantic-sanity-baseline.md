---
id: 024
title: Summaries semantic sanity baseline
phase: 4
status: todo
depends_on: [008]
estimate: S
updated: 2026-10-02
---

## Context

Ticket 008 validated final summary counts, but the semantic nearest-neighbor sanity probe should be captured as a repeatable baseline artifact for future regressions.

## Scope

- Add a reproducible semantic sanity check for summary retrieval quality.
- Record baseline top-k results for one or more canon-sensitive probe queries.
- Document expected tolerances and failure signals.

## Out of scope

- Full retrieval benchmark suite expansion.
- Re-ranking or model tuning work.

## Deliverables

- A script or documented command sequence to:
  - embed probe text,
  - run vector query against `summaries`,
  - print top-k labels/ranges.
- Baseline artifact checked into eval/docs.

## Acceptance criteria

- Running the check yields stable, plausible arc/volume hits for the probe set.
- Baseline is stored where future tickets can diff against it.
- `pnpm eval:validate` remains green.

## Probe query (pinned from the 008 spec)

The canon-sensitive probe is: **"Klein kills Lanevus after Audrey reports the clue"** — expected top-1 is the corresponding arc summary. The phrase "Klein meets Audrey" must NOT be used (their first meeting is a separate Tarot Club event in Volume 1 — `docs/superpowers/specs/2026-05-02-hierarchical-summaries-design.md:159` corrects the original 008 AC wording).
