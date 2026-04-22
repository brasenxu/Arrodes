CREATE TABLE IF NOT EXISTS "books" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"total_chapters" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chapters" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"volume" integer NOT NULL,
	"volume_name" text NOT NULL,
	"chapter_num" integer NOT NULL,
	"chapter_title" text NOT NULL,
	"raw_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"chapter_id" integer NOT NULL,
	"book_id" text NOT NULL,
	"chapter_num" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"total_chunks" integer NOT NULL,
	"contextual_prefix" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"token_count" integer NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"entity_type" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_spoiler" integer DEFAULT 0 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_mentions" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"chunk_id" integer NOT NULL,
	"book_id" text NOT NULL,
	"chapter_num" integer NOT NULL,
	"role" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"chapter_id" integer NOT NULL,
	"book_id" text NOT NULL,
	"chapter_num" integer NOT NULL,
	"evidence_chunk_id" integer,
	"snippet" text NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"book_id" text NOT NULL,
	"range_start" integer NOT NULL,
	"range_end" integer NOT NULL,
	"label" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chapters" ADD CONSTRAINT "chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chunks" ADD CONSTRAINT "chunks_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_evidence_chunk_id_chunks_id_fk" FOREIGN KEY ("evidence_chunk_id") REFERENCES "public"."chunks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chapters_book_chapter_idx" ON "chapters" USING btree ("book_id","chapter_num");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_book_chapter_idx" ON "chunks" USING btree ("book_id","chapter_num");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entities_canonical_idx" ON "entities" USING btree ("canonical_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_mentions_entity_chapter_idx" ON "entity_mentions" USING btree ("entity_id","chapter_num");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_mentions_chunk_idx" ON "entity_mentions" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_entity_type_idx" ON "events" USING btree ("entity_id","event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_book_chapter_idx" ON "events" USING btree ("book_id","chapter_num");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "summaries_level_book_idx" ON "summaries" USING btree ("level","book_id");