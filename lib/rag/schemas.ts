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
 * Ingest/eval scripts call provider SDKs directly with a bare model id
 * ("deepseek-v4-flash", "text-embedding-3-small"); config docs record the
 * bare form. Strip any "provider/" namespace so direct provider SDK calls
 * always receive the bare id. (Audit defect 6 — inverse of the old
 * gateway-side normalization.)
 */
export function stripProviderPrefix(id: string): string {
  return id.replace(/^[^/]+\//, "");
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

/**
 * Minimal structural shape needed to resolve an entity among candidates.
 * Full DB rows satisfy this structurally.
 */
export type EntityMatchRow = {
  id: number;
  canonicalName: string;
  aliases: string[];
};

export type EntityMatch<T extends EntityMatchRow> =
  | { entity: T }
  | { ambiguous: true; candidates: T[] };

/**
 * Deterministic entity resolution among pre-filtered candidate rows.
 *
 * Audit defect 2: both lookup tools used to take `rows[0]` with no ORDER BY —
 * Postgres returns ties in arbitrary order, so ambiguous names ("Fool" is
 * both a pathway canonical and a Klein alias) silently resolved to the wrong
 * entity. Policy here: an exact case-insensitive canonical match wins; among
 * alias-only matches (or duplicate canonicals), ties are ambiguous rather
 * than arbitrary.
 */
export function resolveEntityMatch<T extends EntityMatchRow>(
  rows: T[],
  needle: string,
): EntityMatch<T> {
  const n = needle.toLowerCase();
  const byId = (a: T, b: T) => a.id - b.id;

  const canonical = rows
    .filter((r) => r.canonicalName.toLowerCase() === n)
    .sort(byId);
  if (canonical.length === 1) return { entity: canonical[0] };
  if (canonical.length > 1) return { ambiguous: true, candidates: canonical };

  const aliasOnly = rows
    .filter((r) => r.aliases.some((a) => a.toLowerCase() === n))
    .sort(byId);
  if (aliasOnly.length === 1) return { entity: aliasOnly[0] };
  return { ambiguous: true, candidates: aliasOnly };
}
