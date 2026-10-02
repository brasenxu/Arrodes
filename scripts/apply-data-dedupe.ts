/**
 * STATUS: one-off repair (ticket 030) — applies the dedupe + constraint
 * delta to the EXISTING live Neon DB and syncs drizzle.__drizzle_migrations
 * with the regenerated journal baseline (0000_low_nightmare).
 *
 * DRY-RUN by default (counts + statement preview); --yes applies:
 *   1. dedupe-tables policies (summaries / entity_mentions / events)
 *   2. the 4 constraint statements from drizzle/0003_data_dedupe.sql
 *   3. __drizzle_migrations: reset to one row matching the journal baseline,
 *      so future `pnpm db:migrate` entries apply cleanly.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { SPECS } from "./dedupe-policy";

const APPLY = process.argv.includes("--yes");

const DELTA_STATEMENTS = [
  `ALTER TABLE "chapters" DROP CONSTRAINT IF EXISTS "chapters_content_kind_check"`,
  `ALTER TABLE "chapters" ADD CONSTRAINT "chapters_content_kind_check" CHECK ("content_kind" IN ('main', 'side_story', 'bonus'))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "summaries_natural_key_uq" ON "summaries" ("book_id","level","range_start","range_end","label")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "entity_mentions_chunk_entity_role_uq" ON "entity_mentions" ("chunk_id","entity_id",coalesce("role", ''))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "events_entity_type_evidence_snippet_uq" ON "events" ("entity_id","event_type","evidence_chunk_id",md5("snippet"))`,
];

// Must match drizzle/meta/_journal.json's baseline entry.
const BASELINE = {
  when: 1790976543364,
  tag: "0000_low_nightmare",
};

async function main() {
  if (!APPLY) {
    console.log("DRY-RUN (pass --yes to apply):");
    for (const { table, where } of SPECS) {
      const countResult = await db.execute(
        sql`SELECT count(*) AS count FROM ${sql.raw(table)} ${where}`,
      );
      const rows = (countResult as { rows?: Array<{ count?: string }> }).rows ?? [];
      console.log(`  [${table}] ${rows[0]?.count ?? "?"} duplicate rows would be deleted`);
    }
    for (const s of DELTA_STATEMENTS) {
      console.log(`  [ddl] ${s.slice(0, 90)}...`);
    }
    console.log("  [drizzle] __drizzle_migrations would be reset to the journal baseline");
    console.log("dry-run complete — no changes made");
    process.exit(0);
  }

  console.log("APPLYING (--yes)…");
  for (const { table, where } of SPECS) {
    const result = await db.execute(
      sql`DELETE FROM ${sql.raw(table)} ${where} RETURNING id`,
    );
    const rows = (result as { rows?: unknown[] }).rows ?? [];
    console.log(`[${table}] deleted ${rows.length} duplicate rows`);
  }

  for (const stmt of DELTA_STATEMENTS) {
    await db.execute(sql.raw(stmt));
    console.log(`[ddl] ok: ${stmt.slice(0, 70)}...`);
  }

  const file = readFileSync("drizzle/0000_low_nightmare.sql", "utf8");
  const hash = createHash("sha256").update(file).digest("hex");
  await db.execute(sql.raw(`DELETE FROM drizzle.__drizzle_migrations`));
  await db.execute(
    sql`INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES (${hash}, ${BASELINE.when})`,
  );
  console.log(`[drizzle] __drizzle_migrations reset to baseline ${BASELINE.tag}`);
  console.log("apply complete");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
