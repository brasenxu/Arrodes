// One-off: verify ticket 030's DDL + migrations sync on the script connection.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

async function main() {
  const indexes = await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE indexname IN ('summaries_natural_key_uq','entity_mentions_chunk_entity_role_uq','events_entity_type_evidence_snippet_uq')
  `);
  const constraint = await db.execute(sql`
    SELECT conname FROM pg_constraint WHERE conname = 'chapters_content_kind_check'
  `);
  const migrations = await db.execute(sql`
    SELECT hash, created_at FROM drizzle.__drizzle_migrations
  `);
  console.log("indexes:", JSON.stringify((indexes as { rows?: unknown[] }).rows));
  console.log("constraint:", JSON.stringify((constraint as { rows?: unknown[] }).rows));
  console.log("migrations:", JSON.stringify((migrations as { rows?: unknown[] }).rows));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
