import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  index,
  uniqueIndex,
  customType,
  timestamp,
} from "drizzle-orm/pg-core";

// pgvector type shim — 1536-dim matches OpenAI text-embedding-3-small.
// Swap dim when switching to Qwen3-Embedding-8B (4096).
const vector = (name: string, { dimensions }: { dimensions: number }) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${dimensions})`,
    toDriver: (value) => `[${value.join(",")}]`,
    fromDriver: (value) =>
      typeof value === "string"
        ? value.slice(1, -1).split(",").map(Number)
        : value,
  })(name);

export const books = pgTable("books", {
  id: text("id").primaryKey(), // 'lotm1' | 'coi'
  title: text("title").notNull(),
  totalChapters: integer("total_chapters").notNull(),
});

export const chapters = pgTable(
  "chapters",
  {
    id: serial("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id),
    volume: integer("volume").notNull(),
    volumeName: text("volume_name").notNull(),
    chapterNum: integer("chapter_num").notNull(),
    chapterTitle: text("chapter_title").notNull(),
    rawText: text("raw_text").notNull(),
  },
  (t) => [uniqueIndex("chapters_book_chapter_idx").on(t.bookId, t.chapterNum)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: serial("id").primaryKey(),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    bookId: text("book_id").notNull(),
    chapterNum: integer("chapter_num").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    totalChunks: integer("total_chunks").notNull(),
    contextualPrefix: text("contextual_prefix").notNull(),
    content: text("content").notNull(),
    // tsvector generated from contextual_prefix || content via SQL trigger
    // (Drizzle doesn't model tsvector natively — handled in migration)
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    tokenCount: integer("token_count").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
  },
  (t) => [
    index("chunks_book_chapter_idx").on(t.bookId, t.chapterNum),
    // HNSW index added via raw SQL migration; Drizzle lacks first-class HNSW
  ],
);

export const entities = pgTable(
  "entities",
  {
    id: serial("id").primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    entityType: text("entity_type").notNull(), // character | organization | pathway | artifact | location
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    isSpoiler: integer("is_spoiler").notNull().default(0), // 0 | 1; boolean as int keeps SQL filter cheap
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
  },
  (t) => [uniqueIndex("entities_canonical_idx").on(t.canonicalName)],
);

export const entityMentions = pgTable(
  "entity_mentions",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    chunkId: integer("chunk_id")
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    bookId: text("book_id").notNull(),
    chapterNum: integer("chapter_num").notNull(),
    role: text("role"), // 'speaker' | 'addressee' | 'mentioned' | null
  },
  (t) => [
    index("entity_mentions_entity_chapter_idx").on(t.entityId, t.chapterNum),
    index("entity_mentions_chunk_idx").on(t.chunkId),
  ],
);

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // 'sequence_advance' | 'death' | 'meeting' | 'identity_reveal' | ...
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    bookId: text("book_id").notNull(),
    chapterNum: integer("chapter_num").notNull(),
    evidenceChunkId: integer("evidence_chunk_id").references(() => chunks.id),
    snippet: text("snippet").notNull(),
    extra: jsonb("extra").$type<Record<string, unknown>>().default({}),
  },
  (t) => [
    index("events_entity_type_idx").on(t.entityId, t.eventType),
    index("events_book_chapter_idx").on(t.bookId, t.chapterNum),
  ],
);

export const summaries = pgTable(
  "summaries",
  {
    id: serial("id").primaryKey(),
    level: text("level").notNull(), // 'chapter' | 'arc' | 'volume' | 'series'
    bookId: text("book_id").notNull(),
    rangeStart: integer("range_start").notNull(),
    rangeEnd: integer("range_end").notNull(),
    label: text("label").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  },
  (t) => [index("summaries_level_book_idx").on(t.level, t.bookId)],
);

export const evalRuns = pgTable("eval_runs", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  results: jsonb("results").$type<unknown[]>().notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
});
