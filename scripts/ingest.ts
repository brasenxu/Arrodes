/**
 * One-shot ingestion: EPUB -> chapters -> contextual chunks -> entities -> embeddings.
 *
 * Run:
 *   pnpm ingest data/epub/LOTM.epub --book lotm1 --phase chapters
 *   pnpm ingest data/epub/COI.epub  --book coi   --phase chapters
 *
 * Phases:
 *   chapters — parse EPUB and write `chapters` rows (ticket 003)
 *   (later) contextual, embed, ner, events, summaries
 */

import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { extractChapters } from "@/lib/ingest/chapters";
import type { BookId } from "@/lib/ingest/arc-map";

const BOOK_TITLES: Record<BookId, string> = {
  lotm1: "Lord of the Mysteries",
  coi: "Circle of Inevitability",
};

type Phase = "chapters";
const PHASES: readonly Phase[] = ["chapters"] as const;

type Args = { epubPath: string; bookId: BookId; phase: Phase };

function parseArgs(): Args {
  const [epubPath, ...rest] = process.argv.slice(2);
  if (!epubPath) {
    throw new Error(
      "Usage: pnpm ingest <path-to-epub> --book <lotm1|coi> --phase <chapters>",
    );
  }

  const bookIdx = rest.indexOf("--book");
  const bookId = rest[bookIdx + 1] as BookId | undefined;
  if (bookId !== "lotm1" && bookId !== "coi") {
    throw new Error("--book must be 'lotm1' or 'coi'");
  }

  const phaseIdx = rest.indexOf("--phase");
  const phase = rest[phaseIdx + 1] as Phase | undefined;
  if (!phase || !PHASES.includes(phase)) {
    throw new Error(`--phase must be one of: ${PHASES.join(", ")}`);
  }

  return { epubPath, bookId, phase };
}

async function ingestChapters(epubPath: string, bookId: BookId): Promise<void> {
  console.log(`[chapters] extracting ${epubPath} as ${bookId}`);
  const records = await extractChapters(epubPath, bookId);
  console.log(`[chapters] parsed ${records.length} chapters`);

  const kindCounts = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.contentKind] = (acc[r.contentKind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[chapters] content_kind distribution:`, kindCounts);

  console.log(`[chapters] upserting book row`);
  await db
    .insert(schema.books)
    .values({ id: bookId, title: BOOK_TITLES[bookId], totalChapters: records.length })
    .onConflictDoUpdate({
      target: schema.books.id,
      set: { title: BOOK_TITLES[bookId], totalChapters: records.length },
    });

  console.log(`[chapters] deleting existing chapters for ${bookId} (cascades to chunks)`);
  await db.delete(schema.chapters).where(eq(schema.chapters.bookId, bookId));

  // Chunked multi-row INSERTs. Each statement is atomic on its own; the
  // delete+insert combo is not a single transaction because Neon HTTP doesn't
  // support them via drizzle. If a batch fails midway, the table is in a
  // half-filled state — just re-run and the leading delete will reset it.
  const BATCH_SIZE = 250;
  const rows = records.map((r) => ({
    bookId: r.bookId,
    volume: r.volume,
    volumeName: r.volumeName,
    chapterNum: r.chapterNum,
    chapterTitle: r.chapterTitle,
    rawText: r.rawText,
    contentKind: r.contentKind,
  }));
  console.log(
    `[chapters] inserting ${rows.length} chapters in batches of ${BATCH_SIZE}`,
  );
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(schema.chapters).values(batch);
    console.log(`[chapters]   inserted ${Math.min(i + batch.length, rows.length)}/${rows.length}`);
  }

  const [{ count: actual }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.chapters)
    .where(eq(schema.chapters.bookId, bookId));
  console.log(`[chapters] chapters row count for ${bookId}: ${actual}`);

  if (actual !== records.length) {
    throw new Error(
      `[chapters] row count mismatch: parsed ${records.length} but DB has ${actual}`,
    );
  }
}

async function main() {
  const { epubPath, bookId, phase } = parseArgs();
  console.log(`Ingest ${bookId} from ${epubPath} — phase=${phase}`);

  switch (phase) {
    case "chapters":
      await ingestChapters(epubPath, bookId);
      break;
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
