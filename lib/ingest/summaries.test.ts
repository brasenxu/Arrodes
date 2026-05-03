import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

import {
  addSummaryUsage,
  buildArcTargets,
  buildChapterTargets,
  buildSummaryPrompt,
  buildSeriesTargets,
  buildVolumeTargets,
  countTargetsByLevel,
  dedupeSummaryRows,
  estimateSummaryCost,
  filterMissingTargets,
  limitChapterTargetsForArcPreflight,
  assertCompleteChunkCoverage,
  makeModelSummaryGenerator,
  makeSummaryKey,
  mapSummaryDbRow,
  planNextSummaryTargets,
  resolveDeepSeekSummaryModelId,
  rowForSummaryInsert,
  selectRepresentativeArcChapterGroups,
  summaryRowFromChapterTarget,
  summarizeChunkCoverage,
  summarizeOneTarget,
  takePendingTargets,
  type ChapterSourceRow,
  type SummaryEmbedFn,
  type SummaryGenerateFn,
  type SummaryRow,
  zeroSummaryUsage,
} from "./summaries";

beforeEach(() => {
  generateTextMock.mockReset();
});

const chapterRows: ChapterSourceRow[] = [
  {
    chapterId: 1,
    bookId: "lotm1",
    chapterNum: 254,
    chapterTitle: "East Borough",
    volume: 2,
    volumeName: "Faceless",
    arc: 2,
    arcName: "Death of Lanevus",
    contentKind: "main",
    chunkIndex: 0,
    contextualPrefix: "Klein investigates East Borough after receiving leads.",
  },
  {
    chapterId: 1,
    bookId: "lotm1",
    chapterNum: 254,
    chapterTitle: "East Borough",
    volume: 2,
    volumeName: "Faceless",
    arc: 2,
    arcName: "Death of Lanevus",
    contentKind: "main",
    chunkIndex: 1,
    contextualPrefix: "The investigation points toward Lanevus.",
  },
  {
    chapterId: 2,
    bookId: "lotm1",
    chapterNum: 295,
    chapterTitle: "Magician",
    volume: 2,
    volumeName: "Faceless",
    arc: 3,
    arcName: "Black Emperor Heist",
    contentKind: "main",
    chunkIndex: 0,
    contextualPrefix: "Klein prepares for advancement after the Lanevus affair.",
  },
  {
    chapterId: 3,
    bookId: "lotm1",
    chapterNum: 1395,
    chapterTitle: "Side Story",
    volume: 0,
    volumeName: "An Ordinary Person's Daily Life",
    arc: 1,
    arcName: "An Ordinary Person's Daily Life",
    contentKind: "side_story",
    chunkIndex: 0,
    contextualPrefix: "A side-story scene follows ordinary life.",
  },
];

describe("buildChapterTargets", () => {
  it("groups chunk prefixes by chapter in chunk order", () => {
    const targets = buildChapterTargets([...chapterRows].reverse());

    expect(targets).toHaveLength(3);
    expect(targets.map((t) => t.chapterNum)).toEqual([254, 295, 1395]);
    expect(targets[0]).toMatchObject({
      level: "chapter",
      bookId: "lotm1",
      rangeStart: 254,
      rangeEnd: 254,
      label: "Chapter 254: East Borough",
      chapterNum: 254,
      volumeName: "Faceless",
      arcName: "Death of Lanevus",
      contentKind: "main",
    });
    expect(targets[0].contextualPrefixes).toEqual([
      "Klein investigates East Borough after receiving leads.",
      "The investigation points toward Lanevus.",
    ]);
  });
});

describe("summary chunk coverage", () => {
  it("summarizes total, chunked, and missing chapters", () => {
    const coverage = summarizeChunkCoverage([
      { chapterNum: 1, chunkCount: 2 },
      { chapterNum: 2, chunkCount: 0 },
      { chapterNum: 3, chunkCount: 1 },
    ]);

    expect(coverage).toEqual({
      totalChapters: 3,
      chunkedChapters: 2,
      missingChapterNums: [2],
    });
  });

  it("rejects incomplete chunk coverage with book-scoped counts", () => {
    const coverage = {
      totalChapters: 3,
      chunkedChapters: 2,
      missingChapterNums: [2],
    };

    expect(() => assertCompleteChunkCoverage("lotm1", coverage)).toThrow(
      "[summaries] chunk coverage incomplete for lotm1: 2/3 chapters have chunks. Run --phase chunks first.",
    );
  });
});

describe("resolveDeepSeekSummaryModelId", () => {
  it("accepts bare and provider-prefixed DeepSeek model IDs", () => {
    expect(resolveDeepSeekSummaryModelId("deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(resolveDeepSeekSummaryModelId("deepseek-v4-flash")).toBe("deepseek-v4-flash");
    expect(resolveDeepSeekSummaryModelId("deepseek/deepseek-v4-pro")).toBe(
      "deepseek-v4-pro",
    );
    expect(resolveDeepSeekSummaryModelId("deepseek/deepseek-v4-flash")).toBe(
      "deepseek-v4-flash",
    );
  });

  it("rejects bare and provider-prefixed non-DeepSeek model IDs", () => {
    const message =
      "[summaries] summaries ingest currently supports DeepSeek summary models only. Set INGEST_SUMMARY_MODEL=deepseek-v4-pro or another DeepSeek model.";

    expect(() => resolveDeepSeekSummaryModelId("gemini-2.5-flash")).toThrow(message);
    expect(() => resolveDeepSeekSummaryModelId("claude-sonnet-4-6")).toThrow(message);
    expect(() => resolveDeepSeekSummaryModelId("google/gemini-2.5-flash")).toThrow(
      message,
    );
    expect(() => resolveDeepSeekSummaryModelId("openai/gpt-5")).toThrow(message);
    expect(() => resolveDeepSeekSummaryModelId("deepseek/gemini-2.5-flash")).toThrow(
      message,
    );
  });
});

describe("selectRepresentativeArcChapterGroups", () => {
  it("selects largest main-story arc groups before side-story groups", () => {
    const targets = buildChapterTargets([
      ...chapterRows,
      {
        chapterId: 4,
        bookId: "lotm1",
        chapterNum: 296,
        chapterTitle: "Heist Setup",
        volume: 2,
        volumeName: "Faceless",
        arc: 3,
        arcName: "Black Emperor Heist",
        contentKind: "main",
        chunkIndex: 0,
        contextualPrefix: "Klein considers the heist.",
      },
    ]);

    const groups = selectRepresentativeArcChapterGroups(targets, 2);

    expect(groups.map((group) => group.map((target) => target.chapterNum))).toEqual([
      [295, 296],
      [254],
    ]);
  });
});

describe("limitChapterTargetsForArcPreflight", () => {
  it("keeps earliest chapters by chapter number up to max", () => {
    const targets = buildChapterTargets([
      ...chapterRows,
      {
        chapterId: 4,
        bookId: "lotm1",
        chapterNum: 296,
        chapterTitle: "Heist Setup",
        volume: 2,
        volumeName: "Faceless",
        arc: 3,
        arcName: "Black Emperor Heist",
        contentKind: "main",
        chunkIndex: 0,
        contextualPrefix: "Klein considers the heist.",
      },
    ]);
    const groups = selectRepresentativeArcChapterGroups(targets, 1);
    const group = groups[0] ?? [];
    const limited = limitChapterTargetsForArcPreflight(group, 1);

    expect(limited.map((t) => t.chapterNum)).toEqual([295]);
  });
});

describe("rollup targets", () => {
  const chapterSummaries: SummaryRow[] = [
    { level: "chapter", bookId: "lotm1", rangeStart: 254, rangeEnd: 254, label: "Chapter 254: East Borough", content: "Klein follows clues in East Borough.", meta: { volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" } },
    { level: "chapter", bookId: "lotm1", rangeStart: 255, rangeEnd: 255, label: "Chapter 255: Clue", content: "The Lanevus lead grows clearer.", meta: { volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" } },
    { level: "chapter", bookId: "lotm1", rangeStart: 1395, rangeEnd: 1395, label: "Chapter 1395: Side Story", content: "A side story begins.", meta: { volume: 0, volumeName: "An Ordinary Person's Daily Life", arc: 1, arcName: "An Ordinary Person's Daily Life", contentKind: "side_story" } },
  ];

  it("builds arc targets including side-story arcs", () => {
    const summaries: SummaryRow[] = [
      ...chapterSummaries,
      { level: "arc", bookId: "lotm1", rangeStart: 254, rangeEnd: 294, label: "Faceless - Death of Lanevus", content: "An arc summary should not roll up directly to arc.", meta: { volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" } },
    ];
    const targets = buildArcTargets(summaries);

    expect(targets.map((t) => [t.label, t.rangeStart, t.rangeEnd, t.contentKind])).toEqual([
      ["Faceless - Death of Lanevus", 254, 255, "main"],
      ["An Ordinary Person's Daily Life - An Ordinary Person's Daily Life", 1395, 1395, "side_story"],
    ]);
    expect(targets[0].inputs.map((s) => s.rangeStart)).toEqual([254, 255]);
    expect(targets[0].inputs.map((s) => s.level)).toEqual(["chapter", "chapter"]);
  });

  it("builds volume targets from main-story arc summaries only", () => {
    const arcSummaries: SummaryRow[] = [
      { level: "arc", bookId: "lotm1", rangeStart: 254, rangeEnd: 294, label: "Faceless - Death of Lanevus", content: "Klein finds and kills Lanevus.", meta: { volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" } },
      { level: "chapter", bookId: "lotm1", rangeStart: 295, rangeEnd: 295, label: "Chapter 295: Magician", content: "A chapter summary should not roll up directly to volume.", meta: { volume: 2, volumeName: "Faceless", arc: 3, arcName: "Black Emperor Heist", contentKind: "main" } },
      { level: "arc", bookId: "lotm1", rangeStart: 1395, rangeEnd: 1402, label: "An Ordinary Person's Daily Life - An Ordinary Person's Daily Life", content: "Side-story events.", meta: { volume: 0, volumeName: "An Ordinary Person's Daily Life", arc: 1, arcName: "An Ordinary Person's Daily Life", contentKind: "side_story" } },
    ];

    const targets = buildVolumeTargets(arcSummaries);

    expect(targets).toHaveLength(1);
    expect(targets[0].inputs.map((s) => s.level)).toEqual(["arc"]);
    expect(targets[0]).toMatchObject({
      level: "volume",
      bookId: "lotm1",
      rangeStart: 254,
      rangeEnd: 294,
      label: "Volume 2: Faceless",
    });
  });

  it("builds one series target from main-story volume summaries", () => {
    const volumeSummaries: SummaryRow[] = [
      { level: "volume", bookId: "lotm1", rangeStart: 1, rangeEnd: 213, label: "Volume 1: Clown", content: "Klein starts his journey.", meta: { volume: 1, volumeName: "Clown", contentKind: "main" } },
      { level: "volume", bookId: "lotm1", rangeStart: 214, rangeEnd: 482, label: "Volume 2: Faceless", content: "Klein acts as Sherlock Moriarty.", meta: { volume: 2, volumeName: "Faceless", contentKind: "main" } },
      { level: "arc", bookId: "lotm1", rangeStart: 254, rangeEnd: 294, label: "Faceless - Death of Lanevus", content: "An arc summary should not roll up directly to series.", meta: { volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" } },
    ];

    const targets = buildSeriesTargets(volumeSummaries, { lotm1: "Lord of the Mysteries" });

    expect(targets).toEqual([
      expect.objectContaining({
        level: "series",
        bookId: "lotm1",
        rangeStart: 1,
        rangeEnd: 482,
        label: "Lord of the Mysteries",
      }),
    ]);
    expect(targets[0].inputs.map((s) => s.level)).toEqual(["volume", "volume"]);
  });
});

describe("planNextSummaryTargets", () => {
  it("returns chapter targets first when no chapter summaries exist", () => {
    const chapterTargets = buildChapterTargets(chapterRows);
    const planned = planNextSummaryTargets({
      chapterTargets,
      chapterSummaries: [],
      arcSummaries: [],
      volumeSummaries: [],
      bookTitles: { lotm1: "Lord of the Mysteries" },
      existingKeys: new Set(),
      limit: 2,
    });

    expect(planned.map((target) => target.level)).toEqual(["chapter", "chapter"]);
    expect(countTargetsByLevel(planned)).toEqual({
      chapter: 2,
      arc: 0,
      volume: 0,
      series: 0,
    });
  });

  it("unlocks arc targets when chapter summaries are present", () => {
    const planned = planNextSummaryTargets({
      chapterTargets: [],
      chapterSummaries: [
        {
          level: "chapter",
          bookId: "lotm1",
          rangeStart: 254,
          rangeEnd: 254,
          label: "Chapter 254: East Borough",
          content: "Klein follows clues.",
          meta: {
            volume: 2,
            volumeName: "Faceless",
            arc: 2,
            arcName: "Death of Lanevus",
            contentKind: "main",
          },
        },
      ],
      arcSummaries: [],
      volumeSummaries: [],
      bookTitles: { lotm1: "Lord of the Mysteries" },
      existingKeys: new Set(),
      limit: null,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ level: "arc", label: "Faceless - Death of Lanevus" });
  });

  it("unlocks volume targets when arc summaries are present", () => {
    const planned = planNextSummaryTargets({
      chapterTargets: [],
      chapterSummaries: [],
      arcSummaries: [
        {
          level: "arc",
          bookId: "lotm1",
          rangeStart: 254,
          rangeEnd: 294,
          label: "Faceless - Death of Lanevus",
          content: "Klein kills Lanevus.",
          meta: {
            volume: 2,
            volumeName: "Faceless",
            arc: 2,
            arcName: "Death of Lanevus",
            contentKind: "main",
          },
        },
      ],
      volumeSummaries: [],
      bookTitles: { lotm1: "Lord of the Mysteries" },
      existingKeys: new Set(),
      limit: null,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ level: "volume", label: "Volume 2: Faceless" });
  });

  it("unlocks series targets when volume summaries are present", () => {
    const planned = planNextSummaryTargets({
      chapterTargets: [],
      chapterSummaries: [],
      arcSummaries: [],
      volumeSummaries: [
        {
          level: "volume",
          bookId: "lotm1",
          rangeStart: 1,
          rangeEnd: 213,
          label: "Volume 1: Clown",
          content: "Klein starts his journey.",
          meta: { volume: 1, volumeName: "Clown", contentKind: "main" },
        },
      ],
      bookTitles: { lotm1: "Lord of the Mysteries" },
      existingKeys: new Set(),
      limit: null,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ level: "series", label: "Lord of the Mysteries" });
  });

  it("skips existing rollup targets", () => {
    const chapterSummaries: SummaryRow[] = [
      {
        level: "chapter",
        bookId: "lotm1",
        rangeStart: 254,
        rangeEnd: 254,
        label: "Chapter 254: East Borough",
        content: "Klein follows clues.",
        meta: {
          volume: 2,
          volumeName: "Faceless",
          arc: 2,
          arcName: "Death of Lanevus",
          contentKind: "main",
        },
      },
    ];
    const [arcTarget] = buildArcTargets(chapterSummaries);

    const planned = planNextSummaryTargets({
      chapterTargets: [],
      chapterSummaries,
      arcSummaries: [],
      volumeSummaries: [],
      bookTitles: { lotm1: "Lord of the Mysteries" },
      existingKeys: new Set([makeSummaryKey(arcTarget)]),
      limit: null,
    });

    expect(planned).toEqual([]);
  });
});

describe("mapSummaryDbRow", () => {
  it("maps reconstructed SQL metadata into SummaryRow", () => {
    expect(
      mapSummaryDbRow({
        level: "arc",
        book_id: "lotm1",
        range_start: 254,
        range_end: 294,
        label: "Faceless - Death of Lanevus",
        content: "Klein kills Lanevus.",
        volume_count: 1,
        volume_name_count: 1,
        arc_count: 1,
        arc_name_count: 1,
        content_kind_count: 1,
        meta: {
          volume: 2,
          volumeName: "Faceless",
          arc: 2,
          arcName: "Death of Lanevus",
          contentKind: "main",
        },
      }),
    ).toEqual({
      level: "arc",
      bookId: "lotm1",
      rangeStart: 254,
      rangeEnd: 294,
      label: "Faceless - Death of Lanevus",
      content: "Klein kills Lanevus.",
      meta: {
        volume: 2,
        volumeName: "Faceless",
        arc: 2,
        arcName: "Death of Lanevus",
        contentKind: "main",
      },
    });
  });

  it("rejects chapter rows with mixed reconstructed metadata", () => {
    expect(() =>
      mapSummaryDbRow({
        level: "chapter",
        book_id: "lotm1",
        range_start: 254,
        range_end: 254,
        label: "Chapter 254: East Borough",
        content: "Klein follows clues.",
        volume_count: 1,
        volume_name_count: 1,
        arc_count: 2,
        arc_name_count: 2,
        content_kind_count: 1,
        meta: {
          volume: 2,
          volumeName: "Faceless",
          arc: 2,
          arcName: "Death of Lanevus",
          contentKind: "main",
        },
      }),
    ).toThrow("mixed metadata");
  });

  it("rejects volume rows without exactly one main-story volume", () => {
    expect(() =>
      mapSummaryDbRow({
        level: "volume",
        book_id: "lotm1",
        range_start: 1,
        range_end: 1395,
        label: "Volume 1: Clown",
        content: "Klein starts his journey.",
        main_volume_count: 2,
        main_volume_name_count: 2,
        meta: { volume: 1, volumeName: "Clown", contentKind: "main" },
      }),
    ).toThrow("invalid main-story volume metadata");
  });
});

describe("dedupeSummaryRows", () => {
  it("dedupes duplicate logical summary keys while keeping the first row", () => {
    const rows: SummaryRow[] = [
      {
        level: "arc",
        bookId: "lotm1",
        rangeStart: 254,
        rangeEnd: 294,
        label: "Faceless - Death of Lanevus",
        content: "First summary wins.",
        meta: {
          volume: 2,
          volumeName: "Faceless",
          arc: 2,
          arcName: "Death of Lanevus",
          contentKind: "main",
        },
      },
      {
        level: "arc",
        bookId: "lotm1",
        rangeStart: 254,
        rangeEnd: 294,
        label: "Faceless - Death of Lanevus",
        content: "Duplicate summary loses.",
        meta: {
          volume: 2,
          volumeName: "Faceless",
          arc: 2,
          arcName: "Death of Lanevus",
          contentKind: "main",
        },
      },
    ];

    expect(dedupeSummaryRows(rows)).toEqual([rows[0]]);
  });
});

describe("buildSummaryPrompt", () => {
  it("builds a chapter prompt from contextual prefixes, not raw chapter text", () => {
    const [target] = buildChapterTargets(chapterRows);
    const prompt = buildSummaryPrompt(target);

    expect(prompt.system).toContain("Summarize only the supplied range");
    expect(prompt.user).toContain("Chapter 254: East Borough");
    expect(prompt.user).toContain("Book: lotm1");
    expect(prompt.user).toContain("Volume: 2 - Faceless");
    expect(prompt.user).toContain("Arc: 2 - Death of Lanevus");
    expect(prompt.user).toContain("Content kind: main");
    expect(prompt.user).toContain("Klein investigates East Borough");
    expect(prompt.user.indexOf("Klein investigates East Borough")).toBeLessThan(
      prompt.user.indexOf("The investigation points toward Lanevus"),
    );
    expect(prompt.user).not.toContain("rawText");
    expect(prompt.maxWords).toBe(200);
  });

  it("builds an arc prompt from prior chapter summaries", () => {
    const target = buildArcTargets([
      { level: "chapter", bookId: "lotm1", rangeStart: 254, rangeEnd: 254, label: "Chapter 254: East Borough", content: "Klein follows clues.", meta: { volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" } },
    ])[0];

    const prompt = buildSummaryPrompt(target);

    expect(prompt.user).toContain("Faceless - Death of Lanevus");
    expect(prompt.user).toContain("Book: lotm1");
    expect(prompt.user).toContain("Level: arc");
    expect(prompt.user).toContain("Content kind: main");
    expect(prompt.user).toContain("Chapter 254: East Borough");
    expect(prompt.user).toContain("Klein follows clues.");
    expect(prompt.maxWords).toBe(400);
  });
});

describe("summary usage", () => {
  it("adds token usage and estimates cost", () => {
    const usage = zeroSummaryUsage();
    addSummaryUsage(usage, {
      context: { noCacheInputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 0, outputTokens: 200, calls: 2 },
      summary: { noCacheInputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 300, calls: 1 },
      embedTokens: 150,
    });

    expect(usage.context.calls).toBe(2);
    expect(usage.summary.outputTokens).toBe(300);
    expect(usage.embedTokens).toBe(150);
    expect(estimateSummaryCost(usage)).toBeGreaterThan(0);
  });
});

describe("rowForSummaryInsert", () => {
  it("shapes only columns that exist on the summaries table", () => {
    const [target] = buildChapterTargets(chapterRows);
    const row = rowForSummaryInsert(target, "Summary text", [0.1, 0.2, 0.3]);

    expect(row).toMatchObject({
      level: "chapter",
      bookId: "lotm1",
      rangeStart: 254,
      rangeEnd: 254,
      label: "Chapter 254: East Borough",
      content: "Summary text",
      embedding: [0.1, 0.2, 0.3],
    });
    expect("meta" in row).toBe(false);
  });
});

describe("summaryRowFromChapterTarget", () => {
  it("keeps chapter metadata needed for in-memory arc rollups", () => {
    const [target] = buildChapterTargets(chapterRows);

    expect(summaryRowFromChapterTarget(target, "Klein follows clues.")).toEqual({
      level: "chapter",
      bookId: "lotm1",
      rangeStart: 254,
      rangeEnd: 254,
      label: "Chapter 254: East Borough",
      content: "Klein follows clues.",
      meta: {
        volume: 2,
        volumeName: "Faceless",
        arc: 2,
        arcName: "Death of Lanevus",
        contentKind: "main",
      },
    });
  });
});

describe("summarizeOneTarget", () => {
  it("generates content, embeds it, and returns usage without writing", async () => {
    const [target] = buildChapterTargets(chapterRows);
    const generate: SummaryGenerateFn = async ({ prompt, bucket }) => {
      expect(prompt.user).toContain("Chapter 254: East Borough");
      bucket.noCacheInputTokens += 100;
      bucket.outputTokens += 50;
      bucket.calls += 1;
      return "Klein follows the Lanevus trail in East Borough.";
    };
    const embed: SummaryEmbedFn = async (values) => {
      expect(values).toEqual(["Klein follows the Lanevus trail in East Borough."]);
      return { embeddings: [[0.1, 0.2, 0.3]], tokensUsed: 12 };
    };

    const result = await summarizeOneTarget({ target, generate, embed });

    expect(result.row.content).toBe("Klein follows the Lanevus trail in East Borough.");
    expect(result.row.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.usage.context.calls).toBe(1);
    expect(result.usage.summary.calls).toBe(0);
    expect(result.usage.embedTokens).toBe(12);
  });

  it("uses the summary usage bucket for rollup targets", async () => {
    const target = buildArcTargets([
      {
        level: "chapter",
        bookId: "lotm1",
        rangeStart: 254,
        rangeEnd: 254,
        label: "Chapter 254: East Borough",
        content: "Klein follows clues.",
        meta: {
          volume: 2,
          volumeName: "Faceless",
          arc: 2,
          arcName: "Death of Lanevus",
          contentKind: "main",
        },
      },
    ])[0];
    const generate: SummaryGenerateFn = async ({ bucket }) => {
      bucket.calls += 1;
      bucket.outputTokens += 10;
      return "Klein closes in on Lanevus.";
    };
    const embed: SummaryEmbedFn = async () => ({ embeddings: [[0.4]], tokensUsed: 4 });

    const result = await summarizeOneTarget({ target, generate, embed });

    expect(result.usage.context.calls).toBe(0);
    expect(result.usage.summary.calls).toBe(1);
  });

  it("throws when embedder returns the wrong number of vectors", async () => {
    const [target] = buildChapterTargets(chapterRows);
    const generate: SummaryGenerateFn = async () => "Summary";
    const embed: SummaryEmbedFn = async () => ({ embeddings: [], tokensUsed: 0 });

    await expect(summarizeOneTarget({ target, generate, embed })).rejects.toThrow(
      "summary embed returned 0 vectors for 1 input",
    );
  });
});

describe("makeModelSummaryGenerator", () => {
  const contextModel = { modelId: "context-model" } as LanguageModel;
  const summaryModel = { modelId: "summary-model" } as LanguageModel;

  it("uses the context model for chapter targets and records detailed usage", async () => {
    generateTextMock.mockResolvedValueOnce({
      text: "  Klein follows Lanevus. \n",
      usage: {
        inputTokens: 150,
        inputTokenDetails: {
          cacheReadTokens: 20,
          cacheWriteTokens: 30,
          noCacheTokens: 100,
        },
        outputTokens: 40,
      },
    });
    const [target] = buildChapterTargets(chapterRows);
    const prompt = buildSummaryPrompt(target);
    const bucket = {
      noCacheInputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      calls: 0,
    };
    const generate = makeModelSummaryGenerator({ contextModel, summaryModel });

    const text = await generate({ target, prompt, bucket });

    expect(text).toBe("Klein follows Lanevus.");
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: contextModel,
        system: prompt.system,
        prompt: expect.stringContaining("Write at most 200 words."),
      }),
    );
    expect(bucket).toEqual({
      noCacheInputTokens: 100,
      cacheReadTokens: 20,
      cacheWriteTokens: 30,
      outputTokens: 40,
      calls: 1,
    });
  });

  it("uses the summary model for rollup targets and falls back to input token math", async () => {
    generateTextMock.mockResolvedValueOnce({
      text: "\nKlein closes in on Lanevus.\n",
      usage: {
        inputTokens: 220,
        inputTokenDetails: {
          cacheReadTokens: 25,
          cacheWriteTokens: 15,
        },
        outputTokens: 35,
      },
    });
    const target = buildArcTargets([
      {
        level: "chapter",
        bookId: "lotm1",
        rangeStart: 254,
        rangeEnd: 254,
        label: "Chapter 254: East Borough",
        content: "Klein follows clues.",
        meta: {
          volume: 2,
          volumeName: "Faceless",
          arc: 2,
          arcName: "Death of Lanevus",
          contentKind: "main",
        },
      },
    ])[0];
    const prompt = buildSummaryPrompt(target);
    const bucket = {
      noCacheInputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      calls: 0,
    };
    const generate = makeModelSummaryGenerator({ contextModel, summaryModel });

    const text = await generate({ target, prompt, bucket });

    expect(text).toBe("Klein closes in on Lanevus.");
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: summaryModel,
        system: prompt.system,
        prompt: expect.stringContaining("Write at most 400 words."),
      }),
    );
    expect(bucket).toEqual({
      noCacheInputTokens: 180,
      cacheReadTokens: 25,
      cacheWriteTokens: 15,
      outputTokens: 35,
      calls: 1,
    });
  });
});

describe("target filtering", () => {
  it("skips targets with an existing key", () => {
    const targets = buildChapterTargets(chapterRows);
    const existing = new Set([makeSummaryKey(targets[0])]);

    expect(filterMissingTargets(targets, existing).map((t) => t.label)).toEqual([
      "Chapter 295: Magician",
      "Chapter 1395: Side Story",
    ]);
  });

  it("applies --limit in deterministic order", () => {
    const targets = buildChapterTargets(chapterRows);

    expect(takePendingTargets(targets, 2).map((t) => t.rangeStart)).toEqual([254, 295]);
    expect(takePendingTargets(targets, null)).toHaveLength(3);
  });
});
