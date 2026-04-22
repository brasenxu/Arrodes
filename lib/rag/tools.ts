import { tool, embed } from "ai";
import { z } from "zod";
import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { hybridSearch } from "./retrieval";
import type { ReadingPosition } from "./types";

const embedModel = process.env.INGEST_EMBED_MODEL ?? "openai/text-embedding-3-small";

const bookEnum = z.enum(["lotm1", "coi"]);

/**
 * Build the three RAG tools bound to a session's reading position.
 * Position is passed from the chat route (not trusted from the client).
 */
export function buildTools(position: ReadingPosition) {
  return {
    searchBook: tool({
      description:
        "Hybrid semantic + lexical search over book chunks. Use for passage-level questions, specific dialogue, and open-ended lore that isn't answerable by entity lookup.",
      inputSchema: z.object({
        query: z.string().min(3),
        books: z.array(bookEnum).default(["lotm1", "coi"]),
        limit: z.number().int().min(1).max(20).default(8),
      }),
      execute: async ({ query, books, limit }) => {
        const { embedding } = await embed({ model: embedModel, value: query });
        const results = await hybridSearch({
          queryEmbedding: embedding,
          queryText: query,
          books,
          position,
          limit,
        });
        return { results };
      },
    }),

    lookupEntity: tool({
      description:
        "Look up a character, organization, pathway, or artifact by name/alias. Returns canonical entity, all known aliases, and chapters where the entity appears (bounded by reading position).",
      inputSchema: z.object({
        name: z.string().min(2),
      }),
      execute: async ({ name }) => {
        const needle = name.toLowerCase();
        const entityRows = await db
          .select()
          .from(schema.entities)
          .where(
            dsql`LOWER(${schema.entities.canonicalName}) = ${needle}
              OR EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(${schema.entities.aliases}) a
                WHERE LOWER(a) = ${needle}
              )`,
          )
          .limit(5);

        if (entityRows.length === 0) return { entity: null, mentions: [] };

        const entity = entityRows[0];
        const mentions = await db
          .select({
            bookId: schema.entityMentions.bookId,
            chapterNum: schema.entityMentions.chapterNum,
            chunkId: schema.entityMentions.chunkId,
            role: schema.entityMentions.role,
          })
          .from(schema.entityMentions)
          .where(
            and(
              eq(schema.entityMentions.entityId, entity.id),
              dsql`(
                (${schema.entityMentions.bookId} = 'lotm1' AND ${schema.entityMentions.chapterNum} <= ${position.lotm1 ?? 0})
                OR (${schema.entityMentions.bookId} = 'coi' AND ${schema.entityMentions.chapterNum} <= ${position.coi ?? 0})
              )`,
            ),
          )
          .limit(200);
        return { entity, mentions };
      },
    }),

    aggregateEvents: tool({
      description:
        "Aggregate structured events (Sequence advances, meetings, deaths, identity reveals) filtered by entity and event type. Use for list / count / 'all' queries where top-k retrieval would miss distant mentions.",
      inputSchema: z.object({
        entityName: z.string().min(2),
        eventType: z
          .enum([
            "sequence_advance",
            "death",
            "meeting",
            "identity_reveal",
            "location_change",
            "any",
          ])
          .default("any"),
        books: z.array(bookEnum).default(["lotm1", "coi"]),
      }),
      execute: async ({ entityName, eventType, books }) => {
        const needle = entityName.toLowerCase();
        const [entity] = await db
          .select()
          .from(schema.entities)
          .where(
            dsql`LOWER(${schema.entities.canonicalName}) = ${needle}
              OR EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(${schema.entities.aliases}) a
                WHERE LOWER(a) = ${needle}
              )`,
          )
          .limit(1);

        if (!entity) return { entity: null, events: [] };

        const rows = await db
          .select()
          .from(schema.events)
          .where(
            and(
              eq(schema.events.entityId, entity.id),
              eventType === "any"
                ? dsql`TRUE`
                : eq(schema.events.eventType, eventType),
              inArray(schema.events.bookId, books),
              dsql`(
                (${schema.events.bookId} = 'lotm1' AND ${schema.events.chapterNum} <= ${position.lotm1 ?? 0})
                OR (${schema.events.bookId} = 'coi' AND ${schema.events.chapterNum} <= ${position.coi ?? 0})
              )`,
            ),
          )
          .orderBy(schema.events.bookId, schema.events.chapterNum);

        return { entity, events: rows };
      },
    }),
  };
}
