/**
 * Score Haiku's event extraction against hand-labeled gold.
 *
 * For each chunk:
 *   - Run extractChunkEvents (the same pipeline events.ts uses in production).
 *   - Compare predictions to labels on the (entity_canonical_name, event_type)
 *     tuple (case-insensitive on the entity name).
 *   - Aggregate per-event-type confusion + overall + FPR on events:[] chunks.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { anthropic } from "@ai-sdk/anthropic";
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
import { EVENT_TYPES, type EventType } from "@/lib/rag/types";

// Copied from scripts/ner-score.ts — scripts don't share helpers.
function bareModelId(envValue: string): string {
  return envValue.includes("/") ? envValue.split("/").slice(-1)[0] : envValue;
}

const GOLD_PATH = "data/eval/event-gold.jsonl";

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
};

type Tuple = string;

function tupleKey(e: { entity_canonical_name: string; event_type: string }): Tuple {
  return `${e.entity_canonical_name.toLowerCase()}::${e.event_type}`;
}

type Conf = { tp: number; fp: number; fn: number };

function newConf(): Conf {
  return { tp: 0, fp: 0, fn: 0 };
}

function f1(c: Conf): { precision: number; recall: number; f1: number } {
  const precision = c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : 0;
  const recall = c.tp + c.fn > 0 ? c.tp / (c.tp + c.fn) : 0;
  const fScore =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;
  return { precision, recall, f1: fScore };
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

async function main() {
  const contextModelEnv = process.env.INGEST_CONTEXT_MODEL;
  if (!contextModelEnv) {
    throw new Error("INGEST_CONTEXT_MODEL is not set in .env.local");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set in .env.local");
  }
  const model = anthropic(bareModelId(contextModelEnv));

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
  console.log(`[event-score] loaded ${gold.length} gold chunks from ${GOLD_PATH}`);

  // Group by (bookId, chapterNum) to exploit the chapter cache.
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

  const entitiesRaw = await loadEntities();
  const entities: ResolverEntity[] = entitiesRaw.map((e) => ({
    id: e.id,
    canonicalName: e.canonicalName,
    entityType: e.entityType,
    aliases: e.aliases,
  }));
  const resolver = new EventResolver(entities);
  const catalogBlock = buildEventCatalogBlock(entities);
  console.log(`[event-score] loaded ${entities.length} entities`);

  const perType: Record<EventType, Conf> = Object.fromEntries(
    EVENT_TYPES.map((t) => [t, newConf()]),
  ) as Record<EventType, Conf>;
  const overall = newConf();
  let emptyChunkFalsePositives = 0;
  let emptyChunkCount = 0;
  const failures: Array<{
    chunk_id: number;
    expected: Tuple[];
    got: Tuple[];
  }> = [];

  for (const [k, bucket] of byChapter) {
    const [bookId, chapterNumStr] = k.split("::");
    const chapter = await loadChapterMeta(bookId, Number(chapterNumStr));
    if (!chapter) {
      console.warn(
        `[event-score] chapter not found for ${bookId} ch${chapterNumStr}, skipping ${bucket.length} chunks`,
      );
      continue;
    }
    const entityTypeMap = await loadChapterEntityTypes(
      bookId,
      chapter.chapterNum,
    );
    const chapterBlock = buildChapterBlock(chapter);

    for (const goldChunk of bucket) {
      const chunk: ChunkInput = {
        id: goldChunk.chunk_id,
        chunkIndex: goldChunk.chunk_index,
        content: goldChunk.content,
      };
      const expected = new Set(
        goldChunk.events.map((e) => tupleKey(e)),
      );

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

      const tps = [...got].filter((t) => expected.has(t));
      const fps = [...got].filter((t) => !expected.has(t));
      const fns = [...expected].filter((t) => !got.has(t));

      for (const t of tps) {
        const evType = t.split("::")[1] as EventType;
        if (perType[evType]) perType[evType].tp++;
        overall.tp++;
      }
      for (const t of fps) {
        const evType = t.split("::")[1] as EventType;
        if (perType[evType]) perType[evType].fp++;
        overall.fp++;
      }
      for (const t of fns) {
        const evType = t.split("::")[1] as EventType;
        if (perType[evType]) perType[evType].fn++;
        overall.fn++;
      }

      if (goldChunk.events.length === 0) {
        emptyChunkCount++;
        if (got.size > 0) emptyChunkFalsePositives++;
      }

      if (fps.length > 0 || fns.length > 0) {
        failures.push({
          chunk_id: chunk.id,
          expected: [...expected],
          got: [...got],
        });
      }
    }
  }

  console.log("\n=== Per-event-type ===");
  for (const t of EVENT_TYPES) {
    const c = perType[t];
    const m = f1(c);
    console.log(
      `${t.padEnd(20)}  P=${m.precision.toFixed(2)}  R=${m.recall.toFixed(2)}  F1=${m.f1.toFixed(2)}  (tp=${c.tp} fp=${c.fp} fn=${c.fn})`,
    );
  }

  const overallM = f1(overall);
  console.log(`\n=== Overall ===`);
  console.log(
    `P=${overallM.precision.toFixed(2)}  R=${overallM.recall.toFixed(2)}  F1=${overallM.f1.toFixed(2)}`,
  );

  console.log(`\n=== False-positive rate on empty chunks ===`);
  const fpr =
    emptyChunkCount > 0
      ? ((emptyChunkFalsePositives / emptyChunkCount) * 100).toFixed(1)
      : "0";
  console.log(
    `${emptyChunkFalsePositives}/${emptyChunkCount} = ${fpr}%`,
  );

  if (failures.length > 0) {
    console.log(`\n=== Failures (${failures.length}) ===`);
    for (const f of failures.slice(0, 20)) {
      console.log(
        `chunk#${f.chunk_id}\n  expected: ${f.expected.join(", ") || "(none)"}\n  got:      ${f.got.join(", ") || "(none)"}`,
      );
    }
    if (failures.length > 20) console.log(`... ${failures.length - 20} more`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
