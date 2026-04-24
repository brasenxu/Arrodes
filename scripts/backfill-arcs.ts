/**
 * Ticket 021 backfill: populate chapters.arc, chapters.arc_name, and (for
 * COI) corrected chapters.volume/volume_name on existing rows, without
 * touching the chunks/NER/events already ingested against them.
 *
 * Rationale: the ticket's verification block calls `pnpm ingest --phase
 * chapters --reset`, but that path DELETEs chapters first, which cascades to
 * chunks (and therefore wipes entity_mentions + events). Non-destructive
 * UPDATEs preserve downstream data.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-arcs.ts --book lotm1
 *   pnpm tsx scripts/backfill-arcs.ts --book coi
 *   pnpm tsx scripts/backfill-arcs.ts --book lotm1 --dry-run
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { assignArc, type BookId } from "@/lib/ingest/arc-map";

type Args = { bookId: BookId; dryRun: boolean };

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const bookIdx = raw.indexOf("--book");
  const bookId = raw[bookIdx + 1] as BookId | undefined;
  if (bookId !== "lotm1" && bookId !== "coi") {
    throw new Error("--book must be 'lotm1' or 'coi'");
  }
  return { bookId, dryRun: raw.includes("--dry-run") };
}

async function main() {
  const { bookId, dryRun } = parseArgs();
  console.log(`[backfill-arcs] book=${bookId}${dryRun ? " dry-run" : ""}`);

  const rows = await db
    .select({
      id: schema.chapters.id,
      chapterNum: schema.chapters.chapterNum,
      volume: schema.chapters.volume,
      volumeName: schema.chapters.volumeName,
      arc: schema.chapters.arc,
      arcName: schema.chapters.arcName,
    })
    .from(schema.chapters)
    .where(eq(schema.chapters.bookId, bookId))
    .orderBy(asc(schema.chapters.chapterNum));

  console.log(`[backfill-arcs] loaded ${rows.length} chapters`);
  if (rows.length === 0) {
    throw new Error(`[backfill-arcs] no chapters found for ${bookId}`);
  }

  let changed = 0;
  let volumeChanged = 0;
  const updates: Array<{
    id: number;
    chapterNum: number;
    volume: number;
    volumeName: string;
    arc: number;
    arcName: string;
  }> = [];
  for (const r of rows) {
    const a = assignArc(bookId, r.chapterNum);
    const needsUpdate =
      r.volume !== a.volume ||
      r.volumeName !== a.volumeName ||
      r.arc !== a.arc ||
      r.arcName !== a.arcName;
    if (!needsUpdate) continue;
    if (r.volume !== a.volume || r.volumeName !== a.volumeName) {
      volumeChanged++;
    }
    updates.push({
      id: r.id,
      chapterNum: r.chapterNum,
      volume: a.volume,
      volumeName: a.volumeName,
      arc: a.arc,
      arcName: a.arcName,
    });
    changed++;
  }

  console.log(
    `[backfill-arcs] ${changed}/${rows.length} rows need updating (${volumeChanged} also change volume)`,
  );

  if (dryRun) {
    console.log("[backfill-arcs] dry-run — first 5 planned updates:");
    for (const u of updates.slice(0, 5)) {
      console.log(
        `  id=${u.id} ch=${u.chapterNum} vol=${u.volume} "${u.volumeName}" arc=${u.arc} "${u.arcName}"`,
      );
    }
    return;
  }

  if (changed === 0) {
    console.log("[backfill-arcs] nothing to update");
    return;
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    // UPDATE ... FROM (VALUES ...) AS v(...) WHERE c.id = v.id. The first row
    // carries explicit ::int / ::text casts so Postgres can type the columns
    // without having to resolve parameter types through a bare CASE (which
    // Neon was rejecting with "column \"volume\" is of type integer but
    // expression is of type text" — all parameters default to text otherwise).
    const valueRows = batch.map((u, idx) => {
      if (idx === 0) {
        return sql`(${u.id}::int, ${u.volume}::int, ${u.volumeName}::text, ${u.arc}::int, ${u.arcName}::text)`;
      }
      return sql`(${u.id}, ${u.volume}, ${u.volumeName}, ${u.arc}, ${u.arcName})`;
    });
    const valuesClause = sql.join(valueRows, sql`, `);
    await db.execute(sql`
      UPDATE chapters AS c SET
        volume = v.volume,
        volume_name = v.volume_name,
        arc = v.arc,
        arc_name = v.arc_name
      FROM (VALUES ${valuesClause}) AS v(id, volume, volume_name, arc, arc_name)
      WHERE c.id = v.id
    `);
    console.log(
      `[backfill-arcs]   updated ${Math.min(i + batch.length, updates.length)}/${updates.length}`,
    );
  }

  const verifyRes = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE arc = 0) AS arc_zero,
      count(*) FILTER (WHERE arc_name = '') AS arc_name_blank,
      count(DISTINCT arc_name) AS distinct_arcs
    FROM chapters
    WHERE book_id = ${bookId}
  `)) as unknown as {
    rows: Array<{
      arc_zero: number | string;
      arc_name_blank: number | string;
      distinct_arcs: number | string;
    }>;
  };
  const v = verifyRes.rows[0];
  console.log(
    `[backfill-arcs] verify: arc=0 rows=${v.arc_zero}, arc_name='' rows=${v.arc_name_blank}, distinct arc_names=${v.distinct_arcs}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
