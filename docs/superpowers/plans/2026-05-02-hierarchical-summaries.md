# Hierarchical Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ticket 008 as a resumable `pnpm ingest --book <book> --phase summaries` pipeline that writes embedded chapter, arc, volume, and series summaries.

**Architecture:** Add `lib/ingest/summaries.ts` for pure target building, summary generation, cost accounting, and DB write helpers. Extend `scripts/ingest.ts` only as the CLI orchestrator, following the existing `chunks`, `ner`, and `events` phase shape. Generate chapter summaries first, then arc, volume, and series summaries from prior-level summary rows.

**Tech Stack:** TypeScript, Vitest, Next.js path aliases, Drizzle ORM, Neon Postgres, AI SDK v6 `generateText`, existing `embedValues()`, DeepSeek-compatible `@ai-sdk/openai` provider wiring.

**Ingest script running:** When asked to run any of the ingest scripts (ie. `pnpm ingest`), prompt the user to run the command. The user will run the command in their Terminal, then provide the results. This is because the ingest scripts take a long time to run, which risks timeout of the Cursor agents window. 

---

## File Structure

- Create `lib/ingest/summaries.ts`: target types, grouping helpers, prompt builders, generation helpers, usage/cost accounting, DB target loaders, skip-existing checks, and insert helper.
- Create `lib/ingest/summaries.test.ts`: pure unit tests for grouping, labels/ranges, skip-existing filtering, limit selection, cost aggregation, prompt invariants, and row shaping.
- Modify `scripts/ingest.ts`: add `summaries` phase, model/env validation, provider construction, reset/preflight/dry-run/real-run orchestration.
- Modify `docs/tasks/008-hierarchical-summaries.md`: set `status: in-progress` when implementation starts and later document resolution.
- Modify `docs/tasks/README.md`: update ticket 008 status when implementation starts and later when closed.

No schema migration is needed; `summaries` already exists.

---

### Task 1: Add Summary Target Types And Grouping Helpers

**Files:**
- Create: `lib/ingest/summaries.test.ts`
- Create: `lib/ingest/summaries.ts`

- [ ] **Step 1: Write failing tests for target grouping and deterministic labels**

Add `lib/ingest/summaries.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  buildArcTargets,
  buildChapterTargets,
  buildSeriesTargets,
  buildVolumeTargets,
  filterMissingTargets,
  makeSummaryKey,
  takePendingTargets,
  type ChapterSourceRow,
  type SummaryRow,
} from "./summaries";

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
    const targets = buildChapterTargets(chapterRows);

    expect(targets).toHaveLength(3);
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

describe("rollup targets", () => {
  const chapterSummaries: SummaryRow[] = [
    { level: "chapter", bookId: "lotm1", rangeStart: 254, rangeEnd: 254, label: "Chapter 254: East Borough", content: "Klein follows clues in East Borough.", meta: { volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" } },
    { level: "chapter", bookId: "lotm1", rangeStart: 255, rangeEnd: 255, label: "Chapter 255: Clue", content: "The Lanevus lead grows clearer.", meta: { volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" } },
    { level: "chapter", bookId: "lotm1", rangeStart: 1395, rangeEnd: 1395, label: "Chapter 1395: Side Story", content: "A side story begins.", meta: { volume: 0, volumeName: "An Ordinary Person's Daily Life", arc: 1, arcName: "An Ordinary Person's Daily Life", contentKind: "side_story" } },
  ];

  it("builds arc targets including side-story arcs", () => {
    const targets = buildArcTargets(chapterSummaries);

    expect(targets.map((t) => [t.label, t.rangeStart, t.rangeEnd, t.contentKind])).toEqual([
      ["Faceless - Death of Lanevus", 254, 255, "main"],
      ["An Ordinary Person's Daily Life - An Ordinary Person's Daily Life", 1395, 1395, "side_story"],
    ]);
    expect(targets[0].inputs.map((s) => s.rangeStart)).toEqual([254, 255]);
  });

  it("builds volume targets from main-story arc summaries only", () => {
    const arcSummaries: SummaryRow[] = [
      { level: "arc", bookId: "lotm1", rangeStart: 254, rangeEnd: 294, label: "Faceless - Death of Lanevus", content: "Klein finds and kills Lanevus.", meta: { volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" } },
      { level: "arc", bookId: "lotm1", rangeStart: 1395, rangeEnd: 1402, label: "An Ordinary Person's Daily Life - An Ordinary Person's Daily Life", content: "Side-story events.", meta: { volume: 0, volumeName: "An Ordinary Person's Daily Life", arc: 1, arcName: "An Ordinary Person's Daily Life", contentKind: "side_story" } },
    ];

    const targets = buildVolumeTargets(arcSummaries);

    expect(targets).toHaveLength(1);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/ingest/summaries.test.ts`

Expected: FAIL because `lib/ingest/summaries.ts` does not exist and the exported helpers are missing.

- [ ] **Step 3: Implement target types and grouping helpers**

Create `lib/ingest/summaries.ts` with:

```typescript
import { generateText, type EmbeddingModel, type LanguageModel } from "ai";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { ContentKind } from "@/lib/db/schema";
import { embedValues } from "./embed";

export type SummaryLevel = "chapter" | "arc" | "volume" | "series";

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
  contentKind?: ContentKind | "main";
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
  contentKind: ContentKind | "main";
  inputs: SummaryRow[];
};

export type SummaryTarget = ChapterSummaryTarget | RollupSummaryTarget;

export function makeSummaryKey(target: Pick<SummaryTargetBase, "level" | "bookId" | "rangeStart" | "rangeEnd" | "label">): string {
  return `${target.level}|${target.bookId}|${target.rangeStart}|${target.rangeEnd}|${target.label}`;
}

export function filterMissingTargets<T extends SummaryTargetBase>(
  targets: T[],
  existingKeys: Set<string>,
): T[] {
  return targets.filter((target) => !existingKeys.has(makeSummaryKey(target)));
}

export function takePendingTargets<T>(targets: T[], limit: number | null): T[] {
  return limit == null ? targets : targets.slice(0, limit);
}

export function buildChapterTargets(rows: ChapterSourceRow[]): ChapterSummaryTarget[] {
  const byChapter = new Map<number, ChapterSourceRow[]>();
  for (const row of [...rows].sort((a, b) => a.chapterNum - b.chapterNum || a.chunkIndex - b.chunkIndex)) {
    const group = byChapter.get(row.chapterId) ?? [];
    group.push(row);
    byChapter.set(row.chapterId, group);
  }

  return [...byChapter.values()].map((group) => {
    const first = group[0];
    return {
      level: "chapter",
      chapterId: first.chapterId,
      bookId: first.bookId,
      chapterNum: first.chapterNum,
      chapterTitle: first.chapterTitle,
      volume: first.volume,
      volumeName: first.volumeName,
      arc: first.arc,
      arcName: first.arcName,
      contentKind: first.contentKind,
      rangeStart: first.chapterNum,
      rangeEnd: first.chapterNum,
      label: `Chapter ${first.chapterNum}: ${first.chapterTitle}`,
      contextualPrefixes: group.map((row) => row.contextualPrefix),
    };
  });
}

export function buildArcTargets(rows: SummaryRow[]): RollupSummaryTarget[] {
  const byArc = new Map<string, SummaryRow[]>();
  for (const row of [...rows].sort((a, b) => a.rangeStart - b.rangeStart)) {
    const key = `${row.bookId}|${row.meta.volume}|${row.meta.arc}|${row.meta.arcName}|${row.meta.contentKind}`;
    const group = byArc.get(key) ?? [];
    group.push(row);
    byArc.set(key, group);
  }

  return [...byArc.values()].map((group) => {
    const first = group[0];
    const volume = requireNumber(first.meta.volume, "volume");
    const arc = requireNumber(first.meta.arc, "arc");
    const volumeName = requireString(first.meta.volumeName, "volumeName");
    const arcName = requireString(first.meta.arcName, "arcName");
    const contentKind = requireContentKind(first.meta.contentKind);
    return {
      level: "arc",
      bookId: first.bookId,
      rangeStart: Math.min(...group.map((row) => row.rangeStart)),
      rangeEnd: Math.max(...group.map((row) => row.rangeEnd)),
      label: `${volumeName} - ${arcName}`,
      volume,
      volumeName,
      arc,
      arcName,
      contentKind,
      inputs: group,
    };
  });
}

export function buildVolumeTargets(rows: SummaryRow[]): RollupSummaryTarget[] {
  const mainRows = rows.filter((row) => row.meta.contentKind === "main" && (row.meta.volume ?? 0) > 0);
  const byVolume = new Map<string, SummaryRow[]>();
  for (const row of [...mainRows].sort((a, b) => a.rangeStart - b.rangeStart)) {
    const key = `${row.bookId}|${row.meta.volume}|${row.meta.volumeName}`;
    const group = byVolume.get(key) ?? [];
    group.push(row);
    byVolume.set(key, group);
  }

  return [...byVolume.values()].map((group) => {
    const first = group[0];
    const volume = requireNumber(first.meta.volume, "volume");
    const volumeName = requireString(first.meta.volumeName, "volumeName");
    return {
      level: "volume",
      bookId: first.bookId,
      rangeStart: Math.min(...group.map((row) => row.rangeStart)),
      rangeEnd: Math.max(...group.map((row) => row.rangeEnd)),
      label: `Volume ${volume}: ${volumeName}`,
      volume,
      volumeName,
      contentKind: "main",
      inputs: group,
    };
  });
}

export function buildSeriesTargets(
  rows: SummaryRow[],
  bookTitles: Record<string, string>,
): RollupSummaryTarget[] {
  const mainRows = rows.filter((row) => row.meta.contentKind === "main");
  const byBook = new Map<string, SummaryRow[]>();
  for (const row of [...mainRows].sort((a, b) => a.rangeStart - b.rangeStart)) {
    const group = byBook.get(row.bookId) ?? [];
    group.push(row);
    byBook.set(row.bookId, group);
  }

  return [...byBook.entries()].map(([bookId, group]) => ({
    level: "series",
    bookId,
    rangeStart: Math.min(...group.map((row) => row.rangeStart)),
    rangeEnd: Math.max(...group.map((row) => row.rangeEnd)),
    label: bookTitles[bookId] ?? bookId,
    contentKind: "main",
    inputs: group,
  }));
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number") throw new Error(`summary meta missing numeric ${field}`);
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`summary meta missing string ${field}`);
  }
  return value;
}

function requireContentKind(value: unknown): ContentKind {
  if (value === "main" || value === "side_story" || value === "bonus") return value;
  throw new Error("summary meta missing contentKind");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test lib/ingest/summaries.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit checkpoint if requested by user**

Do not run git write commands unless the user explicitly confirms. If confirmed later, stage only `lib/ingest/summaries.ts` and `lib/ingest/summaries.test.ts` for this checkpoint.

---

### Task 2: Add Prompt Builders, Usage Accounting, And Row Shaping

**Files:**
- Modify: `lib/ingest/summaries.test.ts`
- Modify: `lib/ingest/summaries.ts`

- [ ] **Step 1: Write failing tests for prompts, usage, and insert rows**

Append to `lib/ingest/summaries.test.ts`:

```typescript
import {
  addSummaryUsage,
  buildSummaryPrompt,
  estimateSummaryCost,
  rowForSummaryInsert,
  zeroSummaryUsage,
} from "./summaries";

describe("buildSummaryPrompt", () => {
  it("builds a chapter prompt from contextual prefixes, not raw chapter text", () => {
    const [target] = buildChapterTargets(chapterRows);
    const prompt = buildSummaryPrompt(target);

    expect(prompt.system).toContain("Summarize only the supplied range");
    expect(prompt.user).toContain("Chapter 254: East Borough");
    expect(prompt.user).toContain("Klein investigates East Borough");
    expect(prompt.user).not.toContain("rawText");
  });

  it("builds an arc prompt from prior chapter summaries", () => {
    const target = buildArcTargets([
      { level: "chapter", bookId: "lotm1", rangeStart: 254, rangeEnd: 254, label: "Chapter 254: East Borough", content: "Klein follows clues.", meta: { volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" } },
    ])[0];

    const prompt = buildSummaryPrompt(target);

    expect(prompt.user).toContain("Faceless - Death of Lanevus");
    expect(prompt.user).toContain("Chapter 254: East Borough");
    expect(prompt.user).toContain("Klein follows clues.");
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/ingest/summaries.test.ts`

Expected: FAIL because prompt, usage, and row helper exports do not exist.

- [ ] **Step 3: Implement prompt, usage, and row helpers**

Append to `lib/ingest/summaries.ts`:

```typescript
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

export const zeroTokenBucket = (): TokenBucket => ({
  noCacheInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  calls: 0,
});

export const zeroSummaryUsage = (): SummaryUsage => ({
  context: zeroTokenBucket(),
  summary: zeroTokenBucket(),
  embedTokens: 0,
});

export function addSummaryUsage(target: SummaryUsage, delta: SummaryUsage): void {
  addBucket(target.context, delta.context);
  addBucket(target.summary, delta.summary);
  target.embedTokens += delta.embedTokens;
}

function addBucket(target: TokenBucket, delta: TokenBucket): void {
  target.noCacheInputTokens += delta.noCacheInputTokens;
  target.cacheReadTokens += delta.cacheReadTokens;
  target.cacheWriteTokens += delta.cacheWriteTokens;
  target.outputTokens += delta.outputTokens;
  target.calls += delta.calls;
}

const PRICING = {
  contextInputNoCache: 0.14,
  contextInputCacheRead: 0.028,
  contextInputCacheWrite1h: 0.14,
  contextOutput: 0.28,
  summaryInputNoCache: 1.74,
  summaryInputCacheRead: 0.145,
  summaryInputCacheWrite1h: 1.74,
  summaryOutput: 3.48,
  embedSmall: 0.02,
} as const;

export function estimateSummaryCost(usage: SummaryUsage): number {
  return (
    bucketCost(usage.context, {
      inputNoCache: PRICING.contextInputNoCache,
      inputCacheRead: PRICING.contextInputCacheRead,
      inputCacheWrite: PRICING.contextInputCacheWrite1h,
      output: PRICING.contextOutput,
    }) +
    bucketCost(usage.summary, {
      inputNoCache: PRICING.summaryInputNoCache,
      inputCacheRead: PRICING.summaryInputCacheRead,
      inputCacheWrite: PRICING.summaryInputCacheWrite1h,
      output: PRICING.summaryOutput,
    }) +
    (usage.embedTokens / 1e6) * PRICING.embedSmall
  );
}

function bucketCost(
  bucket: TokenBucket,
  price: { inputNoCache: number; inputCacheRead: number; inputCacheWrite: number; output: number },
): number {
  return (
    (bucket.noCacheInputTokens / 1e6) * price.inputNoCache +
    (bucket.cacheReadTokens / 1e6) * price.inputCacheRead +
    (bucket.cacheWriteTokens / 1e6) * price.inputCacheWrite +
    (bucket.outputTokens / 1e6) * price.output
  );
}

export function buildSummaryPrompt(target: SummaryTarget): SummaryPrompt {
  const maxWords = target.level === "chapter" ? 200 : target.level === "series" ? 600 : 400;
  const system = [
    "Summarize only the supplied range from Lord of the Mysteries / Circle of Inevitability.",
    "Do not introduce future events, later identities, or canon knowledge that is not present in the supplied input.",
    "Use concise narrative prose. Preserve named events, character names, and concrete causes when they appear in the input.",
  ].join(" ");

  if (target.level === "chapter") {
    return {
      system,
      maxWords,
      user: [
        `Target: ${target.label}`,
        `Book: ${target.bookId}`,
        `Volume: ${target.volumeName}`,
        `Arc: ${target.arcName}`,
        `Content kind: ${target.contentKind}`,
        "",
        "Contextual chunk prefixes, in order:",
        ...target.contextualPrefixes.map((prefix, index) => `${index + 1}. ${prefix}`),
        "",
        `Write approximately ${maxWords} words.`,
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
      "Input summaries, in narrative order:",
      ...target.inputs.map((input) => `- ${input.label} (${input.rangeStart}-${input.rangeEnd}): ${input.content}`),
      "",
      `Write approximately ${maxWords} words.`,
    ].join("\n"),
  };
}

export function rowForSummaryInsert(
  target: SummaryTarget,
  content: string,
  embedding: number[],
): {
  level: SummaryLevel;
  bookId: string;
  rangeStart: number;
  rangeEnd: number;
  label: string;
  content: string;
  embedding: number[];
} {
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test lib/ingest/summaries.test.ts`

Expected: PASS.

---

### Task 3: Add Generation And Embedding Helpers

**Files:**
- Modify: `lib/ingest/summaries.test.ts`
- Modify: `lib/ingest/summaries.ts`

- [ ] **Step 1: Write failing tests for injected generation and embedding**

Append to `lib/ingest/summaries.test.ts`:

```typescript
import { summarizeOneTarget, type SummaryGenerateFn, type SummaryEmbedFn } from "./summaries";

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
    expect(result.usage.embedTokens).toBe(12);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/ingest/summaries.test.ts`

Expected: FAIL because `summarizeOneTarget`, `SummaryGenerateFn`, and `SummaryEmbedFn` are missing.

- [ ] **Step 3: Implement generation with injected functions for testability**

Append to `lib/ingest/summaries.ts`:

```typescript
export type SummaryGenerateFn = (opts: {
  target: SummaryTarget;
  prompt: SummaryPrompt;
  bucket: TokenBucket;
}) => Promise<string>;

export type SummaryEmbedFn = (values: string[]) => Promise<{
  embeddings: number[][];
  tokensUsed: number;
}>;

export async function summarizeOneTarget(opts: {
  target: SummaryTarget;
  generate: SummaryGenerateFn;
  embed: SummaryEmbedFn;
}): Promise<{
  row: ReturnType<typeof rowForSummaryInsert>;
  usage: SummaryUsage;
}> {
  const usage = zeroSummaryUsage();
  const prompt = buildSummaryPrompt(opts.target);
  const bucket = opts.target.level === "chapter" ? usage.context : usage.summary;
  const content = await opts.generate({ target: opts.target, prompt, bucket });
  const embedded = await opts.embed([content]);
  if (embedded.embeddings.length !== 1) {
    throw new Error(`summary embed returned ${embedded.embeddings.length} vectors for 1 input`);
  }
  usage.embedTokens += embedded.tokensUsed;
  return {
    row: rowForSummaryInsert(opts.target, content, embedded.embeddings[0]),
    usage,
  };
}

export function makeModelSummaryGenerator(opts: {
  contextModel: LanguageModel;
  summaryModel: LanguageModel;
}): SummaryGenerateFn {
  return async ({ target, prompt, bucket }) => {
    const model = target.level === "chapter" ? opts.contextModel : opts.summaryModel;
    const result = await generateText({
      model,
      system: prompt.system,
      prompt: prompt.user,
    });
    const usage = result.usage;
    const details = usage.inputTokenDetails;
    const cacheRead = details?.cacheReadTokens ?? 0;
    const cacheWrite = details?.cacheWriteTokens ?? 0;
    bucket.noCacheInputTokens += details?.noCacheTokens ?? Math.max((usage.inputTokens ?? 0) - cacheRead - cacheWrite, 0);
    bucket.cacheReadTokens += cacheRead;
    bucket.cacheWriteTokens += cacheWrite;
    bucket.outputTokens += usage.outputTokens ?? 0;
    bucket.calls += 1;
    return result.text.trim();
  };
}

export function makeEmbedder(model: EmbeddingModel): SummaryEmbedFn {
  return (values) => embedValues({ model, values });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test lib/ingest/summaries.test.ts`

Expected: PASS.

---

### Task 4: Add DB Loaders And Summary Persistence

**Files:**
- Modify: `lib/ingest/summaries.ts`

- [ ] **Step 1: Add a compile-time test target by extending existing tests with exported signatures**

Append to `lib/ingest/summaries.test.ts`:

```typescript
import {
  countTargetsByLevel,
  planNextSummaryTargets,
} from "./summaries";

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
    expect(countTargetsByLevel(planned)).toEqual({ chapter: 2, arc: 0, volume: 0, series: 0 });
  });

  it("unlocks arc targets when chapter summaries are present", () => {
    const planned = planNextSummaryTargets({
      chapterTargets: [],
      chapterSummaries: [
        { level: "chapter", bookId: "lotm1", rangeStart: 254, rangeEnd: 254, label: "Chapter 254: East Borough", content: "Klein follows clues.", meta: { volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" } },
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/ingest/summaries.test.ts`

Expected: FAIL because planning helpers are missing.

- [ ] **Step 3: Implement planning helpers and DB functions**

Append to `lib/ingest/summaries.ts`:

```typescript
export function countTargetsByLevel(targets: SummaryTarget[]): Record<SummaryLevel, number> {
  return targets.reduce<Record<SummaryLevel, number>>(
    (acc, target) => {
      acc[target.level]++;
      return acc;
    },
    { chapter: 0, arc: 0, volume: 0, series: 0 },
  );
}

export function planNextSummaryTargets(opts: {
  chapterTargets: ChapterSummaryTarget[];
  chapterSummaries: SummaryRow[];
  arcSummaries: SummaryRow[];
  volumeSummaries: SummaryRow[];
  bookTitles: Record<string, string>;
  existingKeys: Set<string>;
  limit: number | null;
}): SummaryTarget[] {
  const chapter = filterMissingTargets(opts.chapterTargets, opts.existingKeys);
  if (chapter.length > 0) return takePendingTargets(chapter, opts.limit);

  const arc = filterMissingTargets(buildArcTargets(opts.chapterSummaries), opts.existingKeys);
  if (arc.length > 0) return takePendingTargets(arc, opts.limit);

  const volume = filterMissingTargets(buildVolumeTargets(opts.arcSummaries), opts.existingKeys);
  if (volume.length > 0) return takePendingTargets(volume, opts.limit);

  const series = filterMissingTargets(buildSeriesTargets(opts.volumeSummaries, opts.bookTitles), opts.existingKeys);
  return takePendingTargets(series, opts.limit);
}

export async function loadChapterSourceRows(bookId: string): Promise<ChapterSourceRow[]> {
  const rows = await db
    .select({
      chapterId: schema.chapters.id,
      bookId: schema.chapters.bookId,
      chapterNum: schema.chapters.chapterNum,
      chapterTitle: schema.chapters.chapterTitle,
      volume: schema.chapters.volume,
      volumeName: schema.chapters.volumeName,
      arc: schema.chapters.arc,
      arcName: schema.chapters.arcName,
      contentKind: schema.chapters.contentKind,
      chunkIndex: schema.chunks.chunkIndex,
      contextualPrefix: schema.chunks.contextualPrefix,
    })
    .from(schema.chapters)
    .innerJoin(schema.chunks, eq(schema.chunks.chapterId, schema.chapters.id))
    .where(eq(schema.chapters.bookId, bookId))
    .orderBy(asc(schema.chapters.chapterNum), asc(schema.chunks.chunkIndex));

  return rows;
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
    .where(eq(schema.summaries.bookId, bookId));

  return new Set(rows.map((row) => makeSummaryKey(row as SummaryTargetBase)));
}

export async function loadSummaryRows(bookId: string, level: SummaryLevel): Promise<SummaryRow[]> {
  const rows = (await db.execute(sql`
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
          'volume', min(c.volume),
          'volumeName', min(c.volume_name),
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
  `)) as unknown as {
    rows: Array<{
      level: SummaryLevel;
      book_id: string;
      range_start: number;
      range_end: number;
      label: string;
      content: string;
      meta: SummaryMeta;
    }>;
  };

  return (rows.rows ?? []).map((row) => ({
    level: row.level,
    bookId: row.book_id,
    rangeStart: row.range_start,
    rangeEnd: row.range_end,
    label: row.label,
    content: row.content,
    meta: row.meta ?? {},
  }));
}

export async function insertSummaryRow(row: ReturnType<typeof rowForSummaryInsert>): Promise<void> {
  await db.insert(schema.summaries).values(row);
}

export async function deleteSummariesForBook(bookId: string): Promise<number | undefined> {
  const result = (await db.execute(sql`
    DELETE FROM summaries WHERE book_id = ${bookId}
  `)) as unknown as { rowCount?: number };
  return result.rowCount;
}
```

This intentionally reconstructs rollup metadata from `chapters` instead of adding a `meta` column to `summaries`. No migration is part of ticket 008.

- [ ] **Step 4: Run tests and typecheck for this module**

Run: `pnpm test lib/ingest/summaries.test.ts`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS. If typecheck fails, fix the reported type mismatch before continuing.

---

### Task 5: Wire The Summaries Phase Into scripts/ingest.ts

**Files:**
- Modify: `scripts/ingest.ts`
- Modify: `lib/ingest/summaries.ts`

- [ ] **Step 1: Update the phase type and parse validation**

In `scripts/ingest.ts`, change:

```typescript
type Phase = "chapters" | "chunks" | "ner" | "events";
const PHASES: readonly Phase[] = ["chapters", "chunks", "ner", "events"] as const;
```

to:

```typescript
type Phase = "chapters" | "chunks" | "ner" | "events" | "summaries";
const PHASES: readonly Phase[] = ["chapters", "chunks", "ner", "events", "summaries"] as const;
```

- [ ] **Step 2: Add imports for summaries**

In `scripts/ingest.ts`, add:

```typescript
import {
  addSummaryUsage,
  buildChapterTargets,
  countTargetsByLevel,
  deleteSummariesForBook,
  estimateSummaryCost,
  insertSummaryRow,
  loadChapterSourceRows,
  loadExistingSummaryKeys,
  loadSummaryRows,
  makeEmbedder,
  makeModelSummaryGenerator,
  planNextSummaryTargets,
  summarizeOneTarget,
  zeroSummaryUsage,
  type SummaryUsage,
} from "@/lib/ingest/summaries";
```

- [ ] **Step 3: Add the ingestSummariesPhase function**

In `scripts/ingest.ts`, add before `main()`:

```typescript
async function ingestSummariesPhase(
  bookId: BookId,
  limit: number | null,
  dryRun: boolean,
  yes: boolean,
  reset: boolean,
): Promise<void> {
  const contextModelEnv = process.env.INGEST_CONTEXT_MODEL;
  const summaryModelEnv = process.env.INGEST_SUMMARY_MODEL ?? process.env.CHAT_MODEL;
  const embedModelEnv = process.env.INGEST_EMBED_MODEL;
  if (!contextModelEnv) throw new Error("INGEST_CONTEXT_MODEL is not set in .env.local");
  if (!summaryModelEnv) throw new Error("INGEST_SUMMARY_MODEL or CHAT_MODEL must be set in .env.local");
  if (!embedModelEnv) throw new Error("INGEST_EMBED_MODEL is not set in .env.local");
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not set in .env.local");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set in .env.local");

  if (reset) {
    if (!yes) {
      throw new Error("[summaries] --reset requires --yes to confirm. This will DELETE all summaries for this book.");
    }
    const deleted = await deleteSummariesForBook(bookId);
    console.log(`[summaries] --reset --yes: deleted ${deleted ?? "?"} summaries for ${bookId}`);
  }

  const contextModelId = bareModelId(contextModelEnv);
  const summaryModelId = bareModelId(summaryModelEnv);
  const embedModelId = bareModelId(embedModelEnv);
  const contextModel = deepseekProvider().chat(contextModelId);
  const summaryModel = deepseekProvider().chat(summaryModelId);
  const embedModel = openai.embedding(embedModelId);
  const generate = makeModelSummaryGenerator({ contextModel, summaryModel });
  const embed = makeEmbedder(embedModel);

  console.log(
    `[summaries] book=${bookId} contextModel=deepseek:${contextModelId} summaryModel=deepseek:${summaryModelId} embedModel=openai:${embedModelId}`,
  );

  const sourceRows = await loadChapterSourceRows(bookId);
  if (sourceRows.length === 0) {
    throw new Error(`[summaries] no chunks found for ${bookId}. Run --phase chunks first.`);
  }

  const chapterTargets = buildChapterTargets(sourceRows);
  const existingKeys = await loadExistingSummaryKeys(bookId);
  const chapterSummaries = await loadSummaryRows(bookId, "chapter");
  const arcSummaries = await loadSummaryRows(bookId, "arc");
  const volumeSummaries = await loadSummaryRows(bookId, "volume");
  const targets = planNextSummaryTargets({
    chapterTargets,
    chapterSummaries,
    arcSummaries,
    volumeSummaries,
    bookTitles: BOOK_TITLES,
    existingKeys,
    limit,
  });
  const counts = countTargetsByLevel(targets);
  console.log(
    `[summaries] pending this run: chapter=${counts.chapter} arc=${counts.arc} volume=${counts.volume} series=${counts.series}`,
  );

  if (targets.length === 0) {
    console.log("[summaries] nothing to do");
    return;
  }

  const sampleTargets = targets.slice(0, Math.min(targets.length, targets[0].level === "chapter" ? 20 : 3));
  const sampleUsage = zeroSummaryUsage();
  console.log(`[summaries] preflight: sampling ${sampleTargets.length} ${targets[0].level} targets`);
  for (const target of sampleTargets) {
    const result = await summarizeOneTarget({ target, generate, embed });
    addSummaryUsage(sampleUsage, result.usage);
    console.log(`[summaries]   sample ${target.level} ${target.label}: ${result.row.content.slice(0, 120).replace(/\s+/g, " ")}...`);
  }
  const projectedCost = estimateSummaryCost(sampleUsage) * (targets.length / Math.max(sampleTargets.length, 1));
  console.log(`[summaries] sample cost: $${estimateSummaryCost(sampleUsage).toFixed(4)}`);
  console.log(`[summaries] Estimated cost: $${projectedCost.toFixed(2)} for ${targets.length} ${targets[0].level} targets`);

  if (dryRun) {
    console.log("[summaries] dry-run complete — no DB writes");
    return;
  }

  if (!yes) {
    console.log("[summaries] preflight complete — pass --yes to proceed with the real run");
    return;
  }

  const totalUsage = zeroSummaryUsage();
  let inserted = 0;
  console.log(`[summaries] proceeding with real run on ${targets.length} targets`);
  for (const target of targets) {
    const result = await summarizeOneTarget({ target, generate, embed });
    await insertSummaryRow(result.row);
    addSummaryUsage(totalUsage, result.usage);
    inserted++;
    if (inserted % 10 === 0 || inserted === targets.length) {
      console.log(
        `[summaries]   ${inserted}/${targets.length} inserted ($${estimateSummaryCost(totalUsage).toFixed(2)} so far)`,
      );
    }
  }

  console.log(`[summaries] DONE — ${inserted} summaries inserted`);
  console.log(`[summaries] estimated total cost: $${estimateSummaryCost(totalUsage).toFixed(2)}`);
}
```

- [ ] **Step 4: Add the switch case**

In `main()` switch, add:

```typescript
    case "summaries":
      await ingestSummariesPhase(
        args.bookId,
        args.limit,
        args.dryRun,
        args.yes,
        args.reset,
      );
      break;
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS. Fix import/type mismatches before proceeding.

---

### Task 6: Verify DB Metadata Reconstruction

**Files:**
- Modify: `lib/ingest/summaries.ts`

- [ ] **Step 1: Confirm no summaries schema migration is needed**

Read `lib/db/schema.ts` and confirm `summaries` contains only:

```typescript
level
bookId
rangeStart
rangeEnd
label
content
embedding
```

Expected: no `meta` column exists and no migration is added for ticket 008.

- [ ] **Step 2: Validate the `loadSummaryRows()` join logic**

Ensure `loadSummaryRows()` reconstructs metadata by joining summaries to chapters on chapter ranges:

```sql
SELECT
  s.level,
  s.book_id,
  s.range_start,
  s.range_end,
  s.label,
  s.content,
  jsonb_build_object(
    'volume', min(c.volume),
    'volumeName', min(c.volume_name),
    'arc', min(c.arc),
    'arcName', min(c.arc_name),
    'contentKind', min(c.content_kind)
  ) AS meta
FROM summaries s
JOIN chapters c
  ON c.book_id = s.book_id
 AND c.chapter_num BETWEEN s.range_start AND s.range_end
WHERE s.book_id = ${bookId}
  AND s.level = ${level}
GROUP BY s.level, s.book_id, s.range_start, s.range_end, s.label, s.content
ORDER BY s.range_start, s.range_end, s.label
```

For `chapter` and `arc` summaries, this is precise because each row maps to one chapter or one arc range. For `volume` summaries, use `volume` and `volumeName`; ignore `arc`. For `series`, return `{ contentKind: "main" }`.

- [ ] **Step 3: Add a targeted unit test for DB-row metadata shape**

If implementation extracts the SQL mapper into a pure function, add this test:

```typescript
import { mapSummaryDbRow } from "./summaries";

describe("mapSummaryDbRow", () => {
  it("maps reconstructed SQL metadata into SummaryRow", () => {
    expect(mapSummaryDbRow({
      level: "arc",
      book_id: "lotm1",
      range_start: 254,
      range_end: 294,
      label: "Faceless - Death of Lanevus",
      content: "Klein kills Lanevus.",
      meta: {
        volume: 2,
        volumeName: "Faceless",
        arc: 2,
        arcName: "Death of Lanevus",
        contentKind: "main",
      },
    })).toEqual({
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
});
```

- [ ] **Step 4: Re-run verification**

Run: `pnpm test lib/ingest/summaries.test.ts`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

---

### Task 7: Dry Run And Real Run Verification

**Files:**
- Modify: `docs/tasks/008-hierarchical-summaries.md`
- Modify: `docs/tasks/README.md`

- [ ] **Step 1: Mark ticket in progress**

In `docs/tasks/008-hierarchical-summaries.md`, change:

```yaml
status: todo
```

to:

```yaml
status: in-progress
```

Update `updated:` to the current date.

In `docs/tasks/README.md`, change ticket 008 status from `todo` to `in-progress`.

- [ ] **Step 2: Run focused tests**

Run: `pnpm test lib/ingest/summaries.test.ts`

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Run eval schema validation**

Run: `pnpm eval:validate`

Expected: PASS.

- [ ] **Step 5: Run summaries dry-run**

Run: `pnpm ingest --book lotm1 --phase summaries --limit 3 --dry-run`

Expected:

```text
[summaries] book=lotm1 ...
[summaries] pending this run: chapter=3 arc=0 volume=0 series=0
[summaries] preflight: sampling 3 chapter targets
[summaries] dry-run complete — no DB writes
Done.
```

- [ ] **Step 6: Run first real limited insert**

Run: `pnpm ingest --book lotm1 --phase summaries --limit 3 --yes`

Expected:

```text
[summaries] proceeding with real run on 3 targets
[summaries] DONE — 3 summaries inserted
Done.
```

Validate with MCP read-only query:

```sql
SELECT level, book_id, count(*)::int
FROM summaries
WHERE book_id = 'lotm1'
GROUP BY level, book_id;
```

Expected: one row with `level='chapter'`, `book_id='lotm1'`, `count=3`.

- [ ] **Step 7: Run full summaries for both books only after cost looks acceptable**

Run:

```bash
pnpm ingest --book lotm1 --phase summaries --yes
pnpm ingest --book coi --phase summaries --yes
```

Expected: repeated runs progress through levels. If the first full run only completes chapter targets, run the command again to unlock arc, volume, and series levels until it prints `nothing to do`.

- [ ] **Step 8: Verify final counts**

Run MCP read-only query:

```sql
SELECT level, count(*)::int
FROM summaries
GROUP BY level
ORDER BY level;
```

Expected:

```text
arc     71
chapter 2613
series  2
volume  16
```

- [ ] **Step 9: Verify semantic sanity**

Use a short TypeScript one-off or existing script context to embed:

```text
Klein kills Lanevus after Audrey reports the clue
```

Then query:

```sql
SELECT level, label, range_start, range_end, content
FROM summaries
WHERE book_id = 'lotm1'
ORDER BY embedding <=> '[EMBEDDING_VECTOR]'::vector
LIMIT 5;
```

Expected: top result is `Faceless - Death of Lanevus` or an adjacent Faceless arc.

- [ ] **Step 10: Document resolution**

In `docs/tasks/008-hierarchical-summaries.md`, add:

```markdown
## Resolution

Closed YYYY-MM-DD.

- Implemented `lib/ingest/summaries.ts` with resumable chapter, arc, volume, and series summary generation.
- Added `summaries` to `scripts/ingest.ts`.
- Verified final counts: chapter=2613, arc=71, volume=16, series=2.
- Semantic sanity query used: "Klein kills Lanevus after Audrey reports the clue".

### Verification

- `pnpm test lib/ingest/summaries.test.ts`
- `pnpm typecheck`
- `pnpm eval:validate`
- `pnpm ingest --book lotm1 --phase summaries --yes`
- `pnpm ingest --book coi --phase summaries --yes`
```

Set frontmatter `status: done` only after all verification succeeds. Update `docs/tasks/README.md` to `done` at the same time.

---

## Self-Review

- Spec coverage: The plan covers `lib/ingest/summaries.ts`, `scripts/ingest.ts --phase summaries`, embeddings, cost preflight, `--yes`, resumability, expected counts, and semantic sanity verification.
- Placeholder scan: No `TBD` or `TODO` placeholders remain. The schema metadata question is resolved by reconstructing metadata from `chapters` joins.
- Type consistency: Uses `chapter | arc | volume | series` levels, `bookId/rangeStart/rangeEnd/label/content/embedding`, and current `ContentKind` values.
- Risk: `loadSummaryRows()` depends on `range_start/range_end` remaining aligned with chapter ranges. This is already part of the deterministic target design.
