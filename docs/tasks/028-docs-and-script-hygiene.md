---
id: 028
title: Docs + script hygiene (audit findings 13, 14 + destructive-script guards)
phase: 0
status: done
depends_on: []
estimate: S
updated: 2026-10-02
---

## Context

The 2026-10-02 audit found stale ticket statuses and premises (020 marked done with a deferred chat-route AC; 011 written for Anthropic/Sonnet pre-020; 022's `CHAT_MODEL` fallback cannot work post-020; 024/025 dependency mistakes; README dependency graph inconsistent; 004's frontmatter unparseable; dead `.claude/plans/` references). Scripts: `event-sample.ts` destroys hand-labeled gold on re-run with no guard; `ner-gold-normalize.ts` overwrites its own `.bak`; five repair tools and four one-off artifacts need status headers.

## Scope

- Create tickets 026–031 + README index rows; regenerate the dependency graph; delete the stale "019 slots before 010" note.
- Patches to: 004 (frontmatter), 010 (remaining checklist, 429 wording), 011 (Gemini rewrite), 014 (hours/estimate contradiction, wiki note), 015 (AI Gateway step), 016 (pre-split note), 019 (re-ingest cost note), 020 (status review → done on battery), 022 (fallback fail-fast), 024 (drop 014 dep, corrected probe), 025 (split waves, drop 014 dep), 007/021 (.claude/plans annotations).
- Script guards: `event-sample.ts` `--force` gate; `ner-gold-normalize.ts` timestamped backup.
- Archive headers on 5 repair tools (`backfill-arcs`, `delete-chunks`, `ner-merge-collisions`, `ner-gold-normalize`, `event-gold-patch`) + 4 one-offs (`ner-gold-audit`, `event-sample`, `event-debug-1099`, `probe-epub`) per the audit verdict table.

## Out of scope

- Deleting scripts outright (headers only); ticket scope changes beyond the listed patches.

## Deliverables

- Six new ticket files; patched existing tickets; guarded scripts.

## Acceptance criteria

- All ticket frontmatter parses; README ticket row count matches file count.
- `event-sample.ts` refuses to run without `--force` when gold exists.
- No un-annotated `.claude/plans` references; no ticket claims 019 blocks 010.
- `pnpm test` + `pnpm typecheck` green.

## Verification

```bash
pnpm test && pnpm typecheck
grep -rn "claude/plans" docs/tasks/   # only annotated lines
```

## Resolution

- Tickets 026–031 created; README index at 31 rows = 31 files, dependency graph regenerated (010→015 edge added; 024 dep drop; 019 "slots before 010" note removed).
- Patches applied to 004 (frontmatter repair — done during Task 4), 010 (remaining checklist + 429 wording), 011 (Gemini/implicit-cache rewrite), 014 (scope honesty + EPUB-only lore note), 015 (gateway key required + Node floor), 016 (pre-split note), 019 (re-ingest cost note), 020 (→ review, pending 010 battery), 022 (fallback dropped, fail-fast), 024 (dep `[008]`, corrected probe pinned), 025 (waves, dep `[006]`, event-gold absorption), 007/021 (`.claude/plans` annotated machine-local).
- Guards: `event-sample.ts` refuses non-empty gold without `--force` (verified live); `ner-gold-normalize.ts` uses timestamped backups + same-day refusal.
- Commits: `1abb6ab`, `bbd6ea8`, `586cb41`.
