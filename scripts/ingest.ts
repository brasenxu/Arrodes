/**
 * One-shot ingestion: EPUB -> chapters -> contextual chunks -> entities -> embeddings.
 *
 * Run:
 *   pnpm ingest data/epub/LOTM.epub --book lotm1 --phase chapters
 *   pnpm ingest data/epub/COI.epub  --book coi   --phase chapters
 *   pnpm ingest --book lotm1 --phase chunks                     # preflight only
 *   pnpm ingest --book lotm1 --phase chunks --limit 3 --dry-run # sample + skip DB
 *   pnpm ingest --book lotm1 --phase chunks --yes               # full real run
 *
 * Phases:
 *   chapters — parse EPUB and write `chapters` rows (ticket 003)
 *   chunks   — chunk + contextualize + embed + insert (ticket 005)
 *   ner      — per-chunk NER → entities + entity_mentions (ticket 006)
 *   (later) events, summaries
 */

// Load .env.local first (Next.js convention for local secrets), then .env as
// fallback. `dotenv/config` alone only loads .env, which the project doesn't
// populate.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { asc, eq, sql } from "drizzle-orm";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { db, schema } from "@/lib/db/client";
import { extractChapters } from "@/lib/ingest/chapters";
import type { BookId } from "@/lib/ingest/arc-map";
import {
  addChunkIngestUsage,
  ingestChapterChunks,
  zeroChunkIngestUsage,
  type ChunkIngestUsage,
  type ChapterInput,
} from "@/lib/ingest/chunks";
import {
  addNerUsage,
  buildAliasIndex,
  buildCatalogBlock,
  EntityResolver,
  extractChapterMentions,
  loadEntities,
  zeroNerUsage,
  type ChapterMeta,
  type ChunkInput as NerChunkInput,
  type NerUsage,
  type SampleRow as NerSampleRow,
} from "@/lib/ingest/ner";

// Strips a gateway-style `provider/` prefix if present so env values that were
// originally written for AI Gateway (e.g. "anthropic/claude-haiku-4-5") still
// resolve to the bare provider model ID ("claude-haiku-4-5") under direct wiring.
function bareModelId(envValue: string): string {
  return envValue.includes("/") ? envValue.split("/").slice(-1)[0] : envValue;
}

const BOOK_TITLES: Record<BookId, string> = {
  lotm1: "Lord of the Mysteries",
  coi: "Circle of Inevitability",
};

type Phase = "chapters" | "chunks" | "ner";
const PHASES: readonly Phase[] = ["chapters", "chunks", "ner"] as const;

// $/1M tokens. Tracks the model roster in .claude/plans/2026-04-21_Arrodes-DAB.md.
// Only used for the preflight estimate and the run-end summary — not for
// billing. If INGEST_CONTEXT_MODEL or INGEST_EMBED_MODEL is swapped, update
// these before trusting the number.
const PRICING = {
  haikuInputNoCache: 1.0,
  haikuInputCacheRead: 0.1,
  haikuInputCacheWrite1h: 2.0,
  haikuOutput: 5.0,
  embedSmall: 0.02,
} as const;

function estimateCost(usage: ChunkIngestUsage): number {
  return (
    (usage.context.noCacheInputTokens / 1e6) * PRICING.haikuInputNoCache +
    (usage.context.cacheReadTokens / 1e6) * PRICING.haikuInputCacheRead +
    (usage.context.cacheWriteTokens / 1e6) * PRICING.haikuInputCacheWrite1h +
    (usage.context.outputTokens / 1e6) * PRICING.haikuOutput +
    (usage.embedTokens / 1e6) * PRICING.embedSmall
  );
}

function estimateNerCost(usage: NerUsage): number {
  return (
    (usage.noCacheInputTokens / 1e6) * PRICING.haikuInputNoCache +
    (usage.cacheReadTokens / 1e6) * PRICING.haikuInputCacheRead +
    (usage.cacheWriteTokens / 1e6) * PRICING.haikuInputCacheWrite1h +
    (usage.outputTokens / 1e6) * PRICING.haikuOutput
  );
}

type Args = {
  epubPath: string | null;
  bookId: BookId;
  phase: Phase;
  limit: number | null;
  dryRun: boolean;
  yes: boolean;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);

  // First positional (if any) is the epub path. The chunks phase doesn't
  // require it — chapters come from the DB.
  const epubPath = raw[0] && !raw[0].startsWith("--") ? raw[0] : null;
  const rest = epubPath ? raw.slice(1) : raw;

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

  if (phase === "chapters" && !epubPath) {
    throw new Error(
      "Usage: pnpm ingest <path-to-epub> --book <lotm1|coi> --phase chapters",
    );
  }

  const limitIdx = rest.indexOf("--limit");
  let limit: number | null = null;
  if (limitIdx !== -1) {
    const n = Number(rest[limitIdx + 1]);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error("--limit must be a positive integer");
    }
    limit = n;
  }

  return {
    epubPath,
    bookId,
    phase,
    limit,
    dryRun: rest.includes("--dry-run"),
    yes: rest.includes("--yes"),
  };
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

async function ingestChunksPhase(
  bookId: BookId,
  limit: number | null,
  dryRun: boolean,
  yes: boolean,
): Promise<void> {
  const contextModelEnv = process.env.INGEST_CONTEXT_MODEL;
  const embedModelEnv = process.env.INGEST_EMBED_MODEL;
  if (!contextModelEnv) {
    throw new Error("INGEST_CONTEXT_MODEL is not set in .env.local");
  }
  if (!embedModelEnv) {
    throw new Error("INGEST_EMBED_MODEL is not set in .env.local");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set in .env.local");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set in .env.local");
  }

  // Direct provider wiring (bypasses AI Gateway). See .env.example for the
  // AI Gateway variant. Both model ID formats are accepted.
  const contextModelId = bareModelId(contextModelEnv);
  const embedModelId = bareModelId(embedModelEnv);
  const contextModel = anthropic(contextModelId);
  const embedModel = openai.embedding(embedModelId);

  console.log(
    `[chunks] book=${bookId} contextModel=anthropic:${contextModelId} embedModel=openai:${embedModelId}`,
  );

  const allChapters = await db
    .select({
      id: schema.chapters.id,
      bookId: schema.chapters.bookId,
      chapterNum: schema.chapters.chapterNum,
      chapterTitle: schema.chapters.chapterTitle,
      rawText: schema.chapters.rawText,
      contentKind: schema.chapters.contentKind,
    })
    .from(schema.chapters)
    .where(eq(schema.chapters.bookId, bookId))
    .orderBy(asc(schema.chapters.chapterNum));

  if (allChapters.length === 0) {
    throw new Error(
      `[chunks] no chapters found for ${bookId}. Run --phase chapters first.`,
    );
  }

  // Fetch chapter_ids that already have at least one chunk so re-runs resume
  // rather than re-spend Haiku tokens.
  const doneRows = await db
    .selectDistinct({ chapterId: schema.chunks.chapterId })
    .from(schema.chunks)
    .where(eq(schema.chunks.bookId, bookId));
  const doneSet = new Set(doneRows.map((r) => r.chapterId));

  const undone = allChapters.filter((c) => !doneSet.has(c.id));
  const target: ChapterInput[] = (limit != null ? undone.slice(0, limit) : undone) as ChapterInput[];

  console.log(
    `[chunks] ${allChapters.length} chapters total, ${doneSet.size} already chunked, ${undone.length} remaining, ${target.length} targeted this run`,
  );

  if (target.length === 0) {
    console.log("[chunks] nothing to do");
    return;
  }

  // --- Dry run branch: no preflight gate, no DB writes. Runs contextualize +
  // embed on `target` chapters to produce actual prefixes, prints samples for
  // the first 3 (or all if target is smaller), and reports measured cost.
  if (dryRun) {
    console.log(
      `[chunks] DRY RUN — processing ${target.length} chapters without DB writes`,
    );
    const usage = zeroChunkIngestUsage();
    let totalChunks = 0;
    const SAMPLE_LIMIT = Math.min(3, target.length);
    for (let i = 0; i < target.length; i++) {
      const ch = target[i];
      const r = await ingestChapterChunks({
        chapter: ch,
        contextModel,
        embedModel,
        dryRun: true,
        returnSamples: i < SAMPLE_LIMIT,
      });
      addChunkIngestUsage(usage, r.usage);
      totalChunks += r.chunksProcessed;
      if (i < SAMPLE_LIMIT && r.chunks) {
        console.log(
          `\n[chunks] --- Ch${ch.chapterNum} "${ch.chapterTitle}" (${r.chunks.length} chunks) ---`,
        );
        for (const s of r.chunks) {
          const contentPreview = s.content.replace(/\s+/g, " ").slice(0, 120);
          console.log(
            `  [${s.chunkIndex}] prefix=${JSON.stringify(s.contextualPrefix)}`,
          );
          console.log(`       content=${JSON.stringify(contentPreview + "…")}`);
        }
      }
    }
    console.log(
      `\n[chunks] dry-run complete — ${target.length} chapters, ${totalChunks} chunks, measured cost $${estimateCost(usage).toFixed(4)}`,
    );
    console.log(
      `[chunks] token spend: noCache=${usage.context.noCacheInputTokens} cacheRead=${usage.context.cacheReadTokens} cacheWrite=${usage.context.cacheWriteTokens} output=${usage.context.outputTokens} embed=${usage.embedTokens}`,
    );
    return;
  }

  // --- Preflight branch: sample 5 chapters (or fewer if target is smaller)
  // through contextualize + embed with dryRun=true, extrapolate, require
  // --yes before spending on the full run.
  const SAMPLE_SIZE = Math.min(5, target.length);
  console.log(
    `[chunks] preflight: sampling ${SAMPLE_SIZE} chapters for cost estimate`,
  );
  const sampleUsage = zeroChunkIngestUsage();
  let sampleChunks = 0;
  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const ch = target[i];
    const r = await ingestChapterChunks({
      chapter: ch,
      contextModel,
      embedModel,
      dryRun: true,
    });
    addChunkIngestUsage(sampleUsage, r.usage);
    sampleChunks += r.chunksProcessed;
    console.log(
      `[chunks]   sample ${i + 1}/${SAMPLE_SIZE}: Ch${ch.chapterNum} → ${r.chunksProcessed} chunks`,
    );
  }
  const sampleCost = estimateCost(sampleUsage);
  const perChapterCost = sampleCost / SAMPLE_SIZE;
  const projectedCost = perChapterCost * target.length;
  const projectedChunks = Math.round(
    (sampleChunks / SAMPLE_SIZE) * target.length,
  );
  console.log(
    `[chunks] sample cost: $${sampleCost.toFixed(4)} (${sampleChunks} chunks across ${SAMPLE_SIZE} chapters)`,
  );
  console.log(
    `[chunks] Estimated cost: $${projectedCost.toFixed(2)} for ${target.length} chapters (~${projectedChunks} chunks)`,
  );

  if (!yes) {
    console.log(
      "[chunks] preflight complete — pass --yes to proceed with the real run",
    );
    return;
  }

  // --- Real run: process every target chapter, running totals every 10.
  console.log(`[chunks] proceeding with real run on ${target.length} chapters`);
  const totalUsage = zeroChunkIngestUsage();
  let insertedChunks = 0;
  let skippedChapters = 0;
  let processedChapters = 0;
  for (const ch of target) {
    const r = await ingestChapterChunks({
      chapter: ch,
      contextModel,
      embedModel,
      dryRun: false,
    });
    if (r.skipped) {
      skippedChapters++;
    } else {
      addChunkIngestUsage(totalUsage, r.usage);
      insertedChunks += r.chunksInserted;
    }
    processedChapters++;
    if (processedChapters % 10 === 0 || processedChapters === target.length) {
      console.log(
        `[chunks]   ${processedChapters}/${target.length} chapters (${insertedChunks} chunks, $${estimateCost(totalUsage).toFixed(2)} so far, ${skippedChapters} skipped)`,
      );
    }
  }

  console.log(
    `[chunks] DONE — ${processedChapters} chapters processed, ${insertedChunks} chunks inserted, ${skippedChapters} skipped`,
  );
  console.log(
    `[chunks] token spend: noCache=${totalUsage.context.noCacheInputTokens} cacheRead=${totalUsage.context.cacheReadTokens} cacheWrite=${totalUsage.context.cacheWriteTokens} output=${totalUsage.context.outputTokens} embed=${totalUsage.embedTokens}`,
  );
  console.log(`[chunks] estimated total cost: $${estimateCost(totalUsage).toFixed(2)}`);
}

// ---------------------------------------------------------------------------
// NER phase (ticket 006): per-chunk NER via alias scan + Haiku. Shares the
// preflight/dry-run/--yes gate shape of the chunks phase, but the sampling
// unit is chunks (50 chunks across a few chapters) rather than whole chapters.
// ---------------------------------------------------------------------------

type NerTarget = {
  chapter: ChapterMeta;
  chunks: NerChunkInput[];
};

// Sampling sizes chosen so the cache-read side of the cost mix is realistic:
// preflight drains ~50 chunks across whole chapters (matches ticket 006 AC).
const NER_SAMPLE_CHUNK_TARGET = 50;
const NER_PROGRESS_INTERVAL_CHAPTERS = 10;

async function fetchNerTargets(bookId: BookId): Promise<NerTarget[]> {
  const allChapters = await db
    .select({
      id: schema.chapters.id,
      bookId: schema.chapters.bookId,
      chapterNum: schema.chapters.chapterNum,
      chapterTitle: schema.chapters.chapterTitle,
      rawText: schema.chapters.rawText,
    })
    .from(schema.chapters)
    .where(eq(schema.chapters.bookId, bookId))
    .orderBy(asc(schema.chapters.chapterNum));

  if (allChapters.length === 0) {
    throw new Error(
      `[ner] no chapters found for ${bookId}. Run --phase chapters first.`,
    );
  }

  // Fetch chunks that have zero entity_mentions. Resumability is per-chunk
  // (ticket 006 AC) — if a previous run covered some chunks in a chapter but
  // crashed before the chapter's batch insert, those rows don't exist, so all
  // of the chapter's chunks reappear here. In practice inserts are per-chapter
  // atomic, so chapters are mostly all-or-nothing.
  const res = (await db.execute(sql`
    SELECT c.id, c.chapter_id, c.chunk_index, c.content
    FROM chunks c
    WHERE c.book_id = ${bookId}
      AND NOT EXISTS (
        SELECT 1 FROM entity_mentions em WHERE em.chunk_id = c.id
      )
    ORDER BY c.chapter_id, c.chunk_index
  `)) as unknown as {
    rows: Array<{
      id: number;
      chapter_id: number;
      chunk_index: number;
      content: string;
    }>;
  };

  const byChapter = new Map<number, NerChunkInput[]>();
  for (const r of res.rows ?? []) {
    let arr = byChapter.get(r.chapter_id);
    if (!arr) {
      arr = [];
      byChapter.set(r.chapter_id, arr);
    }
    arr.push({
      id: r.id,
      chunkIndex: r.chunk_index,
      content: r.content,
    });
  }

  const targets: NerTarget[] = [];
  for (const ch of allChapters) {
    const chunks = byChapter.get(ch.id);
    if (!chunks || chunks.length === 0) continue;
    targets.push({ chapter: ch, chunks });
  }
  return targets;
}

// Caps the number of chunks processed across the target chapters. Truncates
// the last chapter's chunk list if necessary so we never exceed the cap.
function capNerTargets(targets: NerTarget[], maxChunks: number): NerTarget[] {
  const out: NerTarget[] = [];
  let remaining = maxChunks;
  for (const t of targets) {
    if (remaining <= 0) break;
    if (t.chunks.length <= remaining) {
      out.push(t);
      remaining -= t.chunks.length;
    } else {
      out.push({ chapter: t.chapter, chunks: t.chunks.slice(0, remaining) });
      remaining = 0;
    }
  }
  return out;
}

function countChunks(targets: NerTarget[]): number {
  return targets.reduce((acc, t) => acc + t.chunks.length, 0);
}

function printNerSamples(samples: NerSampleRow[]): void {
  for (const s of samples) {
    console.log(
      `  [chunk#${s.chunkId} idx=${s.chunkIndex} haiku=${s.calledHaiku ? "yes" : "no"}]`,
    );
    console.log(`       content=${JSON.stringify(s.contentPreview + "…")}`);
    if (s.mentions.length === 0) {
      console.log("       (no mentions)");
    } else {
      for (const m of s.mentions) {
        console.log(
          `       → ${m.canonicalName} [${m.role ?? "null"}]`,
        );
      }
    }
  }
}

async function ingestNerPhase(
  bookId: BookId,
  limit: number | null,
  dryRun: boolean,
  yes: boolean,
): Promise<void> {
  const contextModelEnv = process.env.INGEST_CONTEXT_MODEL;
  if (!contextModelEnv) {
    throw new Error("INGEST_CONTEXT_MODEL is not set in .env.local");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set in .env.local");
  }

  const contextModelId = bareModelId(contextModelEnv);
  const contextModel = anthropic(contextModelId);
  console.log(`[ner] book=${bookId} nerModel=anthropic:${contextModelId}`);

  // Load entities once — the catalog block is reused across every Haiku call
  // (byte-identical, so it cache-reads across the whole ingest after the first
  // call writes it).
  const entities = await loadEntities();
  if (entities.length === 0) {
    throw new Error(
      "[ner] entities table is empty. Run `pnpm seed:entities` first.",
    );
  }
  const aliasIndex = buildAliasIndex(entities);
  const catalogBlock = buildCatalogBlock(entities);
  // Dry-run and preflight paths use a dry-run resolver: novel names get
  // negative pseudo-IDs and are NOT persisted. The real-run path below builds
  // its own resolver that actually writes.
  const readonlyResolver = new EntityResolver(aliasIndex, { dryRun: true });
  console.log(
    `[ner] loaded ${entities.length} canonical entities (${aliasIndex.patterns.length} alias patterns)`,
  );

  const allTargets = await fetchNerTargets(bookId);
  const totalUndoneChunks = countChunks(allTargets);
  console.log(
    `[ner] ${allTargets.length} chapters have unprocessed chunks (${totalUndoneChunks} chunks total)`,
  );

  if (allTargets.length === 0 || totalUndoneChunks === 0) {
    console.log("[ner] nothing to do");
    return;
  }

  // --limit caps total chunks processed (not chapters), matching ticket 006's
  // preflight unit. Also applies to dry-run.
  const targets =
    limit != null ? capNerTargets(allTargets, limit) : allTargets;
  const targetChunkCount = countChunks(targets);
  if (limit != null) {
    console.log(
      `[ner] --limit ${limit} applied: ${targets.length} chapters, ${targetChunkCount} chunks this run`,
    );
  }

  // --- Dry run branch: real Haiku calls, no DB writes, sample dumps.
  if (dryRun) {
    console.log(
      `[ner] DRY RUN — processing ${targets.length} chapters (${targetChunkCount} chunks) without DB writes`,
    );
    const usage = zeroNerUsage();
    let sampledChapters = 0;
    const SAMPLE_CHAPTERS = Math.min(3, targets.length);
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const r = await extractChapterMentions({
        chapter: t.chapter,
        chunks: t.chunks,
        aliasIndex,
        entityResolver: readonlyResolver,
        model: contextModel,
        catalogBlock,
        dryRun: true,
        returnSamples: i < SAMPLE_CHAPTERS,
      });
      addNerUsage(usage, r.usage);
      if (i < SAMPLE_CHAPTERS && r.samples) {
        sampledChapters++;
        console.log(
          `\n[ner] --- Ch${t.chapter.chapterNum} "${t.chapter.chapterTitle}" (${r.samples.length} chunks) ---`,
        );
        printNerSamples(r.samples);
      }
    }
    const cost = estimateNerCost(usage);
    console.log(
      `\n[ner] dry-run complete — ${targets.length} chapters, ${targetChunkCount} chunks, ${usage.haikuCalls} Haiku calls, measured cost $${cost.toFixed(4)}`,
    );
    console.log(
      `[ner] token spend: noCache=${usage.noCacheInputTokens} cacheRead=${usage.cacheReadTokens} cacheWrite=${usage.cacheWriteTokens} output=${usage.outputTokens}`,
    );
    console.log(
      `[ner] (dry-run skipped DB writes; new entities were NOT created) sampled=${sampledChapters} chapters`,
    );
    return;
  }

  // --- Preflight branch: sample ~50 chunks across whole chapters, extrapolate,
  // require --yes.
  const sampleTargets = capNerTargets(targets, NER_SAMPLE_CHUNK_TARGET);
  const sampleChunkCount = countChunks(sampleTargets);
  console.log(
    `[ner] preflight: sampling ${sampleChunkCount} chunks across ${sampleTargets.length} chapters for cost estimate`,
  );
  const sampleUsage = zeroNerUsage();
  for (let i = 0; i < sampleTargets.length; i++) {
    const t = sampleTargets[i];
    const r = await extractChapterMentions({
      chapter: t.chapter,
      chunks: t.chunks,
      aliasIndex,
      entityResolver: readonlyResolver,
      model: contextModel,
      catalogBlock,
      dryRun: true,
    });
    addNerUsage(sampleUsage, r.usage);
    console.log(
      `[ner]   sample ${i + 1}/${sampleTargets.length}: Ch${t.chapter.chapterNum} → ${t.chunks.length} chunks (${r.usage.haikuCalls} Haiku calls)`,
    );
  }
  const sampleCost = estimateNerCost(sampleUsage);
  const perChunkCost = sampleChunkCount > 0 ? sampleCost / sampleChunkCount : 0;
  const projectedCost = perChunkCost * targetChunkCount;
  console.log(
    `[ner] sample cost: $${sampleCost.toFixed(4)} (${sampleChunkCount} chunks, ${sampleUsage.haikuCalls} Haiku calls)`,
  );
  console.log(
    `[ner] Estimated cost: $${projectedCost.toFixed(2)} for ${targetChunkCount} chunks (~${Math.round((sampleUsage.haikuCalls / Math.max(sampleChunkCount, 1)) * targetChunkCount)} Haiku calls projected)`,
  );

  if (!yes) {
    console.log(
      "[ner] preflight complete — pass --yes to proceed with the real run",
    );
    return;
  }

  // --- Real run: fresh resolver (dryRun=false) so novel names actually write.
  // The preflight resolver's pseudo-IDs are discarded; names it saw will be
  // re-resolved (and possibly re-created) during the real pass. This is
  // deliberate: we don't trust the pseudo-ID pool to have seen every name, and
  // reconstructing from scratch keeps the resolver's DB state as the single
  // source of truth.
  const writeResolver = new EntityResolver(aliasIndex, { dryRun: false });
  console.log(
    `[ner] proceeding with real run on ${targets.length} chapters (${targetChunkCount} chunks)`,
  );
  const totalUsage = zeroNerUsage();
  let insertedMentions = 0;
  let processedChunks = 0;
  let processedChapters = 0;
  for (const t of targets) {
    const r = await extractChapterMentions({
      chapter: t.chapter,
      chunks: t.chunks,
      aliasIndex,
      entityResolver: writeResolver,
      model: contextModel,
      catalogBlock,
      dryRun: false,
    });
    addNerUsage(totalUsage, r.usage);
    insertedMentions += r.mentionsInserted;
    processedChunks += r.chunksProcessed;
    processedChapters++;
    if (
      processedChapters % NER_PROGRESS_INTERVAL_CHAPTERS === 0 ||
      processedChapters === targets.length
    ) {
      console.log(
        `[ner]   ${processedChapters}/${targets.length} chapters (${processedChunks} chunks, ${insertedMentions} mentions, ${writeResolver.newEntitiesCreated()} new entities, $${estimateNerCost(totalUsage).toFixed(2)} so far)`,
      );
    }
  }

  console.log(
    `[ner] DONE — ${processedChapters} chapters, ${processedChunks} chunks, ${insertedMentions} mentions inserted, ${writeResolver.newEntitiesCreated()} new entities created`,
  );
  console.log(
    `[ner] token spend: noCache=${totalUsage.noCacheInputTokens} cacheRead=${totalUsage.cacheReadTokens} cacheWrite=${totalUsage.cacheWriteTokens} output=${totalUsage.outputTokens} haikuCalls=${totalUsage.haikuCalls}`,
  );
  console.log(
    `[ner] estimated total cost: $${estimateNerCost(totalUsage).toFixed(2)}`,
  );
}

async function main() {
  const args = parseArgs();
  console.log(
    `Ingest book=${args.bookId} phase=${args.phase}${args.epubPath ? ` epub=${args.epubPath}` : ""}${args.limit != null ? ` limit=${args.limit}` : ""}${args.dryRun ? " dry-run" : ""}${args.yes ? " yes" : ""}`,
  );

  switch (args.phase) {
    case "chapters":
      // parseArgs() has already enforced that epubPath is set for this phase.
      await ingestChapters(args.epubPath!, args.bookId);
      break;
    case "chunks":
      await ingestChunksPhase(
        args.bookId,
        args.limit,
        args.dryRun,
        args.yes,
      );
      break;
    case "ner":
      await ingestNerPhase(
        args.bookId,
        args.limit,
        args.dryRun,
        args.yes,
      );
      break;
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
