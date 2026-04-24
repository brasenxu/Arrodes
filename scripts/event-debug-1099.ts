import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { sql } from "drizzle-orm";
import { anthropic } from "@ai-sdk/anthropic";
import { db } from "@/lib/db/client";
import { loadEntities } from "@/lib/ingest/ner";
import {
  buildChapterBlock,
  buildEventCatalogBlock,
  callHaikuForEvents,
  detectTarotSessionContext,
  EventResolver,
  extractChunkEvents,
  loadChapterEntityTypes,
  parseEventJson,
} from "@/lib/ingest/events";

async function main() {
  const model = anthropic(
    process.env.INGEST_CONTEXT_MODEL!.split("/").slice(-1)[0],
  );
  const ents = await loadEntities();
  const resolverEntities = ents.map((e) => ({
    id: e.id,
    canonicalName: e.canonicalName,
    entityType: e.entityType,
    aliases: e.aliases,
  }));
  const catalog = buildEventCatalogBlock(resolverEntities);
  const resolver = new EventResolver(resolverEntities);
  const chunks = (await db.execute(sql`
    SELECT c.id, c.content, c.chunk_index, ch.id AS chapter_id, ch.book_id, ch.chapter_num, ch.chapter_title, ch.raw_text
    FROM chunks c JOIN chapters ch ON ch.id = c.chapter_id WHERE c.id = 1099
  `)) as unknown as {
    rows: Array<{
      id: number;
      content: string;
      chunk_index: number;
      chapter_id: number;
      book_id: string;
      chapter_num: number;
      chapter_title: string;
      raw_text: string;
    }>;
  };
  const c = chunks.rows[0];
  const chapter = {
    id: c.chapter_id,
    bookId: c.book_id,
    chapterNum: c.chapter_num,
    chapterTitle: c.chapter_title,
    rawText: c.raw_text,
  };
  const entityTypeMap = await loadChapterEntityTypes(c.book_id, c.chapter_num);

  const r = await extractChunkEvents({
    chunk: { id: c.id, chunkIndex: c.chunk_index, content: c.content },
    bookId: c.book_id,
    chapterId: c.chapter_id,
    chapterNum: c.chapter_num,
    entityTypeSet: entityTypeMap.get(c.id) ?? new Set(),
    resolver,
    model,
    catalogBlock: catalog,
    chapterBlock: buildChapterBlock(chapter),
  });
  console.log("=== extractChunkEvents result ===");
  console.log("calledHaiku:", r.calledHaiku);
  console.log("rows:", JSON.stringify(r.rows, null, 2));

  // Also do raw call to see
  const raw = await callHaikuForEvents({
    model,
    catalogBlock: catalog,
    chapterBlock: buildChapterBlock(chapter),
    chunkText: c.content,
    sessionContext: detectTarotSessionContext(c.content),
  });
  console.log("\n=== raw text length:", raw.rawText.length);
  console.log("=== last 500 chars of raw:", raw.rawText.slice(-500));
  const parsed = parseEventJson(raw.rawText, c.content);
  console.log("\n=== parsed:", JSON.stringify(parsed, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
