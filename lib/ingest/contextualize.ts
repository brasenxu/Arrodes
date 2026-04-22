/**
 * Anthropic-style Contextual Retrieval: for each chunk in a chapter, ask Haiku
 * for 50–100 tokens of situating context so retrieval doesn't lose the chunk's
 * place in the story.
 *
 * The full chapter is sent once per chunk, but wrapped in an ephemeral prompt
 * cache with 1h TTL. The first chunk writes the cache (2× base input cost on
 * Anthropic); every subsequent chunk in the same chapter reads it (0.1× base).
 * Without caching this would be ~$50+ ingest; with caching it's ~$20.
 *
 * Concurrency: first chunk runs serially to warm the cache. Anthropic's docs:
 * "A cache entry becomes readable only after the first response begins
 * streaming." Parallelising before that means every worker pays the write
 * premium and we get no read hits. Remaining chunks fan out bounded.
 */

import { generateText, type LanguageModel } from "ai";
import type { RawChunk } from "@/lib/rag/chunking";

export type ContextualPrefix = {
  chunkIndex: number;
  contextualPrefix: string;
};

export type ContextualizeUsage = {
  noCacheInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

export type ContextualizeResult = {
  prefixes: ContextualPrefix[];
  usage: ContextualizeUsage;
};

export const zeroContextualizeUsage = (): ContextualizeUsage => ({
  noCacheInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
});

const INTRA_CHAPTER_CONCURRENCY = 3;

// Anthropic's contextual-retrieval task, verbatim from their blog (2024).
// Changing a single byte invalidates the prompt cache across re-runs, so keep
// this string frozen unless you have a reason to re-write the full corpus.
const TASK_INSTRUCTION =
  "Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.";

export async function contextualizeChunks(opts: {
  model: LanguageModel;
  chapterText: string;
  chapterHeader: string;
  chunks: RawChunk[];
}): Promise<ContextualizeResult> {
  const { model, chapterText, chapterHeader, chunks } = opts;

  const prefixes: ContextualPrefix[] = new Array(chunks.length);
  const usage = zeroContextualizeUsage();

  const runOne = async (i: number) => {
    const one = await contextualizeOne({
      model,
      chapterText,
      chapterHeader,
      chunkText: chunks[i].content,
    });
    prefixes[i] = {
      chunkIndex: chunks[i].chunkIndex,
      contextualPrefix: one.text,
    };
    usage.noCacheInputTokens += one.usage.noCacheInputTokens;
    usage.cacheReadTokens += one.usage.cacheReadTokens;
    usage.cacheWriteTokens += one.usage.cacheWriteTokens;
    usage.outputTokens += one.usage.outputTokens;
  };

  if (chunks.length === 0) return { prefixes, usage };

  // Warm the 1h prompt cache on the chapter block before fanning out.
  await runOne(0);

  const tail = Array.from({ length: chunks.length - 1 }, (_, k) => k + 1);
  await runWithConcurrency(tail, INTRA_CHAPTER_CONCURRENCY, runOne);

  return { prefixes, usage };
}

async function contextualizeOne(opts: {
  model: LanguageModel;
  chapterText: string;
  chapterHeader: string;
  chunkText: string;
}): Promise<{ text: string; usage: ContextualizeUsage }> {
  const { model, chapterText, chapterHeader, chunkText } = opts;

  const result = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            // Document block — prompt-cached. Keep header + body deterministic:
            // any byte change invalidates every downstream cache read.
            text: `<document title=${JSON.stringify(chapterHeader)}>\n${chapterText}\n</document>`,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          },
          {
            type: "text",
            text: `Here is the chunk we want to situate within the whole document:\n<chunk>\n${chunkText}\n</chunk>\n\n${TASK_INSTRUCTION}`,
          },
        ],
      },
    ],
  });

  const u = result.usage;
  const detailed = u.inputTokenDetails;
  // If the provider surfaces cache-aware detail fields, use them. Otherwise
  // treat the full inputTokens as non-cached (conservative — over-estimates
  // cost rather than under-estimates).
  const cacheRead = detailed?.cacheReadTokens ?? 0;
  const cacheWrite = detailed?.cacheWriteTokens ?? 0;
  const noCache =
    detailed?.noCacheTokens ??
    (typeof u.inputTokens === "number"
      ? Math.max(u.inputTokens - cacheRead - cacheWrite, 0)
      : 0);

  return {
    text: result.text.trim(),
    usage: {
      noCacheInputTokens: noCache,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      outputTokens: u.outputTokens ?? 0,
    },
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}
