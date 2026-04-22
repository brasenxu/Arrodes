/**
 * One-off utility: delete chunks for a given book and chapter range.
 *
 * Run:
 *   pnpm tsx scripts/delete-chunks.ts --book lotm1 --max-chapter 100
 *   pnpm tsx scripts/delete-chunks.ts --book lotm1 --all
 *
 * Exists so the chunk ingestion can be re-run with an updated primer without
 * having to nuke the chapters table. `DELETE FROM chunks` leaves
 * `chapters` / `books` rows intact; chunks have ON DELETE CASCADE from
 * chapters but not vice-versa.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { and, eq, lte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

type Args = { bookId: "lotm1" | "coi"; maxChapter: number | null };

function parseArgs(): Args {
  const rest = process.argv.slice(2);
  const bookIdx = rest.indexOf("--book");
  const bookId = rest[bookIdx + 1] as "lotm1" | "coi" | undefined;
  if (bookId !== "lotm1" && bookId !== "coi") {
    throw new Error("--book must be 'lotm1' or 'coi'");
  }

  if (rest.includes("--all")) {
    return { bookId, maxChapter: null };
  }

  const mIdx = rest.indexOf("--max-chapter");
  if (mIdx === -1) {
    throw new Error("pass --max-chapter <N> or --all");
  }
  const n = Number(rest[mIdx + 1]);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("--max-chapter must be a positive integer");
  }
  return { bookId, maxChapter: n };
}

async function main() {
  const { bookId, maxChapter } = parseArgs();

  const predicate =
    maxChapter == null
      ? eq(schema.chunks.bookId, bookId)
      : and(
          eq(schema.chunks.bookId, bookId),
          lte(schema.chunks.chapterNum, maxChapter),
        );

  const [{ count: before }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.chunks)
    .where(predicate);

  console.log(
    `Deleting ${before} chunks for book=${bookId}${maxChapter != null ? ` where chapter_num <= ${maxChapter}` : " (all chapters)"}`,
  );

  await db.delete(schema.chunks).where(predicate);

  const [{ count: after }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.chunks)
    .where(predicate);

  if (after !== 0) {
    throw new Error(`expected 0 chunks after delete, got ${after}`);
  }
  console.log(`Deleted ${before} chunks. Remaining matching rows: 0.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
