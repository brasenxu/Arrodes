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
  // Every chunk currently ingested is EPUB-sourced (the chunks table has no
  // source column); wiki/forum values arrive only with ticket 016's ingest.
  source: "epub";
};

export type ReadingPosition = {
  // null = spoiler-free baseline (pre-series);
  // number = inclusive max chapter the user has read
  lotm1: number | null;
  coi: number | null;
};

export const EVENT_TYPES = [
  "sequence_advance",
  "digestion",
  "meeting",
  "organization_join",
  "battle",
  "death",
  "identity_assume",
  "identity_reveal",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type SequenceAdvanceExtra = {
  sequence: number;
  pathway?: string;
  from_sequence?: number;
};

export type DigestionExtra = {
  sequence: number;
  pathway?: string;
  potion?: string;
};

export type MeetingExtra = {
  attendees?: number[]; // entity IDs
};

export type OrganizationJoinExtra = {
  organization_id: number;
  codename?: string;
};

export type BattleExtra = {
  opponent_id?: number;
  location?: string;
  outcome?: string;
};

export type DeathExtra = {
  killed_by_id?: number;
  location?: string;
};

export type IdentityAssumeExtra = {
  identity: string; // string — adopted alias may not have an entity row
  context?: string;
};

export type IdentityRevealExtra = {
  revealed_to_id?: number;
  identity: string;
};

export type EventExtraShapes = {
  [K in EventType]: K extends "sequence_advance"
    ? SequenceAdvanceExtra
    : K extends "digestion"
      ? DigestionExtra
      : K extends "meeting"
        ? MeetingExtra
        : K extends "organization_join"
          ? OrganizationJoinExtra
          : K extends "battle"
            ? BattleExtra
            : K extends "death"
              ? DeathExtra
              : K extends "identity_assume"
                ? IdentityAssumeExtra
                : IdentityRevealExtra;
};

/**
 * The bare extra payload stored in events.extra, keyed by the row's
 * event_type COLUMN value. Audit defect 8: the old union carried an
 * `event_type` key *inside* the payload — the DB never writes that
 * (event_type is its own column; extra is the bare model object).
 */
export type EventExtra = EventExtraShapes[EventType];
