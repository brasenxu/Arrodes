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
 * Input schema for the lookupSummary tool (ticket 026): chapter scope takes a
 * chapter number; arc/volume/series scopes take a label. The two modes are
 * mutually exclusive.
 */
const SUMMARY_SCOPES = ["chapter", "arc", "volume", "series"] as const;

export const SUMMARY_LOOKUP_SCHEMA = z
  .object({
    book: z.enum(["lotm1", "coi"]),
    scope: z.enum(SUMMARY_SCOPES),
    chapterNum: z.number().int().min(1).optional(),
    name: z.string().min(2).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const wantsChapter = val.scope === "chapter";
    if (wantsChapter && val.chapterNum === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scope "chapter" requires chapterNum',
      });
    }
    if (!wantsChapter && val.name === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scope "${val.scope}" requires name`,
      });
    }
    if (wantsChapter && val.name !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scope "chapter" does not take name',
      });
    }
    if (!wantsChapter && val.chapterNum !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scope "${val.scope}" does not take chapterNum`,
      });
    }
  });

/**
 * Spoiler gate for summary rows (and any other position-gated read): a row
 * covering through chapterNum is visible only when the user's position for
 * that book is set and >= chapterNum. Null position gates everything.
 */
export function withinPosition(
  position: ReadingPosition,
  book: keyof ReadingPosition,
  chapterNum: number,
): boolean {
  const ceiling = position[book];
  return ceiling !== null && ceiling !== undefined && chapterNum <= ceiling;
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
