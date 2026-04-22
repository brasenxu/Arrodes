/**
 * Batched wrapper around AI SDK's `embedMany` for contextualized chunk text.
 *
 * The SDK auto-splits on `model.maxEmbeddingsPerCall` (2048 for OpenAI's
 * text-embedding-3-small), but we batch narrower at 100 so a transient 5xx on
 * one batch only loses ~100 embeddings' worth of work, not 2000, and so
 * retry logic surrounds a smaller unit. Cost per embedding is unchanged.
 */

import { embedMany, type EmbeddingModel } from "ai";

export type EmbedResult = {
  embeddings: number[][];
  tokensUsed: number;
};

const BATCH_SIZE = 100;

export async function embedValues(opts: {
  model: EmbeddingModel;
  values: string[];
}): Promise<EmbedResult> {
  const { model, values } = opts;
  if (values.length === 0) return { embeddings: [], tokensUsed: 0 };

  const embeddings: number[][] = [];
  let tokensUsed = 0;

  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);
    const result = await embedMany({ model, values: batch });
    if (result.embeddings.length !== batch.length) {
      throw new Error(
        `embedMany returned ${result.embeddings.length} vectors for ${batch.length} inputs — provider contract broken`,
      );
    }
    embeddings.push(...result.embeddings);
    tokensUsed += result.usage.tokens ?? 0;
  }

  return { embeddings, tokensUsed };
}
