import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { BookId, ReadingPosition, RetrievedChunk } from "./types";

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
    sparse AS (
      SELECT id, ROW_NUMBER() OVER (
        ORDER BY ts_rank(tsv, plainto_tsquery('english', ${args.queryText})) DESC
      ) AS r
      FROM chunks
      WHERE tsv @@ plainto_tsquery('english', ${args.queryText})
        AND (${bookFilter})
      LIMIT 20
    ),
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
