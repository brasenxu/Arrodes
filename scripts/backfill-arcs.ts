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
    // CASE-based bulk UPDATE keyed on id. Neon HTTP doesn't do multi-statement
    // transactions, so one statement per batch is the pragmatic upper bound.
    const ids = batch.map((u) => u.id);
    const volumeCases = sql.join(
      batch.map((u) => sql`WHEN ${u.id} THEN ${u.volume}`),
      sql` `,
    );
    const volumeNameCases = sql.join(
      batch.map((u) => sql`WHEN ${u.id} THEN ${u.volumeName}`),
      sql` `,
    );
    const arcCases = sql.join(
      batch.map((u) => sql`WHEN ${u.id} THEN ${u.arc}`),
      sql` `,
    );
    const arcNameCases = sql.join(
      batch.map((u) => sql`WHEN ${u.id} THEN ${u.arcName}`),
      sql` `,
    );
    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE chapters SET
        volume = CASE id ${volumeCases} END,
        volume_name = CASE id ${volumeNameCases} END,
        arc = CASE id ${arcCases} END,
        arc_name = CASE id ${arcNameCases} END
      WHERE id IN (${idList})
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
