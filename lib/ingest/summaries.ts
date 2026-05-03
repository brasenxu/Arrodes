import { generateText, type EmbeddingModel, type LanguageModel } from "ai";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { embedValues } from "./embed";

export type SummaryLevel = "chapter" | "arc" | "volume" | "series";

type ContentKind = "main" | "side_story" | "bonus";

export type SummaryTargetBase = {
  level: SummaryLevel;
  bookId: string;
  rangeStart: number;
  rangeEnd: number;
  label: string;
};

export type ChapterSourceRow = {
  chapterId: number;
  bookId: string;
  chapterNum: number;
  chapterTitle: string;
  volume: number;
  volumeName: string;
  arc: number;
  arcName: string;
  contentKind: ContentKind;
  chunkIndex: number;
  contextualPrefix: string;
};

export type ChapterSummaryTarget = SummaryTargetBase & {
  level: "chapter";
  chapterId: number;
  chapterNum: number;
  chapterTitle: string;
  volume: number;
  volumeName: string;
  arc: number;
  arcName: string;
  contentKind: ContentKind;
  contextualPrefixes: string[];
};

export type SummaryMeta = {
  volume?: number;
  volumeName?: string;
  arc?: number;
  arcName?: string;
  contentKind?: ContentKind;
};

export type SummaryRow = SummaryTargetBase & {
  content: string;
  meta: SummaryMeta;
};

export type RollupSummaryTarget = SummaryTargetBase & {
  level: "arc" | "volume" | "series";
  volume?: number;
  volumeName?: string;
  arc?: number;
  arcName?: string;
  contentKind: ContentKind;
  inputs: SummaryRow[];
};

export type SummaryTarget = ChapterSummaryTarget | RollupSummaryTarget;

export type SummaryPrompt = {
  system: string;
  user: string;
  maxWords: number;
};

export type TokenBucket = {
  noCacheInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  calls: number;
};

export type SummaryUsage = {
  context: TokenBucket;
  summary: TokenBucket;
  embedTokens: number;
};

export type SummaryInsertRow = {
  level: SummaryLevel;
  bookId: string;
  rangeStart: number;
  rangeEnd: number;
  label: string;
  content: string;
  embedding: number[];
};

export type SummaryDbRow = {
  level: SummaryLevel;
  book_id: string;
  range_start: number;
  range_end: number;
  label: string;
  content: string;
  meta: SummaryMeta | null;
  volume_count?: number | string | null;
  volume_name_count?: number | string | null;
  arc_count?: number | string | null;
  arc_name_count?: number | string | null;
  content_kind_count?: number | string | null;
  main_volume_count?: number | string | null;
  main_volume_name_count?: number | string | null;
};

export type ChapterChunkCoverageRow = {
  chapterNum: number;
  chunkCount: number | string;
};

export type SummaryChunkCoverage = {
  totalChapters: number;
  chunkedChapters: number;
  missingChapterNums: number[];
};

export type PlanNextSummaryTargetsOptions = {
  chapterTargets: ChapterSummaryTarget[];
  chapterSummaries: SummaryRow[];
  arcSummaries: SummaryRow[];
  volumeSummaries: SummaryRow[];
  bookTitles: Record<string, string>;
  existingKeys: Set<string>;
  limit: number | null;
};

export type SummaryGenerateFn = (opts: {
  target: SummaryTarget;
  prompt: SummaryPrompt;
  bucket: TokenBucket;
}) => Promise<string>;

export type SummaryEmbedFn = (values: string[]) => Promise<{
  embeddings: number[][];
  tokensUsed: number;
}>;

export function makeSummaryKey(target: SummaryTargetBase): string {
  return `${target.level}|${target.bookId}|${target.rangeStart}|${target.rangeEnd}|${target.label}`;
}

export function filterMissingTargets<T extends SummaryTargetBase>(
  targets: T[],
  existingKeys: Set<string>,
): T[] {
  return targets.filter((target) => !existingKeys.has(makeSummaryKey(target)));
}

export function takePendingTargets<T>(targets: T[], limit: number | null): T[] {
  if (limit === null) {
    return targets;
  }

  return targets.slice(0, limit);
}

export function countTargetsByLevel(targets: SummaryTarget[]): Record<SummaryLevel, number> {
  return targets.reduce<Record<SummaryLevel, number>>(
    (counts, target) => {
      counts[target.level] += 1;
      return counts;
    },
    { chapter: 0, arc: 0, volume: 0, series: 0 },
  );
}

export function summarizeChunkCoverage(rows: ChapterChunkCoverageRow[]): SummaryChunkCoverage {
  const missingChapterNums: number[] = [];
  let chunkedChapters = 0;

  for (const row of rows) {
    const chunkCount =
      typeof row.chunkCount === "number" ? row.chunkCount : Number(row.chunkCount);
    if (chunkCount > 0) {
      chunkedChapters++;
    } else {
      missingChapterNums.push(row.chapterNum);
    }
  }

  return {
    totalChapters: rows.length,
    chunkedChapters,
    missingChapterNums,
  };
}

export function assertCompleteChunkCoverage(
  bookId: string,
  coverage: SummaryChunkCoverage,
): void {
  if (coverage.chunkedChapters !== coverage.totalChapters) {
    throw new Error(
      `[summaries] chunk coverage incomplete for ${bookId}: ${coverage.chunkedChapters}/${coverage.totalChapters} chapters have chunks. Run --phase chunks first.`,
    );
  }
}

export function resolveDeepSeekSummaryModelId(envValue: string): string {
  const errorMessage =
    "[summaries] summaries ingest currently supports DeepSeek summary models only. Set INGEST_SUMMARY_MODEL=deepseek-v4-pro or another DeepSeek model.";

  if (!envValue.includes("/")) {
    if (!envValue.startsWith("deepseek-")) {
      throw new Error(errorMessage);
    }
    return envValue;
  }

  const [provider, ...modelParts] = envValue.split("/");
  const modelId = modelParts.join("/");
  if (provider !== "deepseek" || !modelId.startsWith("deepseek-")) {
    throw new Error(errorMessage);
  }

  return modelId;
}

export function summaryRowFromChapterTarget(
  target: ChapterSummaryTarget,
  content: string,
): SummaryRow {
  return {
    level: "chapter",
    bookId: target.bookId,
    rangeStart: target.rangeStart,
    rangeEnd: target.rangeEnd,
    label: target.label,
    content,
    meta: {
      volume: target.volume,
      volumeName: target.volumeName,
      arc: target.arc,
      arcName: target.arcName,
      contentKind: target.contentKind,
    },
  };
}

export function selectRepresentativeArcChapterGroups(
  chapterTargets: ChapterSummaryTarget[],
  maxGroups: number,
): ChapterSummaryTarget[][] {
  const groups = new Map<string, ChapterSummaryTarget[]>();

  for (const target of chapterTargets) {
    const key = [
      target.bookId,
      target.volume,
      target.volumeName,
      target.arc,
      target.arcName,
      target.contentKind,
    ].join("|");
    const group = groups.get(key) ?? [];
    group.push(target);
    groups.set(key, group);
  }

  const sortedGroups = [...groups.values()]
    .map((group) => [...group].sort((left, right) => left.chapterNum - right.chapterNum))
    .sort((left, right) => {
      const lengthDiff = right.length - left.length;
      if (lengthDiff !== 0) return lengthDiff;
      return left[0].chapterNum - right[0].chapterNum;
    });
  const mainGroups = sortedGroups.filter((group) => group[0].contentKind === "main");
  const candidateGroups = mainGroups.length > 0 ? mainGroups : sortedGroups;

  return candidateGroups.slice(0, maxGroups);
}

/** Max chapters generated per arc during first-run preflight cost sampling (bounds LLM calls). */
export const SUMMARY_ARC_PREFLIGHT_MAX_CHAPTERS_PER_ARC = 8;

/** Earliest chapters by `chapterNum` (for bounded arc preflight samples). */
export function limitChapterTargetsForArcPreflight(
  group: ChapterSummaryTarget[],
  maxChapters: number,
): ChapterSummaryTarget[] {
  if (maxChapters <= 0) {
    return [];
  }
  const sorted = [...group].sort((a, b) => a.chapterNum - b.chapterNum);
  return sorted.slice(0, maxChapters);
}

export function planNextSummaryTargets(opts: PlanNextSummaryTargetsOptions): SummaryTarget[] {
  const missingChapterTargets = filterMissingTargets(opts.chapterTargets, opts.existingKeys);
  if (missingChapterTargets.length > 0) {
    return takePendingTargets(missingChapterTargets, opts.limit);
  }

  const missingArcTargets = filterMissingTargets(
    buildArcTargets(opts.chapterSummaries),
    opts.existingKeys,
  );
  if (missingArcTargets.length > 0) {
    return takePendingTargets(missingArcTargets, opts.limit);
  }

  const missingVolumeTargets = filterMissingTargets(
    buildVolumeTargets(opts.arcSummaries),
    opts.existingKeys,
  );
  if (missingVolumeTargets.length > 0) {
    return takePendingTargets(missingVolumeTargets, opts.limit);
  }

  return takePendingTargets(
    filterMissingTargets(buildSeriesTargets(opts.volumeSummaries, opts.bookTitles), opts.existingKeys),
    opts.limit,
  );
}

export function mapSummaryDbRow(row: SummaryDbRow): SummaryRow {
  validateSummaryDbRow(row);

  return {
    level: row.level,
    bookId: row.book_id,
    rangeStart: row.range_start,
    rangeEnd: row.range_end,
    label: row.label,
    content: row.content,
    meta: row.meta ?? {},
  };
}

export function dedupeSummaryRows(rows: SummaryRow[]): SummaryRow[] {
  const seen = new Set<string>();
  const deduped: SummaryRow[] = [];

  for (const row of rows) {
    const key = makeSummaryKey(row);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

export function zeroTokenBucket(): TokenBucket {
  return {
    noCacheInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    calls: 0,
  };
}

export function zeroSummaryUsage(): SummaryUsage {
  return {
    context: zeroTokenBucket(),
    summary: zeroTokenBucket(),
    embedTokens: 0,
  };
}

export function addSummaryUsage(total: SummaryUsage, addition: SummaryUsage): SummaryUsage {
  addTokenBucket(total.context, addition.context);
  addTokenBucket(total.summary, addition.summary);
  total.embedTokens += addition.embedTokens;

  return total;
}

export function estimateSummaryCost(usage: SummaryUsage): number {
  return (
    estimateBucketCost(usage.context, {
      noCacheInputTokens: 0.14,
      cacheReadTokens: 0.028,
      cacheWriteTokens: 0.14,
      outputTokens: 0.28,
    }) +
    estimateBucketCost(usage.summary, {
      noCacheInputTokens: 1.74,
      cacheReadTokens: 0.145,
      cacheWriteTokens: 1.74,
      outputTokens: 3.48,
    }) +
    (usage.embedTokens * 0.02) / 1_000_000
  );
}

export function buildSummaryPrompt(target: SummaryTarget): SummaryPrompt {
  const maxWords = maxWordsForLevel(target.level);
  const system = [
    "Summarize only the supplied range.",
    "Do not include future events, later identities, or canon not present in the supplied input.",
    "Write concise narrative prose.",
    "Preserve concrete names, events, and causes when supplied.",
  ].join(" ");

  if (target.level === "chapter") {
    return {
      system,
      maxWords,
      user: [
        `Target: ${target.label}`,
        `Book: ${target.bookId}`,
        `Volume: ${target.volume} - ${target.volumeName}`,
        `Arc: ${target.arc} - ${target.arcName}`,
        `Content kind: ${target.contentKind}`,
        "",
        "Contextual prefixes:",
        ...target.contextualPrefixes.map((prefix, index) => `${index + 1}. ${prefix}`),
      ].join("\n"),
    };
  }

  return {
    system,
    maxWords,
    user: [
      `Target: ${target.label}`,
      `Book: ${target.bookId}`,
      `Level: ${target.level}`,
      `Content kind: ${target.contentKind}`,
      "",
      "Input summaries:",
      ...target.inputs.map((input, index) => `${index + 1}. ${input.label}: ${input.content}`),
    ].join("\n"),
  };
}

export function rowForSummaryInsert(
  target: SummaryTarget,
  content: string,
  embedding: number[],
): SummaryInsertRow {
  return {
    level: target.level,
    bookId: target.bookId,
    rangeStart: target.rangeStart,
    rangeEnd: target.rangeEnd,
    label: target.label,
    content,
    embedding,
  };
}

export async function loadSummaryChunkCoverage(bookId: string): Promise<SummaryChunkCoverage> {
  const result = (await db.execute(sql`
    SELECT
      ch.chapter_num,
      count(c.id)::int AS chunk_count
    FROM chapters ch
    LEFT JOIN chunks c ON c.chapter_id = ch.id
    WHERE ch.book_id = ${bookId}
    GROUP BY ch.id, ch.chapter_num
    ORDER BY ch.chapter_num
  `)) as unknown as {
    rows: Array<{
      chapter_num: number;
      chunk_count: number | string;
    }>;
  };

  return summarizeChunkCoverage(
    result.rows.map((row) => ({
      chapterNum: row.chapter_num,
      chunkCount: row.chunk_count,
    })),
  );
}

export async function loadChapterSourceRows(bookId: string): Promise<ChapterSourceRow[]> {
  const result = (await db.execute(sql`
    SELECT
      ch.id AS chapter_id,
      ch.book_id,
      ch.chapter_num,
      ch.chapter_title,
      ch.volume,
      ch.volume_name,
      ch.arc,
      ch.arc_name,
      ch.content_kind,
      c.chunk_index,
      c.contextual_prefix
    FROM chapters ch
    JOIN chunks c ON c.chapter_id = ch.id
    WHERE ch.book_id = ${bookId}
    ORDER BY ch.chapter_num, c.chunk_index
  `)) as unknown as {
    rows: Array<{
      chapter_id: number;
      book_id: string;
      chapter_num: number;
      chapter_title: string;
      volume: number;
      volume_name: string;
      arc: number;
      arc_name: string;
      content_kind: ContentKind;
      chunk_index: number;
      contextual_prefix: string;
    }>;
  };

  return result.rows.map((row) => ({
    chapterId: row.chapter_id,
    bookId: row.book_id,
    chapterNum: row.chapter_num,
    chapterTitle: row.chapter_title,
    volume: row.volume,
    volumeName: row.volume_name,
    arc: row.arc,
    arcName: row.arc_name,
    contentKind: row.content_kind,
    chunkIndex: row.chunk_index,
    contextualPrefix: row.contextual_prefix,
  }));
}

export async function loadExistingSummaryKeys(bookId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      level: schema.summaries.level,
      bookId: schema.summaries.bookId,
      rangeStart: schema.summaries.rangeStart,
      rangeEnd: schema.summaries.rangeEnd,
      label: schema.summaries.label,
    })
    .from(schema.summaries)
    .where(sql`${schema.summaries.bookId} = ${bookId}`);

  return new Set(
    rows.map((row) =>
      makeSummaryKey({
        level: row.level as SummaryLevel,
        bookId: row.bookId,
        rangeStart: row.rangeStart,
        rangeEnd: row.rangeEnd,
        label: row.label,
      }),
    ),
  );
}

export async function loadSummaryRows(
  bookId: string,
  level: SummaryLevel,
): Promise<SummaryRow[]> {
  const result = (await db.execute(sql`
    WITH summary_rows AS (
      SELECT level, book_id, range_start, range_end, label, content
      FROM summaries
      WHERE book_id = ${bookId}
        AND level = ${level}
    )
    SELECT
      s.level,
      s.book_id,
      s.range_start,
      s.range_end,
      s.label,
      s.content,
      count(DISTINCT c.volume) AS volume_count,
      count(DISTINCT c.volume_name) AS volume_name_count,
      count(DISTINCT c.arc) AS arc_count,
      count(DISTINCT c.arc_name) AS arc_name_count,
      count(DISTINCT c.content_kind) AS content_kind_count,
      count(DISTINCT c.volume) FILTER (
        WHERE c.content_kind = 'main' AND c.volume > 0
      ) AS main_volume_count,
      count(DISTINCT c.volume_name) FILTER (
        WHERE c.content_kind = 'main' AND c.volume > 0
      ) AS main_volume_name_count,
      CASE
        WHEN s.level = 'chapter' THEN jsonb_build_object(
          'volume', min(c.volume),
          'volumeName', min(c.volume_name),
          'arc', min(c.arc),
          'arcName', min(c.arc_name),
          'contentKind', min(c.content_kind)
        )
        WHEN s.level = 'arc' THEN jsonb_build_object(
          'volume', min(c.volume),
          'volumeName', min(c.volume_name),
          'arc', min(c.arc),
          'arcName', min(c.arc_name),
          'contentKind', min(c.content_kind)
        )
        WHEN s.level = 'volume' THEN jsonb_build_object(
          'volume', min(c.volume) FILTER (
            WHERE c.content_kind = 'main' AND c.volume > 0
          ),
          'volumeName', min(c.volume_name) FILTER (
            WHERE c.content_kind = 'main' AND c.volume > 0
          ),
          'contentKind', 'main'
        )
        ELSE jsonb_build_object('contentKind', 'main')
      END AS meta
    FROM summary_rows s
    LEFT JOIN chapters c
      ON c.book_id = s.book_id
     AND c.chapter_num BETWEEN s.range_start AND s.range_end
    GROUP BY s.level, s.book_id, s.range_start, s.range_end, s.label, s.content
    ORDER BY s.range_start, s.range_end, s.label
  `)) as unknown as { rows: SummaryDbRow[] };

  return dedupeSummaryRows(result.rows.map(mapSummaryDbRow));
}

export async function insertSummaryRow(row: SummaryInsertRow): Promise<boolean> {
  const embedding = `[${row.embedding.join(",")}]`;

  const raw = await db.execute(sql`
    INSERT INTO summaries (level, book_id, range_start, range_end, label, content, embedding)
    SELECT
      ${row.level},
      ${row.bookId},
      ${row.rangeStart},
      ${row.rangeEnd},
      ${row.label},
      ${row.content},
      ${embedding}::vector
    WHERE NOT EXISTS (
      SELECT 1
      FROM summaries
      WHERE level = ${row.level}
        AND book_id = ${row.bookId}
        AND range_start = ${row.rangeStart}
        AND range_end = ${row.rangeEnd}
        AND label = ${row.label}
    )
    RETURNING id
  `);
  if (Array.isArray(raw)) {
    return raw.length > 0;
  }
  const result = raw as unknown as {
    rows?: Array<Record<string, unknown>>;
    rowCount?: number;
  };
  if (Array.isArray(result.rows)) {
    return result.rows.length > 0;
  }
  if (typeof result.rowCount === "number") {
    return result.rowCount > 0;
  }
  return false;
}

export async function deleteSummariesForBook(bookId: string): Promise<number | null> {
  const result = (await db.execute(sql`
    DELETE FROM summaries
    WHERE book_id = ${bookId}
  `)) as unknown as { rowCount?: number };

  return typeof result.rowCount === "number" ? result.rowCount : null;
}

export async function summarizeOneTarget(opts: {
  target: SummaryTarget;
  generate: SummaryGenerateFn;
  embed: SummaryEmbedFn;
}): Promise<{ row: SummaryInsertRow; usage: SummaryUsage }> {
  const { target, generate, embed } = opts;
  const usage = zeroSummaryUsage();
  const prompt = buildSummaryPrompt(target);
  const bucket = target.level === "chapter" ? usage.context : usage.summary;
  const content = await generate({ target, prompt, bucket });
  const embedded = await embed([content]);

  if (embedded.embeddings.length !== 1) {
    throw new Error(`summary embed returned ${embedded.embeddings.length} vectors for 1 input`);
  }

  usage.embedTokens += embedded.tokensUsed;

  return {
    row: rowForSummaryInsert(target, content, embedded.embeddings[0]),
    usage,
  };
}

export function makeModelSummaryGenerator(opts: {
  contextModel: LanguageModel;
  summaryModel: LanguageModel;
}): SummaryGenerateFn {
  const { contextModel, summaryModel } = opts;

  return async ({ target, prompt, bucket }) => {
    const result = await generateText({
      model: target.level === "chapter" ? contextModel : summaryModel,
      system: prompt.system,
      prompt: `${prompt.user}\n\nWrite at most ${prompt.maxWords} words.`,
    });

    const u = result.usage;
    const detailed = u.inputTokenDetails;
    const cacheRead = detailed?.cacheReadTokens ?? 0;
    const cacheWrite = detailed?.cacheWriteTokens ?? 0;
    const noCache =
      detailed?.noCacheTokens ??
      (typeof u.inputTokens === "number"
        ? Math.max(u.inputTokens - cacheRead - cacheWrite, 0)
        : 0);

    bucket.noCacheInputTokens += noCache;
    bucket.cacheReadTokens += cacheRead;
    bucket.cacheWriteTokens += cacheWrite;
    bucket.outputTokens += u.outputTokens ?? 0;
    bucket.calls += 1;

    return result.text.trim();
  };
}

export function makeEmbedder(model: EmbeddingModel): SummaryEmbedFn {
  return (values) => embedValues({ model, values });
}

export function buildChapterTargets(rows: ChapterSourceRow[]): ChapterSummaryTarget[] {
  const chapters = new Map<number, ChapterSourceRow[]>();
  const sortedRows = [...rows].sort(
    (left, right) =>
      left.chapterNum - right.chapterNum || left.chunkIndex - right.chunkIndex,
  );

  for (const row of sortedRows) {
    const chapterRows = chapters.get(row.chapterId) ?? [];
    chapterRows.push(row);
    chapters.set(row.chapterId, chapterRows);
  }

  return [...chapters.values()].map((chapterRows) => {
    const first = chapterRows[0];

    return {
      level: "chapter",
      bookId: first.bookId,
      rangeStart: first.chapterNum,
      rangeEnd: first.chapterNum,
      label: `Chapter ${first.chapterNum}: ${first.chapterTitle}`,
      chapterId: first.chapterId,
      chapterNum: first.chapterNum,
      chapterTitle: first.chapterTitle,
      volume: first.volume,
      volumeName: first.volumeName,
      arc: first.arc,
      arcName: first.arcName,
      contentKind: first.contentKind,
      contextualPrefixes: chapterRows.map((row) => row.contextualPrefix),
    };
  });
}

export function buildArcTargets(summaries: SummaryRow[]): RollupSummaryTarget[] {
  return buildGroupedRollups(summaries, {
    level: "arc",
    include: (summary) => summary.level === "chapter",
    key: (summary) => {
      const volume = requireNumericMeta(summary, "volume");
      const volumeName = requireStringMeta(summary, "volumeName");
      const arc = requireNumericMeta(summary, "arc");
      const arcName = requireStringMeta(summary, "arcName");
      const contentKind = requireContentKindMeta(summary);

      return [summary.bookId, volume, volumeName, arc, arcName, contentKind].join("|");
    },
    target: (inputs) => {
      const first = inputs[0];
      const volume = requireNumericMeta(first, "volume");
      const volumeName = requireStringMeta(first, "volumeName");
      const arc = requireNumericMeta(first, "arc");
      const arcName = requireStringMeta(first, "arcName");
      const contentKind = requireContentKindMeta(first);

      return {
        level: "arc",
        bookId: first.bookId,
        rangeStart: Math.min(...inputs.map((input) => input.rangeStart)),
        rangeEnd: Math.max(...inputs.map((input) => input.rangeEnd)),
        label: `${volumeName} - ${arcName}`,
        volume,
        volumeName,
        arc,
        arcName,
        contentKind,
        inputs,
      };
    },
  });
}

export function buildVolumeTargets(summaries: SummaryRow[]): RollupSummaryTarget[] {
  return buildGroupedRollups(summaries, {
    level: "volume",
    include: (summary) =>
      summary.level === "arc" &&
      requireContentKindMeta(summary) === "main" &&
      requireNumericMeta(summary, "volume") > 0,
    key: (summary) => {
      const volume = requireNumericMeta(summary, "volume");
      const volumeName = requireStringMeta(summary, "volumeName");

      return [summary.bookId, volume, volumeName].join("|");
    },
    target: (inputs) => {
      const first = inputs[0];
      const volume = requireNumericMeta(first, "volume");
      const volumeName = requireStringMeta(first, "volumeName");

      return {
        level: "volume",
        bookId: first.bookId,
        rangeStart: Math.min(...inputs.map((input) => input.rangeStart)),
        rangeEnd: Math.max(...inputs.map((input) => input.rangeEnd)),
        label: `Volume ${volume}: ${volumeName}`,
        volume,
        volumeName,
        contentKind: "main",
        inputs,
      };
    },
  });
}

export function buildSeriesTargets(
  summaries: SummaryRow[],
  seriesLabels: Record<string, string>,
): RollupSummaryTarget[] {
  return buildGroupedRollups(summaries, {
    level: "series",
    include: (summary) =>
      summary.level === "volume" && requireContentKindMeta(summary) === "main",
    key: (summary) => summary.bookId,
    target: (inputs) => {
      const first = inputs[0];

      return {
        level: "series",
        bookId: first.bookId,
        rangeStart: Math.min(...inputs.map((input) => input.rangeStart)),
        rangeEnd: Math.max(...inputs.map((input) => input.rangeEnd)),
        label: seriesLabels[first.bookId] ?? first.bookId,
        contentKind: "main",
        inputs,
      };
    },
  });
}

function validateSummaryDbRow(row: SummaryDbRow): void {
  if (row.level === "chapter" || row.level === "arc") {
    const counts = [
      row.volume_count,
      row.volume_name_count,
      row.arc_count,
      row.arc_name_count,
      row.content_kind_count,
    ];

    if (!counts.every(isOneCount)) {
      throw new Error(
        `Summary ${row.label} has mixed metadata for ${row.level} range ${row.range_start}-${row.range_end}`,
      );
    }
    return;
  }

  if (row.level === "volume") {
    if (!isOneCount(row.main_volume_count) || !isOneCount(row.main_volume_name_count)) {
      throw new Error(
        `Summary ${row.label} has invalid main-story volume metadata for range ${row.range_start}-${row.range_end}`,
      );
    }
  }
}

function isOneCount(value: number | string | null | undefined): boolean {
  if (typeof value === "number") {
    return value === 1;
  }

  return value === "1";
}

function addTokenBucket(total: TokenBucket, addition: TokenBucket): void {
  total.noCacheInputTokens += addition.noCacheInputTokens;
  total.cacheReadTokens += addition.cacheReadTokens;
  total.cacheWriteTokens += addition.cacheWriteTokens;
  total.outputTokens += addition.outputTokens;
  total.calls += addition.calls;
}

function estimateBucketCost(
  bucket: TokenBucket,
  ratesPerMillionTokens: Pick<
    TokenBucket,
    "noCacheInputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "outputTokens"
  >,
): number {
  return (
    (bucket.noCacheInputTokens * ratesPerMillionTokens.noCacheInputTokens +
      bucket.cacheReadTokens * ratesPerMillionTokens.cacheReadTokens +
      bucket.cacheWriteTokens * ratesPerMillionTokens.cacheWriteTokens +
      bucket.outputTokens * ratesPerMillionTokens.outputTokens) /
    1_000_000
  );
}

function maxWordsForLevel(level: SummaryLevel): number {
  if (level === "chapter") {
    return 200;
  }

  if (level === "series") {
    return 600;
  }

  return 400;
}

type RollupBuilder = {
  level: RollupSummaryTarget["level"];
  include: (summary: SummaryRow) => boolean;
  key: (summary: SummaryRow) => string;
  target: (inputs: SummaryRow[]) => RollupSummaryTarget;
};

function buildGroupedRollups(
  summaries: SummaryRow[],
  builder: RollupBuilder,
): RollupSummaryTarget[] {
  const groups = new Map<string, SummaryRow[]>();
  const sortedSummaries = [...summaries].sort(
    (left, right) =>
      left.bookId.localeCompare(right.bookId) ||
      left.rangeStart - right.rangeStart ||
      left.rangeEnd - right.rangeEnd ||
      left.label.localeCompare(right.label),
  );

  for (const summary of sortedSummaries) {
    if (!builder.include(summary)) {
      continue;
    }

    const key = builder.key(summary);
    const inputs = groups.get(key) ?? [];
    inputs.push(summary);
    groups.set(key, inputs);
  }

  return [...groups.values()].map((inputs) => builder.target(inputs));
}

function requireNumericMeta(summary: SummaryRow, field: "volume" | "arc"): number {
  const value = summary.meta[field];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Summary ${summary.label} is missing numeric meta.${field}`);
  }

  return value;
}

function requireStringMeta(summary: SummaryRow, field: "volumeName" | "arcName"): string {
  const value = summary.meta[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Summary ${summary.label} is missing string meta.${field}`);
  }

  return value;
}

function requireContentKindMeta(summary: SummaryRow): ContentKind {
  const value = summary.meta.contentKind;

  if (value !== "main" && value !== "side_story" && value !== "bonus") {
    throw new Error(`Summary ${summary.label} is missing valid meta.contentKind`);
  }

  return value;
}
