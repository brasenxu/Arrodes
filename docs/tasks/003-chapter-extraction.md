---
id: 003
title: Chapter extraction pipeline
phase: 1
status: done
depends_on: [002]
estimate: M
updated: 2026-04-22
---

## Context

Transform `@gxl/epub-parser` output into normalized `{ book, volume, volumeName, chapterNum, chapterTitle, rawText }` records that write to the `chapters` table. Volume/arc boundaries come from the DAB's arc table (Clown 1–213, Faceless 214–482, …). COI arcs are only partially known — handle the unknowns gracefully.

## Scope

- Build `lib/ingest/chapters.ts` exporting `extractChapters(epubPath, bookId): Promise<ChapterRecord[]>`.
- Arc/volume mapping in a lookup table — start with LOTM1 (fully known) and COI (only Nightmare 1–109, Lightseeker 110–263, Dream Weaver 885–1034 known; others default to `volume: 0, volumeName: "unmapped"`).
- Classify each chapter with `contentKind: 'main' | 'side_story' | 'bonus'` (column lives on `chapters` as of 2026-04-21). Boundaries are authoritative in CLAUDE.md §5; inline here for convenience:
    - LOTM1 1–1394 `main`, 1395–1402 `side_story` (*An Ordinary Person's Daily Life*), 1403–1430 `side_story` (*In Modern Day*), 1431–1432 `side_story` (*That Corner*).
    - COI 1–1179 `main`, 1180 `bonus` (Author's Afterword), 1181 `side_story` (*Daily Life in Cordu*).
- Chunks denormalize `contentKind` from their parent chapter at ingest time (ticket 005). Ticket 003 just needs to get it right on the `chapters` row.
- Strip boilerplate: TOC, cover, translator notes, afterword markers. Probe found LOTM `[0]` is a cover image URL and COI `[0] Cover` + `[1] Information` are pre-chapter front matter — drop sections whose title doesn't match `/^Chapter\s+\d+|第\d+章/i`. COI uses `Chapter N - N: Title` (double-numbered) — chapter-number regex must handle both LOTM and COI formats. Section HTML duplicates the `<h1>` title inside the body; strip leading duplicate title from `rawText` before writing.
- Normalize whitespace (collapse \r\n, strip leading/trailing blank lines per chapter).
- Write `chapters` rows in a single transaction per book.

## Out of scope

- Any chunking or embedding (ticket 005).
- COI arc mapping for Conspirer/Sinner/Demoness/Second Law/Eternal Aeon — leave `unmapped`. Filling these in is rolled into ticket 014 so it happens while the eval-verifier is already reading through COI chapter-by-chapter.

## Deliverables

- `lib/ingest/chapters.ts`.
- `lib/ingest/arc-map.ts` — exported lookup table keyed by `(bookId, chapterNum)`.
- Integration into `scripts/ingest.ts`: `--phase chapters` writes only the chapters table.

## Acceptance criteria

- `pnpm ingest data/epub/LOTM.epub --book lotm1 --phase chapters` produces exactly **1432** rows.
- `pnpm ingest data/epub/COI.epub --book coi --phase chapters` produces exactly **1181** rows.
- `content_kind` distribution matches the boundaries above:
    - LOTM1: 1394 `main`, 38 `side_story`, 0 `bonus`.
    - COI: 1179 `main`, 1 `side_story`, 1 `bonus`.
- `SELECT volume, count(*) FROM chapters WHERE book_id='lotm1' AND content_kind='main' GROUP BY volume;` produces 8 volumes with counts matching the arc table.

## Verification

```bash
psql $DATABASE_URL_UNPOOLED -c "
  SELECT book_id, content_kind, count(*)
  FROM chapters
  GROUP BY book_id, content_kind
  ORDER BY book_id, content_kind;
"

psql $DATABASE_URL_UNPOOLED -c "
  SELECT book_id, volume, volume_name, count(*)
  FROM chapters
  WHERE content_kind = 'main'
  GROUP BY book_id, volume, volume_name
  ORDER BY book_id, volume;
"
```

## Resolution

Closed 2026-04-22. Built test-first with vitest (new dev dep), 72 tests across 3 files — unit suites for `assignArc` and the parsing helpers, integration suite hitting the real EPUBs in `data/epub/`.

### Files
- `lib/ingest/arc-map.ts` — `assignArc(bookId, chapterNum)`, ranges keyed by `(bookId, chapterNum)`.
- `lib/ingest/chapters.ts` — `parseChapterNumber`, `isChapterSection`, `extractSectionTitle`, `cleanChapterBody`, `extractChapters`.
- `lib/ingest/arc-map.test.ts`, `lib/ingest/chapters.test.ts`, `lib/ingest/chapters.integration.test.ts`.
- `scripts/ingest.ts` — `--phase chapters` branch. Upserts `books`, deletes+bulk-inserts `chapters` for that book (cascades to `chunks`). Idempotent; safe to re-run.
- `vitest.config.ts` + `package.json` scripts (`test`, `test:watch`) + vitest/@vitest/ui devDeps.

### Deviations from scope
- LOTM1 side stories use `volume=0` with descriptive `volume_name` (not sequentially numbered 9/10/11). COI uses `volume=0` uniformly since real arc order is unknown — differentiation is via `volume_name` only. Acceptance query only checks LOTM1 main-story volume grouping so this is conformant.
- Neon HTTP driver (via drizzle) doesn't support multi-statement transactions, so chapter writes are `DELETE` then chunked `INSERT` (batch=250). Not atomic across steps, but idempotent: failed mid-run leaves a deterministic prefix that the next run's leading `DELETE` clears. Good enough for a one-shot local ingest; revisit if we move to websocket driver.

### Verification output
```
$ pnpm test
Test Files  3 passed (3)
Tests       72 passed (72)

$ pnpm typecheck
(exit 0)

$ pnpm ingest data/epub/LOTM.epub --book lotm1 --phase chapters
[chapters] parsed 1432 chapters
[chapters] content_kind distribution: { main: 1394, side_story: 38 }
[chapters] chapters row count for lotm1: 1432

$ pnpm ingest data/epub/COI.epub --book coi --phase chapters
[chapters] parsed 1181 chapters
[chapters] content_kind distribution: { main: 1179, bonus: 1, side_story: 1 }
[chapters] chapters row count for coi: 1181

$ psql -c "SELECT book_id, content_kind, count(*) ..."
 book_id | content_kind | count
---------+--------------+-------
 coi     | bonus        |     1
 coi     | main         |  1179
 coi     | side_story   |     1
 lotm1   | main         |  1394
 lotm1   | side_story   |    38

$ psql -c "SELECT book_id, volume, volume_name, count(*) ... WHERE content_kind='main' ..."
 lotm1 | 1 | Clown          | 213
 lotm1 | 2 | Faceless       | 269
 lotm1 | 3 | Traveler       | 250
 lotm1 | 4 | Undying        | 214
 lotm1 | 5 | Red Priest     | 204
 lotm1 | 6 | Lightseeker    | 116
 lotm1 | 7 | The Hanged Man |  87
 lotm1 | 8 | Fool           |  41
```
