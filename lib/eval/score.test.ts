import { describe, expect, it } from "vitest";
import { scoreEntry, type EvalEntryLite, type RetrievedLite } from "./score";

const entry = (over: Partial<EvalEntryLite>): EvalEntryLite => ({
  id: "Q001",
  book: "lotm1",
  expected_chapters: [245],
  ...over,
});

describe("scoreEntry", () => {
  it("computes recall over unique retrieved chapters", () => {
    const retrieved: RetrievedLite[] = [
      { bookId: "lotm1", chapterNum: 245 },
      { bookId: "lotm1", chapterNum: 245 }, // duplicate chunk
      { bookId: "lotm1", chapterNum: 732 },
    ];
    const s = scoreEntry(entry({ expected_chapters: [245, 732] }), retrieved);
    expect(s.recall).toBe(1);
    expect(s.hitChapters.sort()).toEqual([245, 732]);
  });

  it("partial recall counts expected hits only", () => {
    const retrieved: RetrievedLite[] = [{ bookId: "lotm1", chapterNum: 10 }];
    const s = scoreEntry(entry({ expected_chapters: [245, 732] }), retrieved);
    expect(s.recall).toBe(0);
  });

  it("null recall when no expected chapters", () => {
    const s = scoreEntry(entry({ expected_chapters: [] }), [
      { bookId: "lotm1", chapterNum: 5 },
    ]);
    expect(s.recall).toBe(null);
  });

  it("flags spoiler violations past the position", () => {
    const retrieved: RetrievedLite[] = [
      { bookId: "lotm1", chapterNum: 200 },
      { bookId: "lotm1", chapterNum: 500 },
      { bookId: "coi", chapterNum: 3 },
    ];
    const s = scoreEntry(
      entry({ reading_position: { lotm1: 300, coi: null } }),
      retrieved,
    );
    expect(s.spoilerViolations).toEqual([500]);
  });

  it("unbounded position (null book) never violates", () => {
    const s = scoreEntry(
      entry({ reading_position: { lotm1: null, coi: null } }),
      [{ bookId: "lotm1", chapterNum: 1400 }],
    );
    expect(s.spoilerViolations).toEqual([]);
  });

  it("defaults to unbounded when reading_position is undefined", () => {
    const s = scoreEntry(entry({}), [{ bookId: "coi", chapterNum: 1181 }]);
    expect(s.spoilerViolations).toEqual([]);
  });

  it("honours the entry's book scope: cross-book chunks don't count as expected hits", () => {
    const retrieved: RetrievedLite[] = [
      { bookId: "coi", chapterNum: 245 },
      { bookId: "lotm1", chapterNum: 245 },
    ];
    const s = scoreEntry(entry({ book: "lotm1", expected_chapters: [245] }), retrieved);
    // chapter 245 hit via lotm1 chunk; the coi chunk is out of scope.
    expect(s.recall).toBe(1);
  });
});
