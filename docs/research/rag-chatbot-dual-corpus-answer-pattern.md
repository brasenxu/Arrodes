# RAG chatbot: dual-corpus reference answer pattern

This note captures a **product and evaluation target** for the Arrodes chatbot: answers that combine **novel text** (Postgres `chunks`, reading position, spoilers) with **wiki grounding** (LOTM fandom wiki MCP or equivalent), and return something **organized and epistemically honest**.

It is inspired by a real exploratory session (Cordu / “lizard-like elves” in *Circle of Inevitability*): dense lore that only makes sense when you **separate layers** and **cite sources**.

## Exemplar session: what we keep in-repo vs in Cursor

**In this file (portable):** the pattern above plus the short **case digest** below — enough for specs, eval rubrics, or onboarding without needing anyone’s private chat export.

**Case digest — CoI “lizard-like elves”**

- **Ask:** Explain the creature / motif; later, full trace through `coi` DB + wiki + Adam / True Creator linkage.
- **Corpora:** `arrodes-ro` SQL over `chunks` (`book_id = 'coi'`); LOTM wiki MCP (`wiki_search`, `wiki_get_page`); parallel subagents for DB sweep and wiki sweep.
- **Answer structure that worked:** distinguish observed scenes (Michel, Aurore), in-world folklore (Ryan ch. 63), Bureau report vs dream (ch. 108), Poet symbolism (chs. 299–300), late physical/theophany beats (e.g. Tree of Shadow, Aurora Order vision, Magician debrief), wiki gaps (no `Michel Garrigue` page; wrong `Michel` disambiguation).
- **Product punchline:** dual-corpus + explicit epistemic tiers matches what Arrodes RAG should aspire to.

**Cursor transcript pointer (local, not in git)**

Full turn-by-turn tooling and replies for that exemplar live in **Cursor’s agent transcript** for this project. Workspace convention: cite the parent chat as [**Cordu lizard-elf RAG exemplar**](08deda1e-70c4-4ace-bd9d-f465e782d8d4) (UUID only; no `.jsonl`). That ID is useful **on the machine/account where the chat was run** (History / transcripts under the project’s `.cursor` tree). It is **not** shipped with the Arrodes repo, so teammates should rely on the **case digest** unless someone **exports** the chat (Markdown / copy) and adds it under `docs/research/` deliberately.

**Portable export in repo**

For cross-tool workflows (Cursor, Claude Code, etc.), use the checked-in export:
`docs/research/cordu-lizard-elf-rag-exemplar.chat.md`.

### Session export appendix (in-repo snapshot)

To keep a portable reference in one place, this appendix captures a concise transcript snapshot from the same parent chat id:
[**Cordu lizard-elf RAG exemplar**](08deda1e-70c4-4ace-bd9d-f465e782d8d4).

- User asked to explain CoI "lizard-like elves" using both sources.
- Assistant queried `arrodes-ro` (`chunks`, `book_id = 'coi'`) and LOTM wiki MCP (`wiki_search`, `wiki_get_page`).
- Assistant ran parallel subagents for DB sweep and wiki sweep, then merged findings.
- Final explanation separated tiers: observed events, folklore framing, Bureau report, dream symbolism, and late-canon linkage.
- Follow-up product discussion identified this as a strong Arrodes RAG target pattern.

If needed, replace this appendix with a full Markdown export of the chat and keep the same parent transcript link above.

## Why dual corpus

| Source | Strength | Weakness |
|--------|----------|------------|
| **Ingested books** | Canonical wording, timeline in narrative order, character POV and ambiguity | No fan-curated cross-links; long-range synthesis needs many chunks |
| **Wiki** | Character lists, event pages, spoilery summaries, citations to book chapters | Fan-edited; can simplify or flatten nuance; wrong disambiguation (e.g. name collisions) |

A strong answer **uses both** and says which claim comes from where.

## Answer shape to aim for

1. **Direct summary** (one short paragraph: what the user asked, in plain language).
2. **Tiered evidence** (explicit headings or bullets), for example:
   - **What characters observe** (quotes or tight paraphrase from `chunks`, with `book_id` + chapter).
   - **In-world documents / folklore** (e.g. investigator telegraph summaries in text).
   - **Institutional or post-hoc analysis** (reports, dream interpretation) when present.
   - **Later canon or high-sequence reveals** when the user’s spoiler tolerance allows it.
3. **Contradictions or uncertainty** — where the text leaves epistemology open (dream vs reality, symbol vs entity), **say so** instead of collapsing to one fan theory.
4. **Wiki cross-check** — page titles consulted; **gaps** (no page, wrong `Michel`, etc.).
5. **Optional “so what”** — one line on thematic or factional reading **only** if grounded in cited text (or labeled clearly as interpretation).

## Anti-patterns to avoid in generated answers

- Treating **wiki** as **canon** without marking it, or vice versa.
- Answering from **one chunk** when the motif is **distributed** across many chapters.
- **Flattening** early folklore + late reveal into a single sentence without nuance.
- Ignoring **reading position** / spoiler policy when the pipeline supports it.

## Possible eval / golden-trace hooks

- Retrieval must return hits from **more than one chapter** for distributed motifs.
- Final answer must include **at least one** `chunks` citation and **wiki status** (hit + page title, or “no dedicated page”).
- Rubric row: **“States uncertainty where the novel does.”**

## Related work in repo

- Ingestion and chunks: task tickets under `docs/tasks/` (e.g. retrieval, summaries, entities).
- Wiki MCP: `tools/wiki-mcp` (server used for LOTM wiki lookups in development).

---

*Last updated: added exemplar session digest, transcript pointer, in-repo appendix, and a portable chat export file.*
