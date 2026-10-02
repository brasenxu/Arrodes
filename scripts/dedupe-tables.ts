/**
 * STATUS: one-off repair (ticket 030) — run once with --yes during the
 * reopening migration; dry-run thereafter is a no-op verification.
 *
 * Deletes DB-level duplicates BEFORE the unique-key migration (ticket 030)
 * so CREATE UNIQUE INDEX cannot fail. Policies:
 *   - summaries: identical (book_id, level, range_start, range_end, label)
 *     → keep min id. (0 dupes at audit time; the index is the real guard.)
 *   - entity_mentions: identical (chunk_id, entity_id, coalesce(role,''))
 *     → keep min id. Distinct roles (speaker vs mentioned) are legitimate
 *     and preserved — 128 multi-role groups exist (audit 2026-10-02).
 *   - events: identical (entity_id, event_type, evidence_chunk_id, snippet)
 *     → keep min id. Distinct snippets for the same key are legitimate
 *     multi-events and preserved (22 such groups exist).
 *
 * Dry-run by default; --yes applies.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { SPECS } from "./dedupe-policy";

const APPLY = process.argv.includes("--yes");

async function main() {
  for (const { table, where } of SPECS) {
    if (APPLY) {
      const result = await db.execute(
        sql`DELETE FROM ${sql.raw(table)} ${where}`,
      );
      const rows = (result as { rows?: Array<{ count?: string }> }).rows ?? [];
      const n = rows[0]?.count ?? "?";
      console.log(`[${table}] deleted ${n} duplicate rows`);
    } else {
      const countResult = await db.execute(
        sql`SELECT count(*) AS count FROM ${sql.raw(table)} ${where}`,
      );
      const rows = (countResult as { rows?: Array<{ count?: string }> }).rows ?? [];
      console.log(`[${table}] DRY-RUN: ${rows[0]?.count ?? "?"} duplicate rows would be deleted (pass --yes)`);
    }
  }

  if (!APPLY) {
    console.log("dry-run complete — no changes made");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
