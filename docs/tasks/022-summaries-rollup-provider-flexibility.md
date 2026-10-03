---
id: 022
title: Summaries rollup provider flexibility
phase: 5
status: todo
depends_on: [008, 020]
estimate: S
updated: 2026-10-02
---

## Context

Ticket 008 intentionally constrained summary-tier model selection to DeepSeek-only IDs via `resolveDeepSeekSummaryModelId`. This blocks using Gemini (or other providers) for arc/volume/series summaries without code changes.

## Scope

- Relax summary-tier provider validation so configured non-DeepSeek models can be used safely.
- Keep clear validation errors for unsupported or malformed model IDs.
- **Fallback semantics (revised 2026-10-02):** drop the `INGEST_SUMMARY_MODEL` → `CHAT_MODEL` fallback. The old fallback is dead post-020 (`CHAT_MODEL=google/gemini-2.5-flash` fails `resolveDeepSeekSummaryModelId` after logging "using CHAT_MODEL fallback"). Fail fast with an actionable error ("set INGEST_SUMMARY_MODEL") when the env var is missing or incompatible.

## Out of scope

- Re-architecting all ingest provider wiring.
- Changing chapter-tier (`INGEST_CONTEXT_MODEL`) defaults.

## Deliverables

- `lib/ingest/summaries.ts` model validation/update.
- `scripts/ingest.ts` logging and guardrail updates (if needed).
- Tests covering allowed/denied model ID cases.

## Acceptance criteria

- Summaries ingest can run with DeepSeek and Gemini summary-tier model IDs.
- Invalid IDs still fail fast with actionable errors.
- `pnpm test lib/ingest/summaries.test.ts` and `pnpm typecheck` pass.
