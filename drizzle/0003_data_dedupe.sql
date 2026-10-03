-- Ticket 030 — delta for the EXISTING live database.
--
-- Context: drizzle/meta (journal + snapshots) was gitignored and lost from
-- the machine, so drizzle-kit no longer knew about 0000-0002 and a fresh
-- full-state migration (0000_low_nightmare.sql) was generated as the new
-- baseline. Fresh clones get EVERYTHING from 0000; this file is the record
-- of what was applied to the existing live DB by scripts/apply-data-dedupe.ts
-- (idempotent statements, safe on fresh clones too).

ALTER TABLE "chapters" DROP CONSTRAINT IF EXISTS "chapters_content_kind_check";
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_content_kind_check" CHECK ("content_kind" IN ('main', 'side_story', 'bonus'));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "summaries_natural_key_uq" ON "summaries" ("book_id","level","range_start","range_end","label");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_mentions_chunk_entity_role_uq" ON "entity_mentions" ("chunk_id","entity_id",coalesce("role", ''));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "events_entity_type_evidence_snippet_uq" ON "events" ("entity_id","event_type","evidence_chunk_id",md5("snippet"));
