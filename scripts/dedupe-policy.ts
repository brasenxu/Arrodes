/**
 * Shared dedupe policies for ticket 030 (used by dedupe-tables.ts and
 * apply-data-dedupe.ts). Each spec: table + an alias-scoped WHERE predicate
 * selecting duplicate rows (keep min id). Distinct roles / distinct snippets
 * are legitimate variety and preserved — see ticket 030's audit notes.
 */
import { sql } from "drizzle-orm";

export const SPECS = [
  {
    table: "summaries",
    where: sql`s WHERE EXISTS (
      SELECT 1 FROM summaries t
      WHERE t.book_id = s.book_id AND t.level = s.level
        AND t.range_start = s.range_start AND t.range_end = s.range_end
        AND t.label = s.label AND t.id < s.id
    )`,
  },
  {
    table: "entity_mentions",
    where: sql`m WHERE EXISTS (
      SELECT 1 FROM entity_mentions t
      WHERE t.chunk_id = m.chunk_id AND t.entity_id = m.entity_id
        AND coalesce(t.role, '') = coalesce(m.role, '')
        AND t.id < m.id
    )`,
  },
  {
    table: "events",
    where: sql`e
      WHERE e.evidence_chunk_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM events t
        WHERE t.entity_id = e.entity_id AND t.event_type = e.event_type
          AND t.evidence_chunk_id = e.evidence_chunk_id
          AND t.evidence_chunk_id IS NOT NULL
          AND t.snippet = e.snippet
          AND t.id < e.id
      )`,
  },
] as const;
