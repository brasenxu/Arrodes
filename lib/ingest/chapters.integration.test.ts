import { describe, test, expect, beforeAll } from "vitest";
import { existsSync } from "fs";
import { extractChapters, type ChapterRecord } from "./chapters";

const LOTM_PATH = "data/epub/LOTM.epub";
const COI_PATH = "data/epub/COI.epub";

const haveEpubs = existsSync(LOTM_PATH) && existsSync(COI_PATH);

describe.runIf(haveEpubs)("extractChapters — LOTM1 real EPUB", () => {
  let records: ChapterRecord[];

  beforeAll(async () => {
    records = await extractChapters(LOTM_PATH, "lotm1");
  }, 60_000);

  test("exactly 1432 chapter records", () => {
    expect(records.length).toBe(1432);
  });

  test("chapter numbers are a contiguous 1..1432 run", () => {
    for (let i = 0; i < records.length; i++) {
      expect(records[i].chapterNum).toBe(i + 1);
    }
  });

  test("content_kind distribution: 1394 main / 38 side_story / 0 bonus", () => {
    const counts = { main: 0, side_story: 0, bonus: 0 };
    for (const r of records) counts[r.contentKind]++;
    expect(counts).toEqual({ main: 1394, side_story: 38, bonus: 0 });
  });

  test("main-story volume counts match the DAB arc table", () => {
    const counts = new Map<string, number>();
    for (const r of records) {
      if (r.contentKind !== "main") continue;
      const key = `${r.volume}:${r.volumeName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      "1:Clown": 213,
      "2:Faceless": 269,
      "3:Traveler": 250,
      "4:Undying": 214,
      "5:Red Priest": 204,
      "6:Lightseeker": 116,
      "7:The Hanged Man": 87,
      "8:Fool": 41,
    });
  });

  test("every record has non-empty chapter title and raw text", () => {
    for (const r of records) {
      expect(r.chapterTitle.length).toBeGreaterThan(0);
      expect(r.rawText.length).toBeGreaterThan(0);
    }
  });

  test("raw text does not start with the chapter title", () => {
    const offenders = records.filter((r) => r.rawText.startsWith(r.chapterTitle));
    expect(offenders).toEqual([]);
  });
});

describe.runIf(haveEpubs)("extractChapters — COI real EPUB", () => {
  let records: ChapterRecord[];

  beforeAll(async () => {
    records = await extractChapters(COI_PATH, "coi");
  }, 60_000);

  test("exactly 1181 chapter records", () => {
    expect(records.length).toBe(1181);
  });

  test("chapter numbers are a contiguous 1..1181 run", () => {
    for (let i = 0; i < records.length; i++) {
      expect(records[i].chapterNum).toBe(i + 1);
    }
  });

  test("content_kind distribution: 1179 main / 1 side_story / 1 bonus", () => {
    const counts = { main: 0, side_story: 0, bonus: 0 };
    for (const r of records) counts[r.contentKind]++;
    expect(counts).toEqual({ main: 1179, side_story: 1, bonus: 1 });
  });

  test("ch 1180 is Author's Afterword (bonus)", () => {
    const r = records[1179];
    expect(r.chapterNum).toBe(1180);
    expect(r.contentKind).toBe("bonus");
    expect(r.volumeName).toBe("Author's Afterword");
  });

  test("ch 1181 is Daily Life in Cordu (side_story)", () => {
    const r = records[1180];
    expect(r.chapterNum).toBe(1181);
    expect(r.contentKind).toBe("side_story");
    expect(r.volumeName).toBe("Daily Life in Cordu");
  });

  test("every record has non-empty chapter title and raw text", () => {
    for (const r of records) {
      expect(r.chapterTitle.length).toBeGreaterThan(0);
      expect(r.rawText.length).toBeGreaterThan(0);
    }
  });
});
