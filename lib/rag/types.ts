export type BookId = "lotm1" | "coi";

export type QueryType =
  | "chapter_summary"
  | "lore"
  | "character"
  | "pathway"
  | "timeline"
  | "dialogue"
  | "aggregation";

export type RetrievedChunk = {
  id: number;
  bookId: BookId;
  chapterNum: number;
  chapterTitle: string;
  chunkIndex: number;
  content: string;
  contextualPrefix: string;
  score: number;
  source: "epub" | "wiki" | "forum";
};

export type ReadingPosition = {
  // null = spoiler-free baseline (pre-series);
  // number = inclusive max chapter the user has read
  lotm1: number | null;
  coi: number | null;
};
