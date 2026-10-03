// One-off: check entity resolution for "fool" on the script connection.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

async function main() {
  const rows = await db.execute(sql`
    SELECT id, canonical_name, entity_type FROM entities
    WHERE LOWER(canonical_name) = 'fool'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(aliases) a WHERE LOWER(a) = 'fool')
    ORDER BY CASE WHEN LOWER(canonical_name) = 'fool' THEN 0 ELSE 1 END, id
    LIMIT 5
  `);
  console.log("matches:", JSON.stringify((rows as { rows?: unknown[] }).rows));
  const foolRows = await db.execute(sql`
    SELECT id, canonical_name FROM entities WHERE canonical_name ILIKE '%fool%' ORDER BY id LIMIT 10
  `);
  console.log("fool-named:", JSON.stringify((foolRows as { rows?: unknown[] }).rows));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
