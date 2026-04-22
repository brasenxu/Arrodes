import type { ContentKind } from "@/lib/db/schema";

export type BookId = "lotm1" | "coi";

export type ArcAssignment = {
  volume: number;
  volumeName: string;
  contentKind: ContentKind;
};

type Range = {
  start: number;
  end: number;
  volume: number;
  volumeName: string;
  contentKind: ContentKind;
};

// LOTM1 volumes 1–8 are fully known. Side stories get volume=0 with a
// descriptive volumeName so the SQL group-by on main-story volumes stays clean.
const LOTM1_RANGES: Range[] = [
  { start: 1, end: 213, volume: 1, volumeName: "Clown", contentKind: "main" },
  { start: 214, end: 482, volume: 2, volumeName: "Faceless", contentKind: "main" },
  { start: 483, end: 732, volume: 3, volumeName: "Traveler", contentKind: "main" },
  { start: 733, end: 946, volume: 4, volumeName: "Undying", contentKind: "main" },
  { start: 947, end: 1150, volume: 5, volumeName: "Red Priest", contentKind: "main" },
  { start: 1151, end: 1266, volume: 6, volumeName: "Lightseeker", contentKind: "main" },
  { start: 1267, end: 1353, volume: 7, volumeName: "The Hanged Man", contentKind: "main" },
  { start: 1354, end: 1394, volume: 8, volumeName: "Fool", contentKind: "main" },
  { start: 1395, end: 1402, volume: 0, volumeName: "An Ordinary Person's Daily Life", contentKind: "side_story" },
  { start: 1403, end: 1430, volume: 0, volumeName: "In Modern Day", contentKind: "side_story" },
  { start: 1431, end: 1432, volume: 0, volumeName: "That Corner", contentKind: "side_story" },
];

// COI arc ordering is only partially known — Dream Weaver's volume number is
// not determined, so every COI range uses volume=0 and differentiates by name.
// Unknown main-story stretches collapse into "unmapped"; ticket 014 fills them in.
const COI_RANGES: Range[] = [
  { start: 1, end: 109, volume: 0, volumeName: "Nightmare", contentKind: "main" },
  { start: 110, end: 263, volume: 0, volumeName: "Lightseeker", contentKind: "main" },
  { start: 264, end: 884, volume: 0, volumeName: "unmapped", contentKind: "main" },
  { start: 885, end: 1034, volume: 0, volumeName: "Dream Weaver", contentKind: "main" },
  { start: 1035, end: 1179, volume: 0, volumeName: "unmapped", contentKind: "main" },
  { start: 1180, end: 1180, volume: 0, volumeName: "Author's Afterword", contentKind: "bonus" },
  { start: 1181, end: 1181, volume: 0, volumeName: "Daily Life in Cordu", contentKind: "side_story" },
];

const RANGES_BY_BOOK: Record<BookId, Range[]> = {
  lotm1: LOTM1_RANGES,
  coi: COI_RANGES,
};

export function assignArc(bookId: BookId, chapterNum: number): ArcAssignment {
  if (!Number.isInteger(chapterNum) || chapterNum < 1) {
    throw new Error(`assignArc: chapterNum must be a positive integer, got ${chapterNum}`);
  }
  const ranges = RANGES_BY_BOOK[bookId];
  for (const r of ranges) {
    if (chapterNum >= r.start && chapterNum <= r.end) {
      return { volume: r.volume, volumeName: r.volumeName, contentKind: r.contentKind };
    }
  }
  throw new Error(`assignArc: ${bookId} chapter ${chapterNum} is outside known ranges`);
}
