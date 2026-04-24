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

export type EventExtra =
  | ({ event_type: "sequence_advance" } & SequenceAdvanceExtra)
  | ({ event_type: "digestion" } & DigestionExtra)
  | ({ event_type: "meeting" } & MeetingExtra)
  | ({ event_type: "organization_join" } & OrganizationJoinExtra)
  | ({ event_type: "battle" } & BattleExtra)
  | ({ event_type: "death" } & DeathExtra)
  | ({ event_type: "identity_assume" } & IdentityAssumeExtra)
  | ({ event_type: "identity_reveal" } & IdentityRevealExtra);
