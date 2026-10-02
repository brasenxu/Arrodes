import { tool, embed } from "ai";
import { z } from "zod";
import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { createOpenAI } from "@ai-sdk/openai";
import { db, schema } from "@/lib/db/client";
import { hybridSearch } from "./retrieval";
import {
  EVENT_TYPE_FILTER_SCHEMA,
  resolveEntityMatch,
  stripProviderPrefix,
} from "./schemas";
import type { ReadingPosition } from "./types";

// Direct provider wiring (audit defect 6): embeds go straight to OpenAI with
// OPENAI_API_KEY — the same pattern ingest uses — instead of depending on an
// AI Gateway key being present. INGEST_EMBED_MODEL's documented bare form is
// used as-is (namespace stripped defensively).
const openaiProvider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const embedModel = openaiProvider.embedding(
  stripProviderPrefix(
    process.env.INGEST_EMBED_MODEL ?? "text-embedding-3-small",
  ),
);

const bookEnum = z.enum(["lotm1", "coi"]);

/**
 * Build the three RAG tools bound to a session's reading position.
 * Position arrives from the client body; it is shape-validated and clamped
 * to FULL_BOUNDS in the route (server-side session comes with ticket 031).
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
          // Deterministic order (audit defect 2): exact-canonical matches
          // first, then by id — resolveEntityMatch re-checks the same
          // predicate in TS so SQL return order never decides the winner.
          .orderBy(
            dsql`CASE WHEN LOWER(${schema.entities.canonicalName}) = ${needle} THEN 0 ELSE 1 END`,
            schema.entities.id,
          )
          .limit(5);

        if (entityRows.length === 0) return { entity: null, mentions: [] };

        const match = resolveEntityMatch(entityRows, needle);
        if ("ambiguous" in match) {
          return { ambiguous: true, candidates: match.candidates };
        }

        const entity = match.entity;
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
        "Aggregate structured events (Sequence advances, potion digestion, meetings, organization joins, battles, deaths, identity assumes/reveals) filtered by entity and event type. Use for list / count / 'all' queries where top-k retrieval would miss distant mentions. Result is capped at 200 rows ordered by book then chapter; truncated=true tells you rows were dropped.",
      inputSchema: z.object({
        entityName: z.string().min(2),
        eventType: EVENT_TYPE_FILTER_SCHEMA.default("any"),
        books: z.array(bookEnum).default(["lotm1", "coi"]),
      }),
      execute: async ({ entityName, eventType, books }) => {
        const needle = entityName.toLowerCase();
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
          .orderBy(
            dsql`CASE WHEN LOWER(${schema.entities.canonicalName}) = ${needle} THEN 0 ELSE 1 END`,
            schema.entities.id,
          )
          .limit(5);

        if (entityRows.length === 0) return { entity: null, events: [] };

        const match = resolveEntityMatch(entityRows, needle);
        if ("ambiguous" in match) {
          if (match.candidates.length === 0) return { entity: null, events: [] };
          return { ambiguous: true, events: [] };
        }

        const entity = match.entity;

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
          .orderBy(schema.events.bookId, schema.events.chapterNum, schema.events.id)
          .limit(200);

        return { entity, events: rows, truncated: rows.length === 200 };
      },
    }),
  };
}
