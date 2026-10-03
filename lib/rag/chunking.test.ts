import { describe, expect, it } from "vitest";
import { chunkChapter } from "./chunking";

const smallPara = (marker: string, words: number) =>
  `${marker} ${"filler ".repeat(words)}`.trim();
// > 600 approx tokens ⇒ > ~462 words.
const oversizedPara = (marker: string) =>
  `${marker} ${"content ".repeat(470)}`.trim();

describe("chunkChapter — oversized paragraph ordering (audit defect: chunk-order inversion)", () => {
  it("emits chunks in narrative order: before → oversized → after", () => {
    const before = smallPara("BEFORE", 30);
    const big = oversizedPara("OVERSIZE");
    const after = smallPara("AFTER", 20);
    const rawText = [before, big, after].join("\n\n");

    const chunks = chunkChapter(rawText);
    expect(chunks.length).toBeGreaterThan(1);

    const joined = chunks.map((c) => c.content).join("\n\n");
    const beforeIdx = joined.indexOf("BEFORE");
    const oversizeIdx = joined.indexOf("OVERSIZE");
    const afterIdx = joined.lastIndexOf("AFTER");

    // Narrative order preserved in the emitted chunk sequence.
    expect(beforeIdx).toBeGreaterThanOrEqual(0);
    expect(oversizeIdx).toBeGreaterThan(beforeIdx);
    expect(afterIdx).toBeGreaterThan(oversizeIdx);
  });

  it("flushes a pending buffer BEFORE the oversized paragraph's sentence chunks", () => {
    const before = smallPara("BEFORE", 30); // < MIN_TOKENS → previously stranded
    const big = oversizedPara("OVERSIZE");
    const rawText = `${before}\n\n${big}`;

    const chunks = chunkChapter(rawText);
    // The BEFORE paragraph must be its own flushed chunk at index 0,
    // not merged into a final flush emitted after the OVERSIZE chunks.
    expect(chunks[0].content).toContain("BEFORE");
    const firstOversize = chunks.findIndex((c) => c.content.includes("OVERSIZE"));
    expect(firstOversize).toBeGreaterThan(0);
    // No chunk after the first OVERSIZE chunk contains BEFORE text.
    expect(
      chunks.slice(firstOversize).some((c) => c.content.includes("BEFORE")),
    ).toBe(false);
  });

  it("keeps chunkIndex strictly increasing with content order", () => {
    const rawText = [
      smallPara("A1", 20),
      oversizedPara("BIG"),
      smallPara("B1", 20),
      oversizedPara("BIG2"),
      smallPara("C1", 20),
    ].join("\n\n");

    const chunks = chunkChapter(rawText);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBe(i);
    }
    const joined = chunks.map((c) => c.content).join("\n\n");
    const positions = ["A1", "BIG", "B1", "BIG2", "C1"].map((m) => joined.indexOf(m));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
