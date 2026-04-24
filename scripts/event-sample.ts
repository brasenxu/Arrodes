/**
 * Event eval sampler. Produces data/eval/event-gold.jsonl with three strata:
 *
 *   1. Reused NER gold (26 chunks) — already labeled for entities, now needs
 *      event labeling. Most are expected to be event-empty (false-positive bar).
 *   2. Targeted seeds (≤15 chunks) — hand-picked canonical event scenes.
 *   3. Stratified random (15 chunks) — chunks passing Stages 1+2.
 *
 * Total ≈ 56 chunks. Stratum 2's chapter ranges are estimates; misses are
 * reported (not silently dropped) so the user can refine the anchors.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { eq, inArray, sql } from "drizzle-orm";
import { writeFileSync, readFileSync } from "node:fs";
import { db, schema } from "@/lib/db/client";
import { passesKeywordGate } from "@/lib/ingest/events";

const GOLD_PATH = "data/eval/event-gold.jsonl";
const NER_GOLD_PATH = "data/eval/ner-gold.jsonl";
const RANDOM_QUOTA = 15;

// Hand-picked anchor scenes. Each entry locates one chunk by
// (book, chapter range) + a content-substring filter. The picked chunk is the
// FIRST chunk in that chapter range whose content contains the substring.
//
// If a chosen anchor doesn't exist (chapter ranges are estimates), the sampler
// reports it and asks the user to refine. Don't silently skip — losing an
// anchor changes the eval pass-floors.
const TARGETED_SEEDS: Array<{
  label: string;
  bookId: "lotm1" | "coi";
  chapterRange: [number, number];
  contentSubstring: string;
}> = [
  // sequence_advance / digestion (4)
  { label: "Klein takes Seer potion", bookId: "lotm1", chapterRange: [30, 35], contentSubstring: "potion" },
  { label: "Klein digests Clown potion", bookId: "lotm1", chapterRange: [280, 300], contentSubstring: "digest" },
  { label: "Klein advances to Magician", bookId: "lotm1", chapterRange: [290, 300], contentSubstring: "Magician" },
  { label: "Klein digests Magician potion", bookId: "lotm1", chapterRange: [420, 435], contentSubstring: "digest" },
  { label: "Klein advances to Faceless", bookId: "lotm1", chapterRange: [445, 455], contentSubstring: "Faceless" },
  // meeting (1)
  { label: "First Tarot Club meeting", bookId: "lotm1", chapterRange: [80, 105], contentSubstring: "Tarot Club" },
  // organization_join (1)
  { label: "Audrey joins Tarot Club", bookId: "lotm1", chapterRange: [55, 75], contentSubstring: "Justice" },
  // battle (3)
  { label: "Klein vs Adam late series", bookId: "lotm1", chapterRange: [1340, 1360], contentSubstring: "Adam" },
  { label: "COI Demoness encounter", bookId: "coi", chapterRange: [600, 700], contentSubstring: "Demoness" },
  { label: "Klein major fight (mid)", bookId: "lotm1", chapterRange: [600, 700], contentSubstring: "fought" },
  // death (2)
  { label: "Named character death (LOTM1 late)", bookId: "lotm1", chapterRange: [1100, 1300], contentSubstring: "died" },
  { label: "Named character death (COI)", bookId: "coi", chapterRange: [800, 1000], contentSubstring: "died" },
  // identity_assume (4)
  { label: "Klein assumes Sherlock Moriarty", bookId: "lotm1", chapterRange: [400, 470], contentSubstring: "Sherlock" },
  { label: "Klein assumes Gehrman Sparrow", bookId: "lotm1", chapterRange: [483, 583], contentSubstring: "Gehrman" },
  { label: "Klein assumes Dwayne Dantès", bookId: "lotm1", chapterRange: [700, 850], contentSubstring: "Dwayne" },
  { label: "Klein assumes Benson Moretti", bookId: "lotm1", chapterRange: [220, 280], contentSubstring: "Benson" },
];

type GoldChunk = {
  chunk_id: number;
  book_id: string;
  chapter_num: number;
  chunk_index: number;
  content: string;
  events: unknown[];
  source_label?: string;
};

async function fetchChunkByLocation(
  bookId: string,
  chapterRange: [number, number],
  contentSubstring: string,
): Promise<GoldChunk | null> {
  const rows = (await db.execute(sql`
    SELECT c.id, c.content, c.chunk_index, ch.book_id, ch.chapter_num
    FROM chunks c
    JOIN chapters ch ON ch.id = c.chapter_id
    WHERE ch.book_id = ${bookId}
      AND ch.chapter_num BETWEEN ${chapterRange[0]} AND ${chapterRange[1]}
      AND c.content ILIKE ${"%" + contentSubstring + "%"}
    ORDER BY ch.chapter_num, c.chunk_index
    LIMIT 1
  `)) as unknown as {
    rows: { id: number; content: string; chunk_index: number; book_id: string; chapter_num: number }[];
  };
  if (rows.rows.length === 0) return null;
  const r = rows.rows[0];
  return {
    chunk_id: r.id,
    book_id: r.book_id,
    chapter_num: r.chapter_num,
    chunk_index: r.chunk_index,
    content: r.content,
    events: [],
  };
}

async function fetchRandomGated(quota: number): Promise<GoldChunk[]> {
  // Pull a candidate pool: chunks with character/org mentions, randomized.
  // EXISTS avoids the DISTINCT + ORDER BY RANDOM() conflict (postgres requires
  // ORDER BY targets to be in the SELECT list of a DISTINCT query).
  const candidateRows = (await db.execute(sql`
    SELECT c.id, c.content, c.chunk_index, ch.book_id, ch.chapter_num
    FROM chunks c
    JOIN chapters ch ON ch.id = c.chapter_id
    WHERE EXISTS (
      SELECT 1 FROM entity_mentions em
      JOIN entities e ON e.id = em.entity_id
      WHERE em.chunk_id = c.id AND e.entity_type IN ('character', 'organization')
    )
    ORDER BY RANDOM()
    LIMIT 500
  `)) as unknown as {
    rows: { id: number; content: string; chunk_index: number; book_id: string; chapter_num: number }[];
  };

  const out: GoldChunk[] = [];
  for (const r of candidateRows.rows) {
    if (!passesKeywordGate(r.content)) continue;
    out.push({
      chunk_id: r.id,
      book_id: r.book_id,
      chapter_num: r.chapter_num,
      chunk_index: r.chunk_index,
      content: r.content,
      events: [],
      source_label: "random",
    });
    if (out.length >= quota) break;
  }
  return out;
}

async function loadNerGoldChunks(): Promise<GoldChunk[]> {
  const text = readFileSync(NER_GOLD_PATH, "utf8");
  const ids: number[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj.chunk_id === "number") ids.push(obj.chunk_id);
    } catch {
      // Tolerate stray non-JSON lines (e.g., a leading comment).
    }
  }
  if (ids.length === 0) return [];
  // Use drizzle's typed inArray — neon-http can't bind a JS array to int[] via
  // raw sql template (the ANY(${arr}::int[]) pattern fails at parse time).
  const rows = await db
    .select({
      id: schema.chunks.id,
      content: schema.chunks.content,
      chunkIndex: schema.chunks.chunkIndex,
      bookId: schema.chapters.bookId,
      chapterNum: schema.chapters.chapterNum,
    })
    .from(schema.chunks)
    .innerJoin(schema.chapters, eq(schema.chapters.id, schema.chunks.chapterId))
    .where(inArray(schema.chunks.id, ids));
  return rows.map((r) => ({
    chunk_id: r.id,
    book_id: r.bookId,
    chapter_num: r.chapterNum,
    chunk_index: r.chunkIndex,
    content: r.content,
    events: [],
    source_label: "ner_reuse",
  }));
}

async function main() {
  // Stratum 1 — NER reuse
  const reuse = await loadNerGoldChunks();
  console.log(`[reuse] ${reuse.length} chunks from NER gold`);

  // Stratum 2 — targeted seeds
  const seeds: GoldChunk[] = [];
  for (const seed of TARGETED_SEEDS) {
    const c = await fetchChunkByLocation(
      seed.bookId,
      seed.chapterRange,
      seed.contentSubstring,
    );
    if (!c) {
      console.warn(
        `[seed-miss] ${seed.label} (${seed.bookId} ch${seed.chapterRange.join("-")} substring="${seed.contentSubstring}") — not found, refine the anchor.`,
      );
      continue;
    }
    c.source_label = `seed:${seed.label}`;
    seeds.push(c);
  }
  console.log(`[seeds] ${seeds.length}/${TARGETED_SEEDS.length} anchors located`);

  // Stratum 3 — stratified random
  const random = await fetchRandomGated(RANDOM_QUOTA);
  console.log(`[random] ${random.length} chunks`);

  // Merge, dedupe by chunk_id (later strata yield to earlier on collisions).
  const seen = new Set<number>();
  const merged: GoldChunk[] = [];
  for (const c of [...reuse, ...seeds, ...random]) {
    if (seen.has(c.chunk_id)) continue;
    seen.add(c.chunk_id);
    merged.push(c);
  }
  const out = merged.map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(GOLD_PATH, out);
  console.log(`[wrote] ${merged.length} chunks → ${GOLD_PATH}`);
  console.log(
    "Hand-label the 'events' arrays in the file before running pnpm event:score.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
