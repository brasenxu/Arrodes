# Cordu lizard-elf RAG exemplar chat export

This file is a repo-tracked, cross-tool reference export of the exploratory chat used by
`docs/research/rag-chatbot-dual-corpus-answer-pattern.md`.

- Parent transcript id: [Cordu lizard-elf RAG exemplar](08deda1e-70c4-4ace-bd9d-f465e782d8d4)
- Source: Cursor session transcript (sanitized; tool internals redacted in places)
- Purpose: make this example portable to non-Cursor workflows (Claude Code, etc.)

## Conversation highlights (exported)

### User
Use LOTM wiki plus `arrodes-ro` MCP to explain what the "lizard-like elf" are.

### Assistant
Initial response mixed CoI and LotM1 context, then clarified with:
- In CoI, "lizard-like elf" is folklore framing for parasite-like entities, not Ancient Elf race.
- Key anchor: Ryan's report (ch. 63) and observed phenomena around Michel/Aurore.

### User
No, I meant CoI specifically. Then requested a very thorough pass:
- Use chapters in DB and wiki
- Start multiple subagents
- Be liberal with MCP verification

### Assistant
Ran broad and targeted `arrodes-ro` SQL + LOTM wiki lookups and parallel subagent sweeps.
Synthesis separated evidence tiers:
- observed events (Michel, Aurore, mouth-exit creature behavior)
- in-world folklore/document framing (Ryan dossier)
- Bureau report and dream-symbolic interpretation
- later canon/factional interpretation and True Creator linkage
- explicit wiki gaps/disambiguation issues

### User
Asked if this represents True Creator/Adam influence.

### Assistant
Answered: broadly yes at late-story convergence level, while earlier layers remain mixed and not a
simple one-to-one "every lizard equals Adam" claim.

### User
Noted this is a strong Arrodes RAG use case and asked to keep research notes in docs.

### Assistant
Created `docs/research/rag-chatbot-dual-corpus-answer-pattern.md` and added exemplar guidance.

## Why keep this export in-repo

- Cursor transcript IDs are local-account dependent.
- Repo markdown is tool-agnostic and reviewable in git history.
- Future agents (Cursor/Claude/other) can reuse the exact case context without digging in local
  transcript storage.

## Maintenance note

If the underlying session evolves, update this file and keep the same parent transcript link for
traceability.

