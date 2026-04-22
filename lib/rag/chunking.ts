/**
 * Chapter-aware hybrid chunker. Splits a chapter into ~400–600 token windows
 * with ~100 token overlap, respecting paragraph boundaries where possible.
 *
 * Token count is approximated as words × 1.3 (LOTM's English prose is close
 * enough to this ratio that a proper BPE tokenizer isn't worth the dep).
 */

const TARGET_TOKENS = 500;
const MIN_TOKENS = 400;
const MAX_TOKENS = 600;
const OVERLAP_TOKENS = 100;

export type RawChunk = {
  chunkIndex: number;
  content: string;
  approxTokens: number;
};

const approxTokens = (text: string) =>
  Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.3);

export function chunkChapter(rawText: string): RawChunk[] {
  const paragraphs = rawText
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: RawChunk[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;

  const flush = (carryOver: string[] = []) => {
    if (buffer.length === 0) return;
    const content = buffer.join("\n\n");
    chunks.push({
      chunkIndex: chunks.length,
      content,
      approxTokens: bufferTokens,
    });
    buffer = [...carryOver];
    bufferTokens = carryOver.reduce((a, p) => a + approxTokens(p), 0);
  };

  for (const para of paragraphs) {
    const paraTokens = approxTokens(para);

    // Paragraph on its own would exceed max → sentence-split it.
    if (paraTokens > MAX_TOKENS) {
      if (bufferTokens >= MIN_TOKENS) flush();
      for (const sentenceChunk of splitLongParagraph(para)) {
        chunks.push({
          chunkIndex: chunks.length,
          content: sentenceChunk,
          approxTokens: approxTokens(sentenceChunk),
        });
      }
      continue;
    }

    if (bufferTokens + paraTokens > MAX_TOKENS) {
      // Build overlap tail before flushing.
      const overlap: string[] = [];
      let overlapTokens = 0;
      for (let i = buffer.length - 1; i >= 0 && overlapTokens < OVERLAP_TOKENS; i--) {
        overlap.unshift(buffer[i]);
        overlapTokens += approxTokens(buffer[i]);
      }
      flush(overlap);
    }

    buffer.push(para);
    bufferTokens += paraTokens;

    if (bufferTokens >= TARGET_TOKENS && bufferTokens >= MIN_TOKENS) {
      const overlap: string[] = [];
      let overlapTokens = 0;
      for (let i = buffer.length - 1; i >= 0 && overlapTokens < OVERLAP_TOKENS; i--) {
        overlap.unshift(buffer[i]);
        overlapTokens += approxTokens(buffer[i]);
      }
      flush(overlap);
    }
  }

  flush();
  return chunks;
}

function splitLongParagraph(para: string): string[] {
  const sentences = para.match(/[^.!?]+[.!?]+["']?\s*/g) ?? [para];
  const out: string[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  for (const s of sentences) {
    const t = approxTokens(s);
    if (bufTokens + t > MAX_TOKENS && buf.length > 0) {
      out.push(buf.join(""));
      buf = [];
      bufTokens = 0;
    }
    buf.push(s);
    bufTokens += t;
  }
  if (buf.length) out.push(buf.join(""));
  return out;
}
