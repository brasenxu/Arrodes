ALTER TABLE "chapters" ADD COLUMN "arc" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "arc_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapters_book_volume_arc_idx" ON "chapters" USING btree ("book_id","volume","arc");