# Arrodes Reopening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume the dormant Arrodes LOTM/COI RAG chatbot at Phase-1-complete state and take it to: hardened live chat (ticket 010), pre-computed summaries wired into retrieval (new ticket 026), spoiler-aware position UI + inline citations (011/012/013), eval baseline (014) — with the 2026-10-02 audit's confirmed bugs fixed along the way.

**Architecture:** Next.js 16 App Router + React 19 client (`components/chat.tsx`, `useChat`) → `/api/chat` route (AI SDK v6 `streamText`, tool-calling, `stepCountIs(6)`) → three-to-four RAG tools bound to a server-side reading position → Neon Postgres via Drizzle: `chunks` (pgvector 1536) hybrid search (dense ⊕ sparse, RRF, spoiler pre-filter), `entities`/`entity_mentions`, `events`, `summaries`. Ingestion pipeline is DONE and must not be re-run casually (unique-key hardening comes first).

**Tech Stack:** TypeScript, Next.js 16, React 19, Vercel AI SDK v6 (`ai@^6.0.0`, `@ai-sdk/react@^2.0.0`), Drizzle ORM 0.36 + Neon serverless driver, pgvector, Vitest 4, pnpm 9, Node ≥ 20.19 (dev: 24.x).

**Spec:**
- `docs/tasks/README.md` + tickets 001–025 (the plan of record; statuses and conventions live there)
- `docs/research/LOTM RAG Chatbot - Research & Architecture Doc.md` (problem statement + end-state promises)
- Audit findings 2026-10-02 (three read-only audits, spot-checked) — condensed into "Known defects inventory" below; every fix task references it.

## Known defects inventory (audit 2026-10-02, file:line verified)

1. **HIGH** `aggregateEvents` eventType enum stale: has `location_change` (never written → always 0 rows), missing `digestion`/`organization_join`/`battle`/`identity_assume` (all written by ingest, all unqueryable). Truth = `EVENT_TYPES` at `lib/rag/types.ts:31-40`. `lib/rag/tools.ts:89-98`.
2. **HIGH** Entity resolution first-row-wins, no ORDER BY: `lib/rag/tools.ts:47-61` (limit 5, `entityRows[0]`) and `:103-113` (limit 1). Seed collision cluster exists: pathway canonical `"Fool"` (`data/entities/aliases.json:1301-1316`) vs Klein aliases `"The Fool"`/`"Mr. Fool"` (`:21-23`). Also `entities_canonical_idx` is case-sensitive while all lookups are case-insensitive.
3. **MED** Chat route trusts client body wholesale: `body.position ?? {lotm1:1396, coi:1180}` unvalidated (spoiler bypass = send `{lotm1: 999999}`; partial position `{lotm1:50}` → `position.coi === undefined` reaches SQL; non-numeric → SQL type errors). `app/api/chat/route.ts:32-35`. Comment `lib/rag/tools.ts:14` ("not trusted from the client") is false.
4. **MED** No request-body validation: `req.json()` unguarded → 500 on malformed; client `system`-role messages pass through `convertToModelMessages` → prompt injection past SYSTEM_PROMPT. `app/api/chat/route.ts:25-40`.
5. **MED** `aggregateEvents` returns unbounded, unordered rows (`lib/rag/tools.ts:117-135`) — context blowup risk under `stepCountIs(6)`.
6. **MED** Chat-time embed model resolution fragile: `lib/rag/tools.ts:8` feeds `INGEST_EMBED_MODEL` raw to AI Gateway; the **bare** ID format documented in `.env.example:19-24` fails with `GatewayModelNotFoundError`. Works today only because `.env.local` happens to use gateway format. `.env.example:9-12` also misdocuments `AI_GATEWAY_API_KEY` as "unused" — it is load-bearing for every chat request.
7. **MED** `chunking.ts` chunk-order inversion on oversized paragraphs: `lib/rag/chunking.ts:49-59` pushes sentence-split chunks before flushing the buffer → final `flush()` (line 86) emits earlier paragraphs after the big one; `chunk_index` out of narrative order (already-ingested data affected; fix code, do NOT re-chunk now).
8. **LOW** `EventExtra` union dead + wrong: `lib/rag/types.ts:86-94` puts `event_type` *inside* the extra payload; DB writes bare extra (`{sequence, ...}`), `event_type` is its own column; zero importers repo-wide. Stale comment `lib/db/schema.ts:139`.
9. **LOW** Stale source model: `RetrievedChunk.source` allows `"wiki" | "forum"` but `chunks` has no source column; `retrieval.ts:135` hardcodes `"epub"`; SYSTEM_PROMPT tells the model to prefer wiki/forum sources that don't exist.
10. **LOW** `GOOGLE_GENERATIVE_AI_API_KEY` read by nothing (chat routes via gateway; `@ai-sdk/google` not a dependency). `.env.example:17`.
11. **DATA** No unique keys on `summaries`, `entity_mentions`, `events` — idempotency is app-level only; read-side `dedupeSummaryRows` (`lib/ingest/summaries.ts:621`) is evidence duplicates already exist in Neon. Ticket 023 covers summaries only.
12. **DATA** `summaries` meta reconstructed from mutable `chapters` rows (`lib/ingest/summaries.ts:562-619`); `validateSummaryDbRow` throws on mixed metadata → re-run after any arc rewrite can crash the summaries phase.
13. **DOC/TICKET** statuses: 020 `done` but its chat-route AC was deferred to 010 (never smoke-tested); 010 `todo` correct but its pre-work checklist is buried mid-ticket; 004 frontmatter malformed; 023 frontmatter `phase: 1` vs README "Phase 5"; README dependency graph omits `010→015` and `024` edges; 010↔019 "slots before 010" note contradicts 010's `depends_on`.
14. **DOC/TICKET** stale premises: 022's `INGEST_SUMMARY_MODEL → CHAT_MODEL` fallback logs then throws on any non-DeepSeek ID (`lib/ingest/summaries.ts:210-228`); 011 written for Anthropic-style cache_control + Sonnet, now Gemini 2.5 Flash (implicit caching); 015 references AI Gateway env step contradicting `.env.example`; 024's `depends_on: [008, 014]` over-couples an S-ticket to an L-ticket; 025's `depends_on: [014, 019]` inverts its own stated sequencing.
15. **GAP** `summaries` table fully populated (2,613 chapter + 71 arc + 16 volume + 2 series rows) but **no ticket ever wires it into retrieval/chat** — the architecture doc's "summarize chapter 245 / what is the Red Priest arc about → pre-computed summaries" promise is unowned. → ticket 026.
16. **GAP** `scripts/eval.ts:33` is a stub ("Not implemented yet"); `data/eval/eval-set.jsonl`: 40 entries all `status: draft`, 19 with empty `expected_chapters` → ticket 014 is implement-the-runner + author-the-set, not just "run a sweep".

## Global Constraints

- Node ≥ 20.19 (vitest 4 + rolldown floor); dev runs 24.x; pnpm 9 via `corepack prepare pnpm@9.0.0 --activate`. Record in `package.json` `"engines"`.
- Package manager: `pnpm`. Use existing `package.json` scripts; do not invent parallel script names.
- Never commit `.env*`, `data/epub/*.epub`, `.mcp.json`, credentials/DSNs from MCP config.
- `docs/` is intentionally gitignored (local-only plan of record). Do not "fix" this without the user's say-so.
- Ticket discipline (docs/tasks/README.md conventions): flip frontmatter `status` + `updated` date, update the README index table, add a `## Resolution` section when closing.
- Citation format is pinned exactly: `(LOTM1 Ch.N)` / `(COI Ch.N)` — ticket 013's UI regex `/\((LOTM1|COI) Ch\.(\d+)\)/g` depends on this casing. SYSTEM_PROMPT must state it verbatim.
- Reading position semantics: `number` = inclusive max chapter read; `null` = not started; values may exceed main counts (LOTM1 main=1396, full incl. side/bonus=1432; COI main=1180, full=1181) — side_story/bonus chapters are only reachable at positions above main counts.
- Canon discipline: for canon-sensitive claims (pathways, sequences, aliases, identities), wiki-first evidence; never silently assert uncertain canon in seeds/extract/eval artifacts.
- Single source of truth: import `EVENT_TYPES`/`EventType` from `lib/rag/types.ts`; import book bounds from `lib/ingest/arc-map.ts` (add exports there); never re-declare these inline.
- No new dependencies unless the current stack cannot cover the need. `zod`, `drizzle-orm`, `ai` cover everything in this plan.
- Do NOT re-run `pnpm ingest --phase chapters/ner/events` during this plan; do NOT re-chunk. The dedupe migration (Task 19) must precede any future re-ingest.

## Review Focus

Failure modes the ticket specs imply but no task's tests fully exercise — each is pinned by the named task's test/verification step:

1. Ambiguous alias ("Fool", "Hermit", "Black Emperor") → tool returns `{ambiguous: true, candidates: [...]}`, never silently the wrong entity's events. → Task 9 test.
2. One book read, other null → results still flow from the read book; both null → empty results, no SQL error. → Task 9/11 tests + battery.
3. Malformed body / forged `system` role → 400 / stripped, not 500 or injected context. → Task 11 test.
4. Provider 429 / gateway auth failure mid-stream → friendly one-line UI error + server-side log, not a raw JSON wall. → Task 12 + battery.
5. "Summarize chapter 245" / "what is the Red Priest arc about" → routes to `lookupSummary`, not `searchBook`. → Task 15 battery item.
6. Any ingest re-run after this plan → zero duplicate rows in summaries/entity_mentions/events. → Task 20 verification.

---

# Phase 0 — Tooling & docs (tickets 027, 028)

## Task 1: engines field + green-suite baseline (ticket 027 part 1)

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `"engines": { "node": ">=20.19", "pnpm": ">=9" }` — referenced by AGENTS.md (Task 3) and ticket 015 later.

- [ ] **Step 1:** Add to `package.json` (top level, after `packageManager`):

```json
"engines": { "node": ">=20.19", "pnpm": ">=9" }
```

- [ ] **Step 2:** Verify: `pnpm test && pnpm typecheck` → 200 passed / 14 skipped, typecheck clean.
- [ ] **Step 3:** Commit: `chore: record node>=20.19 / pnpm>=9 engine floors`

## Task 1b: Commit the docs/ tree (user-approved 2026-10-02)

**Files:**
- Modify: `.gitignore` (remove the `docs/` ignore line)
- Commit: `docs/` as it stands (tickets, research, superpowers plans/specs)

- [ ] **Step 1:** Remove the `docs/` line (and its comment) from `.gitignore`.
- [ ] **Step 2:** `git add docs/ .gitignore`; verify with `git status --short docs/ | Measure-Object -Line` that the tree stages; check no secrets-sized files (nothing > ~1MB, no `.env`-like names).
- [ ] **Step 3:** Commit: `docs: stop ignoring docs/ — ticket tracker + research + plans travel with git`

## Task 2: OpenCode MCP port (ticket 027 part 2)

**Files:**
- Create: `opencode.json` (repo root)
- Modify: `.env.example` (line 5 comment only)

**Interfaces:**
- Consumes: existing scripts `tools/mcp/run-postgres-mcp.ts`, `tools/wiki-mcp/src/server.ts`; env `ARRODES_MCP_DATABASE_URL` (documented in `.env.example:7`).
- Produces: OpenCode-local MCP servers `arrodes-ro` + `lotm-wiki` (same names as `.cursor/mcp.json`).

- [ ] **Step 1:** Check OpenCode's current MCP config format (opencode skill / docs) — confirm `mcp` section shape for local servers before writing.
- [ ] **Step 2:** Write `opencode.json` registering both servers as `local` commands: `["npx", "-y", "tsx", "tools/mcp/run-postgres-mcp.ts"]` and `["npx", "-y", "tsx", "tools/wiki-mcp/src/server.ts"]`. No credentials in the file (env supplies the DSN).
- [ ] **Step 3:** Verify: OpenCode lists both MCP servers; run one read-only `arrodes-ro` query (e.g. `SELECT COUNT(*) FROM chunks`) — expect a number, not an error.
- [ ] **Step 4:** Update `.env.example:5` comment: "Read-only MCP (OpenCode `opencode.json` runs tools/mcp/run-postgres-mcp.ts)."
- [ ] **Step 5:** Keep `.cursor/` untouched (user decision — gitignored anyway). Commit: `chore(mcp): register arrodes-ro + lotm-wiki in opencode.json`

## Task 3: Curated AGENTS.md (ticket 027 part 3)

**Files:**
- Create: `AGENTS.md` (repo root)

- [ ] **Step 1:** Write `AGENTS.md` with exactly these sections (curated from the six `.cursor/rules/*.mdc`):
  1. **Project** — one paragraph: LOTM/COI chapter-grounded RAG chatbot; spoiler control is product-critical.
  2. **Stack & commands** (from `stack-and-commands.mdc`, verbatim core) + added line: Node ≥ 20.19 / pnpm 9 via corepack (see `package.json` engines).
  3. **Data & eval rules** (merged from `data-and-ingestion-constraints.mdc` + `lotm-canon-validation.mdc`): pre-filter before ranking; SQL/Drizzle `sql` template for pgvector/CTE/tsquery; model IDs from env; eval bar = `pnpm typecheck` + `pnpm eval:validate` minimum; canon discipline (wiki-first, no silent uncertain canon).
  4. **MCP boundaries** (from `mcp-usage.mdc`, updated): prefer MCP for live DB/wiki lookups; read-first before code changes; `arrodes-ro` is read-only; never commit DSNs.
  5. **Workflow & git** (trimmed from `workflow-and-planning.mdc`): follow existing naming/patterns; avoid new deps; explicit error handling; when closing a ticket, patch stale downstream references first; no tool-attribution lines in commits.
  - Dropped: `plugin-vs-rule-ownership.mdc` (Cursor-plugin-specific; safety policy is the harness's job, not the repo's).
- [ ] **Step 2:** Verify: AGENTS.md ≤ ~60 lines; every rule traces to one of the five kept .mdc files; nothing invented beyond the Node/engines line.
- [ ] **Step 3:** Commit: `docs: add curated AGENTS.md (port of .cursor/rules)`

## Task 4: New ticket files + tracker index (ticket 028 part 1)

**Files:**
- Create: `docs/tasks/026-summary-retrieval-tool.md`, `027-tooling-port-opencode.md`, `028-docs-and-script-hygiene.md`, `029-chat-ux-basics.md`, `030-data-dedupe-migration.md`, `031-server-side-position-and-auth.md`
- Modify: `docs/tasks/README.md` (index rows + dependency-graph notes)

**Interfaces:**
- Produces: frontmatter in the new files — `026` `phase: 2, depends_on: [008, 010], estimate: M`; `027` `phase: 0 (meta), depends_on: [], estimate: S`; `028` `phase: 0 (meta), depends_on: [], estimate: S`; `029` `phase: 3, depends_on: [010], estimate: S/M`; `030` `phase: 5, depends_on: [003, 005, 006, 007, 008], estimate: M`, supersedes 023; `031` `phase: backlog, depends_on: [012, 017], estimate: M`.

- [ ] **Step 1:** Create the six ticket files. Content per ticket: Context (1 paragraph, citing the audit finding numbers above), Scope bullets, Out of scope, Deliverables, Acceptance criteria, Verification command. Copy acceptance criteria from this plan's corresponding task.
- [ ] **Step 2:** In 030's body, note it **supersedes 023**; flip 023 frontmatter to `status: done` with Resolution "superseded by 030 (scope expanded to three tables)". Fix 023 frontmatter `phase: 5`.
- [ ] **Step 3:** README index: add rows for 026–031; delete the stale backlog note "`019 … slots before 010`" (010's `depends_on` stays `[005, 006, 007, 009]`; 019 stays in backlog); regenerate the dependency graph text block from frontmatter edges (must include `010→015`, `024: 008→024` only, `026: 008+010→026`).
- [ ] **Step 4:** Verify: every ticket file parses as YAML frontmatter (`---` … `---` with no `##` inside); README table row count matches file count (31 tickets).
- [ ] **Step 5:** Commit: `docs(tasks): add tickets 026-031, fix stale statuses/index`

## Task 5: Doc patches to existing tickets (ticket 028 part 2)

**Files:**
- Modify: `docs/tasks/004-entity-alias-seed.md`, `010-chat-tools-live.md`, `011-prompt-caching.md`, `014-eval-verification.md`, `015-vercel-deploy.md`, `016-wiki-and-rerank.md`, `019-speaker-attribution-preprocessor.md`, `020-provider-migration-gemini.md`, `022-summaries-rollup-provider-flexibility.md`, `024-summaries-semantic-sanity-baseline.md`, `025-ner-gold-audit-and-dialogue-expansion.md`

- [ ] **Step 1:** `004`: repair frontmatter — remove the `##` prefix inside the YAML block so it parses (`id: 004`, `status: done`, `depends_on: []`, `estimate: M`).
- [ ] **Step 2:** `010`: add a top-level `## Remaining checklist` section enumerating: enum fix (defect 1), ambiguity guard (defect 2), position/body validation (defects 3-4), bounded aggregateEvents (defect 5), embed resolution + `.env.example` truthing (defect 6), EventExtra/source-union cleanup (defects 8-9), error surfacing, 10-question battery. Replace the stale "Sonnet rejects with 429" line with "chat provider 429".
- [ ] **Step 3:** `011`: rewrite Scope/ACs for reality — chat model is `google/gemini-2.5-flash` via AI Gateway (implicit caching, no `cache_control` markers); deliverable = verify caching evidence + document; delete Sonnet/dashboard-token-count ACs.
- [ ] **Step 4:** `014`: delete the "~3–5 hours" Context sentence (contradicts the `L` estimate and real scope: implement eval.ts + eval-helper.ts + author 19 missing `expected_chapters` + promote 40 draft entries). Add scope note: lore entries verify EPUB-only for now; wiki cross-verification deferred until 016.
- [ ] **Step 5:** `015`: delete the AI Gateway env step (contradicts `.env.example` + audit defect 6 note); add note that Node version on Vercel must satisfy the engines floor.
- [ ] **Step 6:** `016`: add pre-split note "L — split likely (016a wiki ingest / 016b source-priority / 016c cross-encoder)".
- [ ] **Step 7:** `019`: add Scope note "full-corpus NER re-ingest for both books is the cost driver (paid, hours) — plan for it".
- [ ] **Step 8:** `020`: flip `status: done` → `status: review`; append Resolution line: "chat-route AC explicitly deferred to ticket 010; `google/gemini-2.5-flash` resolves via AI Gateway (`AI_GATEWAY_API_KEY`); smoke test happens when 010's battery runs — 020 closes then."
- [ ] **Step 9:** `022`: rewrite the fallback requirement — drop `CHAT_MODEL` fallback; fail fast with actionable error ("set INGEST_SUMMARY_MODEL"); keep INGEST_SUMMARY_MODEL provider-flexibility scope.
- [ ] **Step 10:** `024`: change `depends_on: [008, 014]` → `[008]`; pin the corrected probe query from the 008 spec: "Klein kills Lanevus after Audrey reports the clue" (not "Klein meets Audrey" — contradicted by `docs/superpowers/specs/2026-05-02-hierarchical-summaries-design.md:159`).
- [ ] **Step 11:** `025`: split waves — `depends_on: [014, 019]` → `[006]` (thin gold pass) with body note "wave 2 (dialogue expansion) after 019"; event-gold expansion (007's carried-forward gaps: `organization_join`/`identity_reveal` 0 labels, `sequence_advance` 1 noisy label) gets a Scope bullet in 025 wave 2 or its own follow-up if it won't fit.
- [ ] **Step 12:** `007`/`021`: annotate References — `.claude/plans/*` paths are gone (machine-local); `lib/ingest/arc-map.ts` is now the sole authoritative arc canon.
- [ ] **Step 13:** Verify: `grep -r "claude/plans" docs/tasks/` returns only annotated lines; no ticket claims 019 blocks 010.
- [ ] **Step 14:** Commit: `docs(tasks): patch stale premises post-020 (audit findings 13-14)`

## Task 6: Script hygiene (ticket 028 part 3)

**Files:**
- Modify: `scripts/event-sample.ts`, `scripts/ner-gold-normalize.ts`, `scripts/delete-chunks.ts`, `scripts/backfill-arcs.ts`, `scripts/ner-merge-collisions.ts`, `scripts/event-gold-patch.ts`, `scripts/ner-gold-audit.ts`, `scripts/event-debug-1099.ts`, `scripts/probe-epub.ts`

- [ ] **Step 1:** `event-sample.ts`: add a `--force` guard that refuses to regenerate `data/eval/event-gold.jsonl` if the file exists and is non-empty (it would destroy hand-labeled gold — audit finding: destructive, unguarded).
- [ ] **Step 2:** `ner-gold-normalize.ts`: timestamp the `.bak` (`ner-gold.jsonl.bak-YYYYMMDDHHmm`) instead of overwriting; refuse to run if a same-day backup exists without `--force`.
- [ ] **Step 3:** Header comments (3 lines: STATUS, WHY, SAFE-TO-RUN?) on the 5 repair tools (`backfill-arcs`, `delete-chunks`, `ner-merge-collisions`, `ner-gold-normalize`, `event-gold-patch`) and 4 one-offs (`ner-gold-audit`, `event-sample`, `event-debug-1099`, `probe-epub`) per the audit verdict table. `delete-chunks.ts` header must state plainly: "BROKEN against live data (chunk_id=0 assumptions) — do not run until rewritten."
- [ ] **Step 4:** Verify: `pnpm test && pnpm typecheck` still green (headers + guards are additive).
- [ ] **Step 5:** Commit: `chore(scripts): guard gold-destructive re-runs, archive headers (audit findings)`

---

# Phase 1 — Ticket 010: chat hardening

## Task 7: Extract testable schemas + failing tests

**Files:**
- Create: `lib/rag/schemas.ts` (pure — no db imports)
- Create: `lib/rag/schemas.test.ts`

**Interfaces:**
- Consumes: `EVENT_TYPES`, `EventType` from `lib/rag/types.ts`.
- Produces (Tasks 8-11 consume):
  - `export const EVENT_TYPE_FILTER_SCHEMA = z.enum(EVENT_TYPES).or(z.literal("any"))` — the corrected aggregateEvents eventType schema
  - `export function normalizeEmbedModelId(id: string): string` — bare `text-embedding-3-small` → `openai/text-embedding-3-small`; any id containing `/` passes through unchanged
  - `export function isValidPosition(p: unknown): p is ReadingPosition` — `{lotm1: int ≥ 0 | null, coi: int ≥ 0 | null}` shape check

- [ ] **Step 1:** Write `lib/rag/schemas.test.ts`:
  - `EVENT_TYPE_FILTER_SCHEMA` accepts all 8 `EVENT_TYPES` values + `"any"`, rejects `"location_change"` (the regression pin for defect 1).
  - `normalizeEmbedModelId("text-embedding-3-small")` → `"openai/text-embedding-3-small"`; `"openai/text-embedding-3-small"` unchanged; `"deepseek/deepseek-v4-flash"` unchanged.
  - `isValidPosition({lotm1: 100, coi: null})` true; `{lotm1: 50}` (missing coi) false; `{lotm1: -1, coi: 0}` false; `{lotm1: 1.5, coi: 0}` false; `"x"` false.
- [ ] **Step 2:** Run: `pnpm test lib/rag/schemas.test.ts` → FAIL (module doesn't exist).
- [ ] **Step 3:** Commit the test: `test(rag): pin corrected event-type filter + embed-id + position schemas (red)`

## Task 8: Implement schemas + wire enum fix into tools

**Files:**
- Create: `lib/rag/schemas.ts` (implementation)
- Modify: `lib/rag/tools.ts:8, 84-100`

- [ ] **Step 1:** Implement `schemas.ts` (one module, three exports; zod only).
- [ ] **Step 2:** In `tools.ts`: import `EVENT_TYPE_FILTER_SCHEMA`; replace the inline `z.enum([...])` at `:89-98` with it; update `aggregateEvents`'s `description` to the full 8-type vocabulary.
- [ ] **Step 3:** Replace `:8` with `normalizeEmbedModelId(process.env.INGEST_EMBED_MODEL ?? "text-embedding-3-small")` (note: default is now bare, normalized at use).
- [ ] **Step 4:** Run: `pnpm test lib/rag/schemas.test.ts && pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit: `fix(rag): aggregateEvents enum from EVENT_TYPES; robust embed model id (audit 1, 6)`

## Task 9: Deterministic + ambiguity-aware entity resolution

**Files:**
- Modify: `lib/rag/tools.ts` (both lookupEntity and aggregateEvents paths)
- Modify: `lib/rag/schemas.ts` + `lib/rag/schemas.test.ts` (add pure resolver)

**Interfaces:**
- Produces: `export function resolveEntityMatch(rows: EntityRow[], needle: string): { entity: EntityRow } | { ambiguous: true; candidates: EntityRow[] }` in `lib/rag/schemas.ts` — exact canonical match wins (case-insensitive); alias matches tie-break by lower entity `id`; >1 remaining distinct matches → `{ambiguous: true, candidates}`.
- Tool return shapes: `lookupEntity` no-match stays `{entity: null, mentions: []}`; ambiguous returns `{ambiguous: true, candidates: [...]}` (no mentions). `aggregateEvents` ambiguous → `{ambiguous: true, events: []}`.

- [ ] **Step 1:** Add failing tests: exact-canonical beats alias; two alias-only matches → ambiguous with both candidates; single match → `{entity}`; ordering is deterministic (same input array, same output).
- [ ] **Step 2:** Run → FAIL. Implement `resolveEntityMatch`. Run → PASS.
- [ ] **Step 3:** Rewire both query paths in `tools.ts`: add deterministic `.orderBy()` (exact-canonical-first CASE expression, then `id`) and call `resolveEntityMatch` on the (small) result set instead of `entityRows[0]`.
- [ ] **Step 4:** Run full `pnpm test` + typecheck → PASS.
- [ ] **Step 5:** Commit: `fix(rag): deterministic entity resolution + ambiguous candidates (audit 2)`

## Task 10: Bound and order aggregateEvents output

**Files:**
- Modify: `lib/rag/tools.ts:117-135`

- [ ] **Step 1:** Add `.orderBy(schema.events.bookId, schema.events.chapterNum, schema.events.id)` and `.limit(200)`; return `{ entity, events: rows, truncated: rows.length === 200 }`.
- [ ] **Step 2:** Update the tool description to mention the 200-event cap so the model can say "truncated" honestly.
- [ ] **Step 3:** Verify: `pnpm typecheck`; live check deferred to battery (Task 13).
- [ ] **Step 4:** Commit: `fix(rag): bound + order aggregateEvents rows (audit 5)`

## Task 11: Chat route hardening (position, body, types cleanup)

**Files:**
- Modify: `app/api/chat/route.ts:15-45`
- Modify: `lib/rag/tools.ts:14` (comment), `lib/rag/types.ts:21, 86-94` (EventExtra, source union), `lib/db/schema.ts:139` (comment)

**Interfaces:**
- Consumes: `isValidPosition` (Task 8); book bounds from `lib/ingest/arc-map.ts` (add `export const MAIN_BOUNDS` / `FULL_BOUNDS: Record<BookId, number>` = `{lotm1: 1396/1432, coi: 1180/1181}` — verify exact values against `arc-map.test.ts` before exporting).
- Produces: route rejects malformed bodies with 400; position is clamped to `FULL_BOUNDS`.

- [ ] **Step 1:** Add arc-map bounds exports; note in arc-map.test.ts (or a new assert) pinning `MAIN_BOUNDS.lotm1 === 1396`, `FULL_BOUNDS.lotm1 === 1432`, `MAIN_BOUNDS.coi === 1180`, `FULL_BOUNDS.coi === 1181`.
- [ ] **Step 2:** `route.ts`: wrap `req.json()` in try/catch → `Response 400`; require `Array.isArray(body.messages)`; zod-validate `body.position` via `isValidPosition`, else 400; clamp each non-null value to `FULL_BOUNDS[book]`; default (no position) stays the current dev default until ticket 012 ships (documented, not silent).
- [ ] **Step 3:** Strip client-supplied `system`-role messages from `body.messages` before `convertToModelMessages` (defect 4).
- [ ] **Step 4:** Types cleanup: delete `EventExtra`'s in-payload `event_type` key variant (or delete the whole union — it has zero importers; prefer delete + a mapping type `{[K in EventType]: ...extra shapes}` kept for future use); fix `schema.ts:139` comment to list the real 8 types; trim `RetrievedChunk.source` to just `"epub"` and drop the "prefer wiki over forum" line from SYSTEM_PROMPT.
- [ ] **Step 5:** Fix `tools.ts:14` comment to state the truth: "Position arrives from the client body; validated + clamped in the route (server-side session comes with ticket 031)."
- [ ] **Step 6:** Run: `pnpm test && pnpm typecheck` → PASS. Commit: `fix(chat): validate body + clamp position; types cleanup (audit 3, 4, 8, 9)`

## Task 12: Minimal error surfacing in chat UI

**Files:**
- Modify: `components/chat.tsx`

- [ ] **Step 1:** Destructure `error` from `useChat()`; when set, render one friendly line ("Something went wrong talking to the model — try again. (Details in server console)").
- [ ] **Step 2:** For tool parts with `state === "output-error"`, render a one-line "tool failed" chip instead of the raw JSON dump.
- [ ] **Step 3:** Verify: `pnpm build` passes; full UX (persistence/stop/regenerate) is ticket 029, not here.
- [ ] **Step 4:** Commit: `fix(ui): surface chat + tool errors instead of raw JSON (audit 10)`

## Task 12b: Direct provider wiring (battery blocker — audit defect 6 confirmed live)

**Files:**
- Modify: `lib/rag/schemas.ts` + `lib/rag/schemas.test.ts` (replace `normalizeEmbedModelId` with `stripProviderPrefix`)
- Create: `lib/rag/chat-model.ts` + `lib/rag/chat-model.test.ts`
- Modify: `lib/rag/tools.ts` (embed → direct OpenAI provider), `app/api/chat/route.ts` (chat model via resolver), `package.json` (`@ai-sdk/google`), `.env.example` (key truthing)

**Ruling:** the battery failed on `AI Gateway authentication failed: No authentication provided` — `AI_GATEWAY_API_KEY` is absent from `.env.local` and the audit's "works by accident" concern is confirmed live (the chat route has never executed). Fix: direct provider keys the user already has. `@ai-sdk/google` is a justified new dependency — ticket 020's deliverable "if using Gemini, wire @ai-sdk/google" was never landed, and no existing dep constructs a Gemini model object. Gateway format remains supported when `AI_GATEWAY_API_KEY` is present and the id is namespaced. Cost if wrong: one dependency + a small resolver, both reversible.

- [ ] **Step 1 (RED):** tests for `stripProviderPrefix` (`"openai/text-embedding-3-small"` → bare; bare → bare; `"google/gemini-2.5-flash"` → `"gemini-2.5-flash"`) and `resolveChatModel` (gateway key + namespaced id → string passthrough; no gateway key → google provider instance with `modelId === "gemini-2.5-flash"`).
- [ ] **Step 2:** GREEN implementation.
- [ ] **Step 3:** Wire tools.ts + route.ts; `pnpm add @ai-sdk/google`; `.env.example` truthing (`AI_GATEWAY_API_KEY` optional; `GOOGLE_GENERATIVE_AI_API_KEY` required for chat; embed id bare form).
- [ ] **Step 4:** Full suite + typecheck + build; commit; resume battery.

## Task 13: 10-question battery → close tickets 010 + 020

**Files:**
- Modify: `docs/tasks/010-chat-tools-live.md` (Findings + status), `docs/tasks/020-provider-migration-gemini.md` (Resolution backfill), `docs/tasks/README.md` (index)
- Modify (if tuning needed): `app/api/chat/route.ts` (SYSTEM_PROMPT only)

- [ ] **Step 1:** `pnpm dev`; run the battery from 010's checklist: chapter summary ("What happens in chapter 245?"), lore/pathway, character lookup, named-entity ambiguity probe ("Fool"), list/count ("list all Tarot Club meetings" / deaths), dialogue, side-story probe, both-null position (expect graceful empty), one-book-null position, error-path (unset AI_GATEWAY_API_KEY once to confirm friendly failure, then restore).
- [ ] **Step 2:** Confirm each tool fires (`tool-searchBook`, `tool-lookupEntity`, `tool-aggregateEvents` in UI parts) and citations render as `(LOTM1 Ch.N)`-style text.
- [ ] **Step 3:** Tune SYSTEM_PROMPT only for observed failures (tool-first routing, citation format pinned verbatim). No scope beyond 010.
- [ ] **Step 4:** Paste the transcript into 010's `## Findings`; flip 010 `done`. Backfill 020's Resolution with the gateway-resolution answer; flip 020 `review` → `done`.
- [ ] **Step 5:** Update README index rows. Commit: `docs(tasks): 010 battery transcript, close 010 + 020`

---

# Phase 1.5 — Ticket 026: summary retrieval tool

## Task 14: `lookupSummary` tool

**Files:**
- Modify: `lib/rag/tools.ts` (add 4th tool in `buildTools`)
- Modify: `lib/rag/schemas.ts` + `lib/rag/schemas.test.ts`

**Interfaces:**
- Consumes: `summaries` table (`level`, `bookId`, `rangeStart`, `rangeEnd`, `label`, `content`, `embedding`; `lib/db/schema.ts:155-168`); `ReadingPosition`.
- Produces: tool `lookupSummary` input `{ book: "lotm1" | "coi", scope: "chapter" | "arc" | "volume" | "series", chapterNum?: int, name?: string }` → output `{ summaries: [{level, label, rangeStart, rangeEnd, content}] }`.

- [ ] **Step 1:** Add failing schema tests: `scope="chapter"` requires `chapterNum`; `scope ∈ {arc, volume, series}` requires `name`; position gate constants.
- [ ] **Step 2:** Implement executor: `scope="chapter"` → select chapter row (`level="chapter"`, bookId, `rangeStart ≤ chapterNum ≤ rangeEnd`) plus its parent `arc` row (same book, enclosing range), both gated by `rangeEnd ≤ position[book]` (null position → `{summaries: []}`); `scope="arc"|"volume"|"series"` → case-insensitive `label` match, position-gated, `.limit(5)`, deterministic order.
- [ ] **Step 3:** Run tests → PASS; typecheck.
- [ ] **Step 4:** Commit: `feat(rag): lookupSummary tool over pre-computed hierarchical summaries (ticket 026)`

## Task 15: Prompt routing + battery + close 026

**Files:**
- Modify: `app/api/chat/route.ts` (SYSTEM_PROMPT)
- Modify: `docs/tasks/026-summary-retrieval-tool.md`, `docs/tasks/README.md`

- [ ] **Step 1:** Add routing rule: "For 'summarize chapter N' or arc/volume/series overview questions, call `lookupSummary` first; fall back to `searchBook` only if no summary matches."
- [ ] **Step 2:** Battery additions: "What happens in chapter 245?" (chapter summary path), "What is the Red Priest arc about?" (arc path), chapter past position (expect refusal, not a spoiler), arc not yet reached (same).
- [ ] **Step 3:** Flip 026 `done` with Resolution; update README index. Commit: `docs(tasks): close 026 — summaries wired into chat`

---

# Phase 2 — Tickets 011, 012, 013

## Task 16: Ticket 011 — prompt caching (Gemini reality)

**Files:**
- Modify: `docs/tasks/011-prompt-caching.md` (scope already rewritten in Task 5), ticket status flip
- Possibly modify: `app/api/chat/route.ts` (prompt ordering only if evidence demands)

- [ ] **Step 1:** Implement verification, not configuration: Gemini 2.5 Flash caches implicitly; deliverable = evidence note in 011's Findings (gateway/turn counts showing cached-token reuse across a multi-turn session with stable system prompt + tool defs).
- [ ] **Step 2:** If evidence shows the system prompt is stable across turns (it is — static string), record AC met; otherwise propose the minimal change that stabilizes prefix bytes (e.g. move position values out of any dynamic preamble).
- [ ] **Step 3:** Flip 011 `done` with Resolution. Commit: `docs(tasks): 011 implicit-cache verification note`

## Task 17: Ticket 012 — reading-position UI

**Files:**
- Create: `lib/client/position.ts`, `components/reading-position.tsx`
- Modify: `components/chat.tsx` (thread position; disable chat when both null), `app/page.tsx` (modal guard), `docs/tasks/012-reading-position-ui.md` (scope patch + status)

**Interfaces:**
- Produces: `usePosition(): { position: ReadingPosition | null; setPosition; hasBeenSet: boolean; openModal }` over `localStorage.arrodes.position` (`{lotm1, coi, updatedAt}`); `sendMessage` body gains `position`.
- 017 seam (audit finding): the hook reserves a **session-only** override flag (`spoilMe`, NOT persisted) so ticket 017's in-session "spoil me" affordance doesn't rework the modal later.

- [ ] **Step 1:** Scope patch to 012 first: slider max = `FULL_BOUNDS` (1432/1181) with main-chapter tick at 1396/1180 labeled "end of main story"; "I've finished this book" → `FULL_BOUNDS`; "I haven't started" → `null`; add the 017 seam line.
- [ ] **Step 2:** Implement `lib/client/position.ts` (pure read/write + hook; localStorage try/catch for SSR).
- [ ] **Step 3:** Implement `components/reading-position.tsx` per ticket spec (first-visit modal, two sliders, toggles, pencil re-open in header, both-null → chat disabled with a set-position prompt).
- [ ] **Step 4:** Wire into `chat.tsx`/`page.tsx`; every `sendMessage` carries `position`.
- [ ] **Step 5:** Route change: `body.position` becomes **required** (400 without it) — remove the dev default; verify `pnpm dev` flow end-to-end with a fresh localStorage.
- [ ] **Step 6:** Verify per 012's ACs (fresh visit → modal; slider persists across reload; disabled chat at both-null). Flip 012 `done`. Commit: `feat(ui): reading-position spoiler slider (ticket 012)`

## Task 18: Ticket 013 — inline citation rendering

**Files:**
- Create: `lib/client/citations.ts`, `components/citation.tsx`
- Modify: `components/chat.tsx` (text parts through the parser)
- Modify: `docs/tasks/013-citation-rendering.md` (status)

**Interfaces:**
- Consumes: pinned citation format `(LOTM1 Ch.N)` / `(COI Ch.N)`; tool results in `message.parts` (correlate by `(bookId, chapterNum)`, highest score wins).
- Produces: `parseCitations(text): Array<{kind: "text", value} | {kind: "citation", book: BookId, chapterNum}>` — stream-safe (incomplete trailing token → text).

- [ ] **Step 1:** Failing tests first (`lib/client/citations.test.ts`): two citations same chapter parse; mid-stream partial `(LOTM1 Ch.2` renders as text (parser emits it as a text token); mixed book labels; adjacent punctuation.
- [ ] **Step 2:** Implement parser + correlator; implement `Citation` popover (chapter title + top-1 chunk excerpt ~200 chars; "copy link" placeholder button).
- [ ] **Step 3:** Wire into `chat.tsx`; verify live: multi-citation answer, hover popover, no stream flicker.
- [ ] **Step 4:** Flip 013 `done`. Commit: `feat(ui): inline citation pills with chunk popovers (ticket 013)`

## Task 19: Ticket 029 — chat UX basics (optional but small)

**Files:**
- Modify: `components/chat.tsx` (stop button, regenerate-on-error, explicit ephemeral-chat note or persistence decision)
- Modify: `docs/tasks/029-chat-ux-basics.md`

- [ ] **Step 1:** Decide + record: chat history stays ephemeral (localStorage persistence is a post-015 nicety) — write the decision into 029.
- [ ] **Step 2:** Implement: stop button (AI SDK `stop()`), regenerate last response on error, empty-state hint.
- [ ] **Step 3:** Flip 029 `done`. Commit: `feat(ui): stop/regenerate + error retry (ticket 029)`

---

# Phase 3 — Ticket 030: data dedupe migration (before any future ingest re-run)

## Task 20: Migration + idempotent inserts

**Files:**
- Create: `drizzle/000X_data_dedupe.sql` (via `pnpm db:generate` after schema edit)
- Modify: `lib/db/schema.ts` (unique indexes), `lib/ingest/summaries.ts`, `lib/ingest/ner.ts`, `lib/ingest/events.ts` (ON CONFLICT paths), `lib/rag/chunking.ts` (flush-order fix), `.gitignore` (un-ignore `drizzle/meta/`)

**Interfaces:**
- Produces: DB-enforced uniqueness: `summaries (book_id, level, range_start, range_end)`, `entity_mentions (chunk_id, entity_id)`, `events (entity_id, event_type, evidence_chunk_id)`; `content_kind` CHECK constraint.

- [ ] **Step 1:** First fix `chunking.ts:49-59`: in the `paraTokens > MAX_TOKENS` branch, `flush()` the buffer **unconditionally before** pushing sentence chunks (restores `chunk_index` narrative order). Unit test: a chapter with small-para + oversized-para + small-para yields strictly increasing content order matching input. Do NOT re-chunk the DB in this plan.
- [ ] **Step 2:** Pre-dedupe script (one-off, `scripts/dedupe-tables.ts`): for each of the 3 tables, delete duplicate rows keeping min `id` (summaries keyed on the natural key above; events on `(entity_id, event_type, evidence_chunk_id)`), print before/after counts. Dry-run by default, `--yes` to apply.
- [ ] **Step 3:** Add unique indexes + `CHECK (content_kind IN ('main','side_story','bonus'))` to `lib/db/schema.ts` via drizzle `uniqueIndex()`/`check()`; `pnpm db:generate`; review the generated SQL.
- [ ] **Step 4:** Update the three insert paths to `onConflictDoNothing()` (entity_mentions may `onConflictDoUpdate` role — check with the user's 006/025 intent first; default to DO NOTHING).
- [ ] **Step 5:** Un-ignore `drizzle/meta/` in `.gitignore` and commit it (migrations must be reproducible on a fresh clone — audit ingest finding #10).
- [ ] **Step 6:** Apply: `pnpm db:migrate` against Neon; run the dedupe script `--yes`; record before/after row counts in ticket 030 Resolution.
- [ ] **Step 7:** Verify: `pnpm test && pnpm typecheck` green; re-running the dedupe script is a no-op (counts unchanged). Flip 030 `done`. Commit: `feat(db): unique keys + CHECK for summaries/mentions/events; chunk-order fix (ticket 030)`

---

# Phase 4 — Ticket 014: eval baseline

## Task 21: Implement eval runner + author eval set + baseline

**Files:**
- Modify: `scripts/eval.ts` (replace the `:33` stub), create `scripts/eval-helper.ts` (per 014's scope), `data/eval/eval-set.jsonl` (author 19 missing `expected_chapters`, promote drafts)
- Modify: `docs/tasks/014-eval-verification.md` (Results + status)

**Interfaces:**
- Consumes: `lib/eval/types.ts` (matches `eval-set.jsonl` on disk); `pnpm eval:validate` gate; `eval_runs` table (`lib/db/schema.ts:170-178`) for baseline storage.

- [ ] **Step 1:** Implement `eval-helper.ts` + `eval.ts` per 014's scope (retrieval verification: expected_chapters hit rate, citation validity, no-spoiler violation check) — follow the existing scorer patterns in `scripts/ner-score.ts` / `scripts/event-score.ts`.
- [ ] **Step 2:** Author the 19 empty `expected_chapters` entries (canon discipline: wiki-first evidence, EPUB confirm; lore entries EPUB-only per Task 5 Step 4 note). Run `pnpm eval:validate` after every batch.
- [ ] **Step 3:** Promote all 40 entries `status: draft` → final; fix `Q035` expected_entity ("Benson Moretti" — flagged in 007).
- [ ] **Step 4:** Baseline run with current CHAT_MODEL; persist to `eval_runs`; record summary numbers in 014's Resolution.
- [ ] **Step 5:** Verify: `pnpm eval:validate` green; baseline numbers recorded. Flip 014 `done`. Commit: `feat(eval): eval runner + authored eval set + baseline (ticket 014)`

## Task 22 (OPTIONAL, user decision): Ticket 015 — Vercel deploy

**Files:**
- Modify: Vercel project settings (outside repo), `docs/tasks/015-vercel-deploy.md`

- [ ] **Step 1:** Confirm Vercel Node version ≥ 20.19 (matches engines floor; audit Task 5 fixed the stale gateway step).
- [ ] **Step 2:** Set env vars in Vercel: `DATABASE_URL(_UNPOOLED)`, `ARRODES_MCP_DATABASE_URL` (if MCP used there — probably not), `AI_GATEWAY_API_KEY` (load-bearing for chat — defect 6), `CHAT_MODEL`, `INGEST_EMBED_MODEL`.
- [ ] **Step 3:** Deploy; run the 10-question battery against the deployed URL; flip 015 `done`.
- [ ] **Step 4:** Commit: `docs(tasks): close 015`

---

## Execution order & dependency notes

- Tasks 1-6 (Phase 0) are independent of each other except Task 4 before Task 5's ticket edits reference 026-031; Task 2 needs an OpenCode format check first.
- Phase 1 tasks are sequential (7→8→9→10→11→12→13) — they share `tools.ts`/`route.ts`.
- Task 14-15 (026) need Task 13's prompt-tuning baseline so the routing rule lands on a stable prompt.
- Tasks 16-19 (Phase 2) are independent of each other; 012 before 013 is convenient (citations correlate with tool results either way).
- Task 20 (030) can run any time after Phase 0, but NOT after any re-ingest.
- Task 21 (014) wants the hardened chat + 026 tool so the baseline measures the real product.
- Task 22 (015) last, optional, user-gated.
