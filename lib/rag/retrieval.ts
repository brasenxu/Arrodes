import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { BookId, ReadingPosition, RetrievedChunk } from "./types";

// Question-style stopwords + common filler. Keeps content nouns (names,
// places, pathway terms) intact. Intentionally small — `to_tsquery('english',…)`
// already applies stemming + Postgres's own stopword dictionary on top.
const STOPWORDS: ReadonlySet<string> = new Set([
  "a","an","the",
  "of","in","on","for","to","and","or","but","with","by","at","from","into","about","across","as","if","so","then","than","also",
  "is","are","was","were","be","been","being",
  "has","have","had","do","does","did",
  "will","would","could","should","can","may","might",
  "what","who","whom","whose","when","where","why","how","which",
  "that","this","these","those",
  "he","she","it","they","them","him","his","her","hers","its","their","theirs",
  "i","me","my","mine","we","our","ours","us","you","your","yours",
  "list","summarize","summarise","describe","explain","tell","give","show","mention","name",
  "every","any","some","all","each","both","few","many",
]);

/**
 * Tokenises a natural-language question into an OR-joined `to_tsquery` string.
 * Returns null when the query has no content tokens (all stopwords).
 *
 * Why not `plainto_tsquery`? It ANDs every stemmed term, so questions like
 * "Summarize chapter 1 of Lord of the Mysteries." require every stem in a
 * single chunk and return zero hits (ticket 009 probe). OR-joining lets sparse
 * contribute to RRF for natural-language queries.
 */
export function buildTsquery(queryText: string): string | null {
  const tokens = queryText.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const t of tokens) {
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    kept.push(t);
  }
  return kept.length === 0 ? null : kept.join(" | ");
}

/**
 * Hybrid search: dense (pgvector <=>) ⊕ sparse (tsvector ts_rank) combined via
 * Reciprocal Rank Fusion. Pre-filters on reading_position (spoiler control)
 * BEFORE scoring — post-filter would starve top-k.
 */
export async function hybridSearch(args: {
  queryEmbedding: number[];
  queryText: string;
  books: BookId[];
  position: ReadingPosition;
  limit?: number;
}): Promise<RetrievedChunk[]> {
  const k = args.limit ?? 8;
  const embedLiteral = `[${args.queryEmbedding.join(",")}]`;

  // Per-book chapter ceilings for spoiler control.
  // A book with position=null is excluded entirely (user hasn't opted in).
  const bookCeilings = args.books
    .map((b) => ({ book: b, max: args.position[b] }))
    .filter((b): b is { book: BookId; max: number } => b.max !== null);

  if (bookCeilings.length === 0) return [];

  const bookFilter = sql.join(
    bookCeilings.map(
      (b) => sql`(book_id = ${b.book} AND chapter_num <= ${b.max})`,
    ),
    sql` OR `,
  );

  // Content-token OR query. Null ⇒ sparse branch contributes nothing (still
  // shape-compatible with the UNION so RRF keeps evaluating).
  const tsqueryStr = buildTsquery(args.queryText);
  const sparseCte = tsqueryStr
    ? sql`
      SELECT id, ROW_NUMBER() OVER (
        ORDER BY ts_rank(tsv, to_tsquery('english', ${tsqueryStr})) DESC
      ) AS r
      FROM chunks
      WHERE tsv @@ to_tsquery('english', ${tsqueryStr})
        AND (${bookFilter})
      LIMIT 20
    `
    : sql`SELECT NULL::int AS id, NULL::bigint AS r WHERE FALSE`;

  const result = await db.execute<{
    id: number;
    book_id: BookId;
    chapter_num: number;
    chapter_title: string;
    chunk_index: number;
    content: string;
    contextual_prefix: string;
    score: number;
  }>(sql`
    WITH dense AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${embedLiteral}::vector) AS r
      FROM chunks
      WHERE ${bookFilter}
      ORDER BY embedding <=> ${embedLiteral}::vector
      LIMIT 20
    ),
    sparse AS (${sparseCte}),
    fused AS (
      SELECT id, SUM(1.0 / (60 + r)) AS score
      FROM (SELECT id, r FROM dense UNION ALL SELECT id, r FROM sparse) u
      GROUP BY id
      ORDER BY score DESC
      LIMIT ${k}
    )
    SELECT
      c.id, c.book_id, c.chapter_num, ch.chapter_title,
      c.chunk_index, c.content, c.contextual_prefix,
      f.score
    FROM fused f
    JOIN chunks c ON c.id = f.id
    JOIN chapters ch ON ch.id = c.chapter_id
    ORDER BY f.score DESC
  `);

  const rows = Array.isArray(result) ? result : result.rows;
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    chapterNum: r.chapter_num,
    chapterTitle: r.chapter_title,
    chunkIndex: r.chunk_index,
    content: r.content,
    contextualPrefix: r.contextual_prefix,
    score: Number(r.score),
    source: "epub" as const,
  }));
}
