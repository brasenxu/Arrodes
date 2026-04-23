/**
 * Integration probe for `hybridSearch` (ticket 009).
 *
 * Five canned queries lifted from data/eval/eval-set.jsonl, each executed three
 * times against live Neon: hybrid (RRF), dense-only (pgvector <=>), and
 * sparse-only (tsvector ts_rank). Printed side-by-side so RRF drift vs. dense
 * is visible by eye. Finally, two reading-position runs verify the pre-filter
 * in `hybridSearch` prevents spoilers (pre-filter, not post-filter — post would
 * starve top-k).
 *
 * Run:
 *   pnpm test:retrieval
 */

// .env.local first (Next convention), .env fallback. Must run before imports
// that touch the AI SDK / DB client.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { sql } from "drizzle-orm";
import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { db } from "@/lib/db/client";
import { buildTsquery, hybridSearch } from "@/lib/rag/retrieval";
import type { BookId, ReadingPosition, RetrievedChunk } from "@/lib/rag/types";

function bareModelId(envValue: string): string {
  return envValue.includes("/") ? envValue.split("/").slice(-1)[0] : envValue;
}

type Query = {
  id: string;
  book: BookId;
  question: string;
  expectedChapters: number[];
};

// Picked from eval-set.jsonl: only entries where `expected_chapters` is
// populated, spanning both books and a spread of query_types. Q002 is deliberate
// — its expected chapters (210–213) sit outside the lotm1=200 bound, giving the
// spoiler pre-filter something real to reject.
const QUERIES: Query[] = [
  {
    id: "Q001",
    book: "lotm1",
    question: "Summarize chapter 1 of Lord of the Mysteries.",
    expectedChapters: [1],
  },
  {
    id: "Q002",
    book: "lotm1",
    question:
      "Summarize the closing events of the Clown arc (end of volume 1).",
    expectedChapters: [210, 211, 212, 213],
  },
  {
    id: "Q005",
    book: "coi",
    question: "Summarize chapter 1 of Circle of Inevitability.",
    expectedChapters: [1],
  },
  {
    id: "Q006",
    book: "coi",
    question:
      "Summarize the closing events of the Nightmare arc in Circle of Inevitability.",
    expectedChapters: [107, 108, 109],
  },
  {
    id: "Q013",
    book: "lotm1",
    question: "Who is Klein Moretti? List every identity he uses across the series.",
    expectedChapters: [1],
  },
];

type BareRow = {
  id: number;
  book_id: BookId;
  chapter_num: number;
  chapter_title: string;
  chunk_index: number;
  content: string;
  contextual_prefix: string;
  score: number;
};

// Emits WHERE-clause fragments qualified with the `c.` alias (chunks) since
// the dense/sparse helpers join chapters as `ch`, which makes bare `book_id`
// and `chapter_num` ambiguous.
function bookFilterSql(
  books: BookId[],
  position: ReadingPosition,
) {
  const ceilings = books
    .map((b) => ({ book: b, max: position[b] }))
    .filter((b): b is { book: BookId; max: number } => b.max !== null);
  if (ceilings.length === 0) return null;
  return sql.join(
    ceilings.map(
      (b) => sql`(c.book_id = ${b.book} AND c.chapter_num <= ${b.max})`,
    ),
    sql` OR `,
  );
}

async function denseOnly(args: {
  queryEmbedding: number[];
  books: BookId[];
  position: ReadingPosition;
  limit: number;
}): Promise<RetrievedChunk[]> {
  const filter = bookFilterSql(args.books, args.position);
  if (!filter) return [];
  const embedLiteral = `[${args.queryEmbedding.join(",")}]`;

  const result = await db.execute<BareRow>(sql`
    SELECT
      c.id, c.book_id, c.chapter_num, ch.chapter_title,
      c.chunk_index, c.content, c.contextual_prefix,
      (1 - (c.embedding <=> ${embedLiteral}::vector))::float AS score
    FROM chunks c
    JOIN chapters ch ON ch.id = c.chapter_id
    WHERE ${filter}
    ORDER BY c.embedding <=> ${embedLiteral}::vector
    LIMIT ${args.limit}
  `);
  const rows = Array.isArray(result) ? result : result.rows;
  return rows.map(toRetrievedChunk);
}

async function sparseOnly(args: {
  queryText: string;
  books: BookId[];
  position: ReadingPosition;
  limit: number;
}): Promise<RetrievedChunk[]> {
  const filter = bookFilterSql(args.books, args.position);
  if (!filter) return [];
  const tsq = buildTsquery(args.queryText);
  if (!tsq) return [];

  const result = await db.execute<BareRow>(sql`
    SELECT
      c.id, c.book_id, c.chapter_num, ch.chapter_title,
      c.chunk_index, c.content, c.contextual_prefix,
      ts_rank(c.tsv, to_tsquery('english', ${tsq}))::float AS score
    FROM chunks c
    JOIN chapters ch ON ch.id = c.chapter_id
    WHERE c.tsv @@ to_tsquery('english', ${tsq})
      AND (${filter})
    ORDER BY score DESC
    LIMIT ${args.limit}
  `);
  const rows = Array.isArray(result) ? result : result.rows;
  return rows.map(toRetrievedChunk);
}

function toRetrievedChunk(r: BareRow): RetrievedChunk {
  return {
    id: r.id,
    bookId: r.book_id,
    chapterNum: r.chapter_num,
    chapterTitle: r.chapter_title,
    chunkIndex: r.chunk_index,
    content: r.content,
    contextualPrefix: r.contextual_prefix,
    score: Number(r.score),
    source: "epub" as const,
  };
}

function snippet(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

function printTable(label: string, chunks: RetrievedChunk[]) {
  console.log(`  ${label}:`);
  if (chunks.length === 0) {
    console.log("    (no rows)");
    return;
  }
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    console.log(
      `    ${String(i + 1).padStart(2)}. ${c.bookId} ch${String(c.chapterNum).padStart(4)} [${c.chunkIndex}] score=${c.score.toFixed(4)} | ${snippet(c.content)}`,
    );
  }
}

function chapterSet(chunks: RetrievedChunk[]): string {
  const seen = new Set<string>();
  for (const c of chunks) seen.add(`${c.bookId}:${c.chapterNum}`);
  return Array.from(seen).sort().join(", ");
}

function rankOrder(chunks: RetrievedChunk[]): string {
  return chunks.map((c) => `${c.bookId}:${c.chapterNum}:${c.chunkIndex}`).join(" | ");
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set in .env.local");
  }
  if (!process.env.INGEST_EMBED_MODEL) {
    throw new Error("INGEST_EMBED_MODEL is not set in .env.local");
  }

  const embedModelId = bareModelId(process.env.INGEST_EMBED_MODEL);
  const embedModel = openai.embedding(embedModelId);
  console.log(`[test-retrieval] embed model: openai:${embedModelId}`);

  const openPos: ReadingPosition = { lotm1: 1432, coi: 1181 };

  // ---- Section 1: per-query hybrid vs dense vs sparse, fully-open position.
  console.log("\n========== SECTION 1: hybrid vs dense vs sparse (open position) ==========");
  let rrfDivergenceCount = 0;
  for (const q of QUERIES) {
    const { embedding } = await embed({ model: embedModel, value: q.question });

    const [hybrid, dense, sparse] = await Promise.all([
      hybridSearch({
        queryEmbedding: embedding,
        queryText: q.question,
        books: [q.book],
        position: openPos,
        limit: 8,
      }),
      denseOnly({
        queryEmbedding: embedding,
        books: [q.book],
        position: openPos,
        limit: 8,
      }),
      sparseOnly({
        queryText: q.question,
        books: [q.book],
        position: openPos,
        limit: 8,
      }),
    ]);

    console.log(`\n--- ${q.id} [${q.book}] "${q.question}"`);
    console.log(`    expected chapters: ${q.expectedChapters.join(", ") || "(none)"}`);
    printTable("hybrid (RRF, k/b=60)", hybrid);
    printTable("dense-only (cosine sim)", dense);
    printTable("sparse-only (ts_rank)", sparse);

    const hybridOrder = rankOrder(hybrid);
    const denseOrder = rankOrder(dense);
    const diverges = hybridOrder !== denseOrder && hybrid.length > 0 && dense.length > 0;
    if (diverges) rrfDivergenceCount++;
    console.log(
      `    acceptance: hybrid non-empty=${hybrid.length > 0}, RRF differs from dense=${diverges}`,
    );
    console.log(`    hybrid chapter set: ${chapterSet(hybrid)}`);

    const hybridHits = hybrid.filter((c) => q.expectedChapters.includes(c.chapterNum));
    if (q.expectedChapters.length > 0) {
      console.log(
        `    expected-chapter hits in hybrid top-8: ${hybridHits.length}/${q.expectedChapters.length} (${hybridHits.map((c) => c.chapterNum).join(", ") || "none"})`,
      );
    }
  }

  // ---- Section 2: reading-position pre-filter sanity.
  // Case A: lotm1=1396, coi=1180 — both books "open" near their tails. Rows
  // must never exceed those ceilings (no chapter 1397+ for lotm1, no 1181 for coi).
  // Case B: lotm1=200, coi=null — lotm1 capped tightly; coi fully excluded.
  console.log("\n========== SECTION 2: reading-position pre-filter ==========");

  const cases: { label: string; pos: ReadingPosition }[] = [
    { label: "A: {lotm1:1396, coi:1180}", pos: { lotm1: 1396, coi: 1180 } },
    { label: "B: {lotm1:200, coi:null}", pos: { lotm1: 200, coi: null } },
  ];

  for (const c of cases) {
    console.log(`\n-- Case ${c.label} --`);
    const allRows: RetrievedChunk[] = [];
    for (const q of QUERIES) {
      const { embedding } = await embed({ model: embedModel, value: q.question });
      const rows = await hybridSearch({
        queryEmbedding: embedding,
        queryText: q.question,
        books: ["lotm1", "coi"],
        position: c.pos,
        limit: 8,
      });
      allRows.push(...rows);
      console.log(
        `  ${q.id}: ${rows.length} rows, chapters=[${chapterSet(rows)}]`,
      );
    }

    const violations = allRows.filter((r) => {
      const ceiling = c.pos[r.bookId];
      if (ceiling === null) return true;
      return r.chapterNum > ceiling;
    });
    console.log(
      `  total rows across 5 queries: ${allRows.length}, violations: ${violations.length}`,
    );
    if (violations.length > 0) {
      console.log("  VIOLATIONS:");
      for (const v of violations.slice(0, 10)) {
        console.log(`    ${v.bookId} ch${v.chapterNum} [${v.chunkIndex}]`);
      }
    }
  }

  console.log("\n========== ACCEPTANCE SUMMARY ==========");
  console.log(
    `  RRF order differs from dense in at least one query: ${rrfDivergenceCount > 0} (${rrfDivergenceCount}/${QUERIES.length})`,
  );
  console.log("  Check above for: (a) each query returned non-empty hybrid top-8, (b) Section 2 'violations: 0' in both cases.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
