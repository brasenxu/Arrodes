ALTER TABLE "chapters" ADD COLUMN "content_kind" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "content_kind" text DEFAULT 'main' NOT NULL;