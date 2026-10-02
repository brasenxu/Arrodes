import { z } from "zod";
import { EVENT_TYPES, type ReadingPosition } from "./types";

/**
 * Tool-level filter schema for aggregateEvents. Sourced from EVENT_TYPES
 * (lib/rag/types.ts) — the single source of truth shared with the ingest
 * pipeline — plus "any" for unfiltered queries. Audit defect 1: the old
 * inline enum had drifted (stale "location_change", four real types missing).
 */
export const EVENT_TYPE_FILTER_SCHEMA = z
  .enum(EVENT_TYPES)
  .or(z.literal("any"));

/**
 * Chat-time embed model IDs resolve through the AI Gateway, which requires
 * the "provider/model" form. Ingestion strips the prefix and calls provider
 * SDKs directly, so the documented bare format is safe there — but the chat
 * path needs it re-namespaced. Bare ids are assumed OpenAI embeddings (the
 * only embedding provider in the stack); anything already namespaced passes
 * through unchanged. (Audit defect 6.)
 */
export function normalizeEmbedModelId(id: string): string {
  if (id.includes("/")) return id;
  return `openai/${id}`;
}

/**
 * Shape-check for a client-supplied ReadingPosition. Both books must be
 * present and either null (not started) or a non-negative integer. Partial
 * positions are rejected — a missing book previously reached SQL params as
 * `undefined` and silently dropped that book's results. (Audit defect 3.)
 */
const POSITION_BOOK = z.union([z.null(), z.number().int().min(0)]);

export function isValidPosition(p: unknown): p is ReadingPosition {
  const result = z
    .object({ lotm1: POSITION_BOOK, coi: POSITION_BOOK })
    .strict()
    .safeParse(p);
  return result.success;
}
