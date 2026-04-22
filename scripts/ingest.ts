/**
 * One-shot ingestion: EPUB -> chapters -> contextual chunks -> entities -> embeddings.
 *
 * Run: pnpm ingest data/epub/lotm1.epub --book lotm1
 *      pnpm ingest data/epub/coi.epub   --book coi
 *
 * Not wired up yet — this is the skeleton. Fill in ingestion logic per the
 * phases in the architecture doc. Keep it local: this script writes directly
 * to Neon via the HTTP driver; it is not a deployed service.
 */

import "dotenv/config";
import { parseEpub } from "@gxl/epub-parser";
import { embedMany, generateText } from "ai";
import { db, schema } from "@/lib/db/client";
import { chunkChapter } from "@/lib/rag/chunking";

const CONTEXT_MODEL = process.env.INGEST_CONTEXT_MODEL ?? "anthropic/claude-haiku-4-5";
const EMBED_MODEL = process.env.INGEST_EMBED_MODEL ?? "openai/text-embedding-3-small";

type Args = { epubPath: string; bookId: "lotm1" | "coi" };

function parseArgs(): Args {
  const [epubPath, ...rest] = process.argv.slice(2);
  if (!epubPath) throw new Error("Usage: pnpm ingest <path-to-epub> --book <lotm1|coi>");
  const bookIdx = rest.indexOf("--book");
  const bookId = rest[bookIdx + 1] as "lotm1" | "coi" | undefined;
  if (bookId !== "lotm1" && bookId !== "coi") {
    throw new Error("--book must be 'lotm1' or 'coi'");
  }
  return { epubPath, bookId };
}

async function main() {
  const { epubPath, bookId } = parseArgs();
  console.log(`Ingesting ${epubPath} as ${bookId}`);

  const epub = await parseEpub(epubPath, { type: "path" });
  console.log(`Parsed ${epub.sections?.length ?? 0} sections`);

  // TODO:
  // 1. Map sections -> { volume, chapterNum, chapterTitle, rawText }.
  //    Use volume/arc table from architecture doc to assign volumes.
  // 2. Insert chapters.
  // 3. For each chapter:
  //    a. chunkChapter(rawText)
  //    b. Generate contextual_prefix for each chunk via CONTEXT_MODEL with
  //       Anthropic prompt caching (cache the full chapter once per chapter).
  //    c. embedMany({ model: EMBED_MODEL, values: [prefix+chunk]... })
  //    d. Insert chunks.
  //    e. NER pass -> entities + entity_mentions (use curated alias table
  //       in data/entities/aliases.json to seed).
  //    f. Event extraction -> events table.
  // 4. Compute hierarchical summaries (chapter -> arc -> volume).

  // Sanity references to keep imports live — remove once implemented.
  void chunkChapter;
  void embedMany;
  void generateText;
  void db;
  void schema;
  void CONTEXT_MODEL;
  void EMBED_MODEL;

  console.log("Not implemented yet. See TODO above.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
