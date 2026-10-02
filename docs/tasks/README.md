# Arrodes Task Tracker

One ticket per file in this directory: `{NNN}-{kebab-slug}.md`. Each ticket has YAML frontmatter with `status`; update this index whenever a status changes.

Statuses: `todo` | `in-progress` | `blocked` | `review` | `done`.

Estimate units: `S` (<half day), `M` (half–full day), `L` (multi-day).

## Phase 0 — Tooling & docs (meta)

| # | Ticket | Status | Est | Depends on |
|---|---|---|---|---|
| 027 | [Tooling port — OpenCode MCP + curated AGENTS.md](027-tooling-port-opencode.md) | done | S | — |
| 028 | [Docs + script hygiene (audit findings 13-14 + script guards)](028-docs-and-script-hygiene.md) | done | S | — |

## Phase 1 — Ingestion & retrieval core

| # | Ticket | Status | Est | Depends on |
|---|---|---|---|---|
| 001 | [Neon provisioning & env wiring](001-neon-provisioning.md) | done | S | — |
| 002 | [EPUB sanity probe](002-epub-sanity-probe.md) | done | S | — |
| 003 | [Chapter extraction pipeline](003-chapter-extraction.md) | done | M | 002 |
| 004 | [Entity alias seed data](004-entity-alias-seed.md) | done | M | — |
| 005 | [Contextual retrieval + embed + chunk insert](005-contextual-retrieval-ingest.md) | done | L | 001, 003 |
| 006 | [NER pass → entities, entity_mentions](006-ner-entity-mentions.md) | done | M | 004, 005 |
| 007 | [Event extraction → events table](007-event-extraction.md) | done | M | 006 |
| 008 | [Hierarchical summaries](008-hierarchical-summaries.md) | done | M | 005, 021 |
| 009 | [Hybrid retrieval integration test](009-hybrid-retrieval-test.md) | done | S | 005 |
| 019 | [Speaker attribution preprocessor](019-speaker-attribution-preprocessor.md) | todo | M | 006 |
| 021 | [Arc-level metadata schema](021-arc-metadata-schema.md) | done | M | 005 |

## Phase 2 — Chat backend

| # | Ticket | Status | Est | Depends on |
|---|---|---|---|---|
| 010 | [Chat route — live tool wiring](010-chat-tools-live.md) | done | M | 005, 006, 007, 009 |
| 026 | [Summary retrieval tool (lookupSummary)](026-summary-retrieval-tool.md) | done | M | 008, 010 |
| 011 | [Prompt caching (system + glossary)](011-prompt-caching.md) | todo | S | 010 |

## Phase 3 — Frontend

| # | Ticket | Status | Est | Depends on |
|---|---|---|---|---|
| 012 | [Reading position slider (spoiler control UI)](012-reading-position-ui.md) | todo | M | 010 |
| 013 | [Inline citation rendering](013-citation-rendering.md) | todo | S | 010 |
| 029 | [Chat UX basics — stop, regenerate, error retry](029-chat-ux-basics.md) | todo | S/M | 010 |

## Phase 4 — Eval + deploy

| # | Ticket | Status | Est | Depends on |
|---|---|---|---|---|
| 014 | [Eval verification sweep + baseline run](014-eval-verification.md) | todo | L | 003, 005, 009 |
| 015 | [Vercel deploy (Hobby tier)](015-vercel-deploy.md) | todo | S | 010, 012, 014 |

## Phase 5 — Later

| # | Ticket | Status | Est | Depends on |
|---|---|---|---|---|
| 016 | [Wiki + source-priority + cross-encoder rerank](016-wiki-and-rerank.md) | todo | L | 014 |
| 020 | [Provider migration — Anthropic → DeepSeek V4 / Gemini](020-provider-migration-gemini.md) | done | S | — || 022 | [Summaries rollup provider flexibility](022-summaries-rollup-provider-flexibility.md) | todo | S | 008, 020 |
| 023 | [Summaries dedupe hardening (DB unique key)](023-summaries-dedupe-unique-key.md) | done | M | 008 |
| 024 | [Summaries semantic sanity baseline](024-summaries-semantic-sanity-baseline.md) | todo | S | 008 |
| 030 | [Data dedupe migration — unique keys ×3 tables + content_kind CHECK](030-data-dedupe-migration.md) | todo | M | 003, 005, 006, 007, 008 |

## Backlog (deferred)

| # | Ticket | Status | Est | Depends on | Notes |
|---|---|---|---|---|---|
| 017 | [Entity-level reveal gating](017-entity-reveal-gating.md) | deferred | M | 004, 006, 012 | Schema change. Un-defer if app goes public. |
| 018 | [Entity consolidation (aliases, canonical coverage, type gaps)](018-entity-consolidation.md) | todo | M | 006 | Identified during 006. Adds artifact + location rows, completes sequence-title aliases, resolves Tarot/pathway name overlaps. |
| 025 | [NER gold audit + targeted dialogue expansion](025-ner-gold-audit-and-dialogue-expansion.md) | todo | M | 006 | Audit current 26-chunk gold, re-adjudicate ambiguous roles, and expand dialogue-heavy eval coverage. Wave 1 (thin pass) runs before 019; wave 2 (dialogue expansion) after 019. |
| 031 | [Server-side reading position + auth](031-server-side-position-and-auth.md) | deferred | M | 012, 017 | Un-defer when app goes public. Position integrity, rate limiting, tool-part provenance. |

---

## Dependency graph (quick view)

```
001 ──────────┐
002 ──► 003 ──┼─► 005 ──┬─► 006 ──► 007 ──┐
004 ──────────┘         ├─► 021 ──► 008   │
                        └─► 009 ──────────┤
                                         ▼
                                        010 ──┬─► 011
                                              ├─► 012 ──► 015
                                              ├─► 013
                                              ├─► 026 (also ← 008)
                                              └─► 029
                                         014 ──► 015
                                         014 ──► 016
                                         003 ──► 014
                                         010 ──► 015 (frontmatter edge)
003+005+006+007+008 ──► 030 (supersedes 023)

phase-0 meta: 027 (done), 028 (in-progress) — no code deps

backlog: 017 (entity reveal gating) — depends on 004, 006, 012
         018 (entity consolidation) — depends on 006
         019 (speaker attribution preprocessor) — depends on 006
         021 (arc-level metadata schema) — depends on 005, blocks 008 (both done)
         022 (summaries rollup provider flexibility) — depends on 008, 020
         024 (summaries semantic sanity baseline) — depends on 008
         025 (NER gold audit + targeted dialogue expansion) — depends on 006 (wave 2 after 019)
         031 (server-side position + auth) — depends on 012, 017
```

Note: 023 is closed as **superseded by 030** (scope expanded to three tables; see its Resolution).

## Conventions

- When starting a ticket: set `status: in-progress`, update the date, update this index.
- When blocked: set `status: blocked`, add a `## Blocker` section to the ticket body.
- When done: set `status: done`, add a `## Resolution` section with the PR links (if any), file diffs summary, and anything deviant from the original plan.
- Deviations: if scope expanded or shrank mid-ticket, document in the ticket body before closing — do not silently re-scope.
