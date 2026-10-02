---
id: 023
title: Summaries dedupe hardening (DB unique key)
phase: 5
status: done
depends_on: [008]
estimate: M
updated: 2026-10-02
---

## Context

Ticket 008 dedupes inserts with `INSERT ... WHERE NOT EXISTS`, which is sufficient for single-writer runs but does not give hard race protection under concurrent writers.

## Scope

- Add a DB-level unique constraint/index for logical summary identity:
  - `(level, book_id, range_start, range_end, label)`
- Update insert path to use conflict-safe semantics (`ON CONFLICT DO NOTHING` or equivalent) and preserve inserted-row accounting.
- Validate no existing duplicate keys before applying migration.

## Out of scope

- Broad ingest concurrency orchestration.
- Reworking summary key semantics.

## Deliverables

- Drizzle migration for unique key.
- `lib/ingest/summaries.ts` insert helper update.
- Regression test coverage for no-op insert on duplicate key.

## Acceptance criteria

- Concurrent duplicate insert attempts cannot produce duplicate summary rows.
- Existing single-run behavior and progress logging remain correct.
- `pnpm typecheck` and relevant tests pass.

## Resolution

Superseded by ticket **030** before execution — the 2026-10-02 audit showed `entity_mentions` and `events` share this ticket's missing-unique-key problem, so the scope expanded to a single three-table migration under 030. No code was written under this ticket.
