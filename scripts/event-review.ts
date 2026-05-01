/**
 * Event-eval disagreement reviewer.
 *
 * Re-runs Haiku against data/eval/event-gold.jsonl, then prints a per-chunk
 * card for every disagreement so the user can decide whether their gold label
 * or Haiku's prediction is the right one. Outputs human-readable Markdown to
 * stdout and a parallel `data/eval/event-eval-disagreements.md` file.
 *
 * Use this between `pnpm event:sample`/labeling and `pnpm event:score` when
 * the score numbers are confusing — it shows WHY the per-type F1 is what it is.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createOpenAI } from "@ai-sdk/openai";
import { db } from "@/lib/db/client";
import { loadEntities } from "@/lib/ingest/ner";
import {
  buildChapterBlock,
  buildEventCatalogBlock,
  EventResolver,
  extractChunkEvents,
  loadChapterEntityTypes,
  type ChapterMeta,
  type ChunkInput,
  type ResolverEntity,
} from "@/lib/ingest/events";
import { type EventType } from "@/lib/rag/types";

function bareModelId(envValue: string): string {
  return envValue.includes("/") ? envValue.split("/").slice(-1)[0] : envValue;
}

function deepseekProvider() {
  return createOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com/v1",
  });
}

const GOLD_PATH = "data/eval/event-gold.jsonl";
const OUT_PATH = "data/eval/event-eval-disagreements.md";

type GoldEvent = {
  entity_canonical_name: string;
  event_type: EventType;
  extra?: Record<string, unknown>;
};

type GoldChunk = {
  chunk_id: number;
  book_id: string;
  chapter_num: number;
  chunk_index: number;
  content: string;
  events: GoldEvent[];
  source_label?: string;
};

type Tuple = string;

function tupleKey(e: { entity_canonical_name: string; event_type: string }): Tuple {
  return `${e.entity_canonical_name.toLowerCase()}::${e.event_type}`;
}

async function loadChapterMeta(
  bookId: string,
  chapterNum: number,
): Promise<ChapterMeta | null> {
  const rows = (await db.execute(sql`
    SELECT id, book_id, chapter_num, chapter_title, raw_text
    FROM chapters WHERE book_id = ${bookId} AND chapter_num = ${chapterNum} LIMIT 1
  `)) as unknown as {
    rows: {
      id: number;
      book_id: string;
      chapter_num: number;
      chapter_title: string;
      raw_text: string;
    }[];
  };
  if (rows.rows.length === 0) return null;
  const r = rows.rows[0];
  return {
    id: r.id,
    bookId: r.book_id,
    chapterNum: r.chapter_num,
    chapterTitle: r.chapter_title,
    rawText: r.raw_text,
  };
}

function getCanonicalName(entityId: number, entities: ResolverEntity[]): string {
  return entities.find((e) => e.id === entityId)?.canonicalName ?? `entity#${entityId}`;
}

function formatTuples(tuples: Tuple[]): string {
  if (tuples.length === 0) return "  (none)";
  return tuples.map((t) => `  • ${t}`).join("\n");
}

async function main() {
  const contextModelEnv = process.env.INGEST_CONTEXT_MODEL;
  if (!contextModelEnv) throw new Error("INGEST_CONTEXT_MODEL not set");
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY not set");
  const model = deepseekProvider().chat(bareModelId(contextModelEnv));

  const lines = readFileSync(GOLD_PATH, "utf8").split("\n").filter(Boolean);
  const gold: GoldChunk[] = lines
    .map((l) => {
      try {
        return JSON.parse(l) as GoldChunk;
      } catch {
        return null;
      }
    })
    .filter((g): g is GoldChunk => g !== null && typeof g.chunk_id === "number");

  const entitiesRaw = await loadEntities();
  const entities: ResolverEntity[] = entitiesRaw.map((e) => ({
    id: e.id,
    canonicalName: e.canonicalName,
    entityType: e.entityType,
    aliases: e.aliases,
  }));
  const resolver = new EventResolver(entities);
  const catalogBlock = buildEventCatalogBlock(entities);

  const byChapter = new Map<string, GoldChunk[]>();
  for (const g of gold) {
    const k = `${g.book_id}::${g.chapter_num}`;
    let bucket = byChapter.get(k);
    if (!bucket) {
      bucket = [];
      byChapter.set(k, bucket);
    }
    bucket.push(g);
  }

  const cards: string[] = [];
  let disagreementCount = 0;
  let agreementCount = 0;

  for (const [k, bucket] of byChapter) {
    const [bookId, chapterNumStr] = k.split("::");
    const chapter = await loadChapterMeta(bookId, Number(chapterNumStr));
    if (!chapter) continue;
    const entityTypeMap = await loadChapterEntityTypes(bookId, chapter.chapterNum);
    const chapterBlock = buildChapterBlock(chapter);

    for (const goldChunk of bucket) {
      const chunk: ChunkInput = {
        id: goldChunk.chunk_id,
        chunkIndex: goldChunk.chunk_index,
        content: goldChunk.content,
      };
      const expected = new Set(goldChunk.events.map((e) => tupleKey(e)));

      const r = await extractChunkEvents({
        chunk,
        bookId: chapter.bookId,
        chapterId: chapter.id,
        chapterNum: chapter.chapterNum,
        entityTypeSet: entityTypeMap.get(chunk.id) ?? new Set(),
        resolver,
        model,
        catalogBlock,
        chapterBlock,
      });
      const got = new Set(
        r.rows.map((row) =>
          tupleKey({
            entity_canonical_name: getCanonicalName(row.entityId, entities),
            event_type: row.eventType,
          }),
        ),
      );

      const missing = [...expected].filter((t) => !got.has(t));
      const extra = [...got].filter((t) => !expected.has(t));

      if (missing.length === 0 && extra.length === 0) {
        agreementCount++;
        continue;
      }

      disagreementCount++;
      const card = [
        `## chunk#${chunk.id} — ${bookId} ch${chapter.chapterNum} idx=${chunk.chunkIndex}${goldChunk.source_label ? ` (${goldChunk.source_label})` : ""}`,
        "",
        "**Content:**",
        "```",
        goldChunk.content.trim(),
        "```",
        "",
        "**GOLD (your labels):**",
        formatTuples([...expected]),
        "",
        "**HAIKU (predicted):**",
        formatTuples([...got]),
        "",
        "**Delta:**",
        `- MISSING (gold has, Haiku didn't): ${missing.length === 0 ? "none" : missing.join(", ")}`,
        `- EXTRA (Haiku added, gold didn't): ${extra.length === 0 ? "none" : extra.join(", ")}`,
        "",
        "---",
        "",
      ].join("\n");
      cards.push(card);
    }
  }

  const header = [
    "# Event Eval — Disagreement Review",
    "",
    `${agreementCount} chunks agree, ${disagreementCount} chunks disagree.`,
    "",
    "For each card below, decide:",
    "- **Gold wins** → leave the chunk in `data/eval/event-gold.jsonl` as-is. The prompt needs work.",
    "- **Haiku wins** → edit your label in `data/eval/event-gold.jsonl` to match Haiku.",
    "- **Both partial** → take the union, or refine both.",
    "",
    "---",
    "",
  ].join("\n");

  const out = header + cards.join("");
  writeFileSync(OUT_PATH, out);
  console.log(`\n${agreementCount} agree · ${disagreementCount} disagree`);
  console.log(`Disagreement cards written to: ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
