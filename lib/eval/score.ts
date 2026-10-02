/**
 * Pure eval scoring (ticket 014): recall@k over expected_chapters plus
 * spoiler-leak violation detection. Independent of DB/LLM — fully unit
 * tested; the runner (scripts/eval.ts) feeds it retrieval results.
 */
import type { BookId } from "@/lib/rag/types";

export type EvalEntryLite = {
  id: string;
  book: BookId | "both";
  expected_chapters: number[];
  reading_position?: { lotm1: number | null; coi: number | null } | undefined;
};

export type RetrievedLite = { bookId: BookId; chapterNum: number };

export type EntryScore = {
  id: string;
  /** null when the entry declares no expected chapters. */
  recall: number | null;
  expectedCount: number;
  hitChapters: number[];
  /** Retrieved chapters beyond the entry's reading position (hard fails). */
  spoilerViolations: number[];
};

const FULL_BOUNDS: Record<BookId, number> = { lotm1: 1432, coi: 1181 };

function ceilingFor(
  entry: EvalEntryLite,
  book: BookId,
): number | null {
  const p = entry.reading_position;
  // Undefined position or null book value = user finished / unbounded.
  if (!p) return null;
  const v = p[book];
  return v === null || v === undefined ? null : v;
}

export function scoreEntry(
  entry: EvalEntryLite,
  retrieved: RetrievedLite[],
): EntryScore {
  // Books in scope for this entry.
  const inScope = (book: BookId) =>
    entry.book === "both" || entry.book === book;

  const relevant = retrieved.filter((r) => inScope(r.bookId));
  const uniqueChapters = [...new Set(relevant.map((r) => r.chapterNum))];

  const hitSet = new Set(uniqueChapters);
  const hitChapters = entry.expected_chapters.filter((c) => hitSet.has(c));

  const spoilerViolations: number[] = [];
  const violationSeen = new Set<number>();
  for (const r of relevant) {
    const ceiling = ceilingFor(entry, r.bookId);
    if (ceiling !== null && r.chapterNum > ceiling && !violationSeen.has(r.chapterNum)) {
      violationSeen.add(r.chapterNum);
      spoilerViolations.push(r.chapterNum);
    }
  }

  return {
    id: entry.id,
    recall:
      entry.expected_chapters.length === 0
        ? null
        : hitChapters.length / entry.expected_chapters.length,
    expectedCount: entry.expected_chapters.length,
    hitChapters,
    spoilerViolations,
  };
}
