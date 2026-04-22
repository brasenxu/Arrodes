/**
 * Per-chapter chunk ingestion: chunk → contextualize → embed → insert.
 *
 * Idempotency: re-running is safe. If any chunk row exists for the chapter,
 * the function returns {skipped: true} without calling the LLM or embedder.
 * That keeps the 005 pipeline resumable without implementing proper retry
 * semantics (which is out-of-scope per the ticket).
 *
 * Transactionality: Neon's HTTP driver doesn't support Drizzle transactions,
 * so per-chapter atomicity relies on a single multi-row INSERT — server-side
 * atomic. If the process dies between chunking and insert, no rows are written;
 * the next run re-does the chapter from scratch.
 */

import { sql } from "drizzle-orm";
import type { EmbeddingModel, LanguageModel } from "ai";
import { db, schema } from "@/lib/db/client";
import { chunkChapter, type RawChunk } from "@/lib/rag/chunking";
import {
  contextualizeChunks,
  zeroContextualizeUsage,
  type ContextualPrefix,
  type ContextualizeUsage,
} from "./contextualize";
import { embedValues } from "./embed";
import type { ContentKind } from "@/lib/db/schema";

export type ChunkIngestUsage = {
  context: ContextualizeUsage;
  embedTokens: number;
};

export const zeroChunkIngestUsage = (): ChunkIngestUsage => ({
  context: zeroContextualizeUsage(),
  embedTokens: 0,
});

export function addChunkIngestUsage(
  target: ChunkIngestUsage,
  delta: ChunkIngestUsage,
): void {
  target.context.noCacheInputTokens += delta.context.noCacheInputTokens;
  target.context.cacheReadTokens += delta.context.cacheReadTokens;
  target.context.cacheWriteTokens += delta.context.cacheWriteTokens;
  target.context.outputTokens += delta.context.outputTokens;
  target.embedTokens += delta.embedTokens;
}

export type ChapterInput = {
  id: number;
  bookId: string;
  chapterNum: number;
  chapterTitle: string;
  rawText: string;
  contentKind: ContentKind;
};

export type ChunkIngestResult = {
  chunksProcessed: number;
  chunksInserted: number;
  skipped: boolean;
  usage: ChunkIngestUsage;
  // Populated for callers that want to inspect results without reading the DB
  // (used by --dry-run to print samples and by the preflight cost sampler).
  chunks?: Array<{
    chunkIndex: number;
    content: string;
    contextualPrefix: string;
  }>;
};

export async function ingestChapterChunks(opts: {
  chapter: ChapterInput;
  contextModel: LanguageModel;
  embedModel: EmbeddingModel;
  dryRun?: boolean;
  returnSamples?: boolean;
}): Promise<ChunkIngestResult> {
  const { chapter, contextModel, embedModel, dryRun, returnSamples } = opts;

  const existing = (await db.execute(sql`
    SELECT 1 FROM chunks WHERE chapter_id = ${chapter.id} LIMIT 1
  `)) as unknown as { rows?: unknown[] };
  if (existing.rows && existing.rows.length > 0) {
    return {
      chunksProcessed: 0,
      chunksInserted: 0,
      skipped: true,
      usage: zeroChunkIngestUsage(),
    };
  }

  const rawChunks: RawChunk[] = chunkChapter(chapter.rawText);
  if (rawChunks.length === 0) {
    return {
      chunksProcessed: 0,
      chunksInserted: 0,
      skipped: false,
      usage: zeroChunkIngestUsage(),
    };
  }

  const header = `${chapter.bookId.toUpperCase()} Chapter ${chapter.chapterNum}: ${chapter.chapterTitle}`;

  const { prefixes, usage: ctxUsage } = await contextualizeChunks({
    model: contextModel,
    chapterText: chapter.rawText,
    chapterHeader: header,
    chunks: rawChunks,
  });

  // contextualize preserves chunk order 1:1, so prefixes[i] aligns with
  // rawChunks[i]. Verify the invariant — a mismatch would mean silently
  // mis-attributed context text for every chunk in the chapter.
  assertAligned(prefixes, rawChunks);

  const values = rawChunks.map(
    (c, i) => `${prefixes[i].contextualPrefix}\n\n${c.content}`,
  );
  const embed = await embedValues({ model: embedModel, values });
  if (embed.embeddings.length !== rawChunks.length) {
    throw new Error(
      `embed returned ${embed.embeddings.length} vectors for ${rawChunks.length} chunks`,
    );
  }

  const usage: ChunkIngestUsage = {
    context: ctxUsage,
    embedTokens: embed.tokensUsed,
  };

  const samples = returnSamples
    ? rawChunks.map((c, i) => ({
        chunkIndex: c.chunkIndex,
        content: c.content,
        contextualPrefix: prefixes[i].contextualPrefix,
      }))
    : undefined;

  if (dryRun) {
    return {
      chunksProcessed: rawChunks.length,
      chunksInserted: 0,
      skipped: false,
      usage,
      chunks: samples,
    };
  }

  const rows = rawChunks.map((c, i) => ({
    chapterId: chapter.id,
    bookId: chapter.bookId,
    chapterNum: chapter.chapterNum,
    chunkIndex: c.chunkIndex,
    totalChunks: rawChunks.length,
    contextualPrefix: prefixes[i].contextualPrefix,
    content: c.content,
    embedding: embed.embeddings[i],
    tokenCount: c.approxTokens,
    contentKind: chapter.contentKind,
    meta: {},
  }));

  await db.insert(schema.chunks).values(rows);

  return {
    chunksProcessed: rawChunks.length,
    chunksInserted: rows.length,
    skipped: false,
    usage,
    chunks: samples,
  };
}

function assertAligned(
  prefixes: ContextualPrefix[],
  chunks: RawChunk[],
): void {
  if (prefixes.length !== chunks.length) {
    throw new Error(
      `contextualize: expected ${chunks.length} prefixes, got ${prefixes.length}`,
    );
  }
  for (let i = 0; i < chunks.length; i++) {
    if (prefixes[i]?.chunkIndex !== chunks[i].chunkIndex) {
      throw new Error(
        `contextualize: prefix/chunk alignment broken at position ${i} (expected chunkIndex ${chunks[i].chunkIndex}, got ${prefixes[i]?.chunkIndex})`,
      );
    }
  }
}
