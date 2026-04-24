import { describe, it, expect } from "vitest";
import { resolveSectionIndex, type MediaWikiSection } from "../src/lib/sections";

const SECTIONS: MediaWikiSection[] = [
  { toclevel: 1, level: "2", line: "Overview", number: "1", index: "1", byteoffset: 0, anchor: "Overview", fromtitle: "X" },
  { toclevel: 1, level: "2", line: "Timeline of Major Events", number: "2", index: "2", byteoffset: 500, anchor: "Timeline_of_Major_Events", fromtitle: "X" },
  { toclevel: 2, level: "3", line: "Chapter 1", number: "2.1", index: "3", byteoffset: 700, anchor: "Chapter_1", fromtitle: "X" },
];

describe("resolveSectionIndex", () => {
  it("returns null when no section input given", () => {
    expect(resolveSectionIndex(SECTIONS, undefined)).toEqual({ index: null });
  });

  it("returns integer input verbatim (stringified) when integer provided", () => {
    expect(resolveSectionIndex(SECTIONS, 2)).toEqual({ index: "2" });
  });

  it("accepts numeric string input unchanged", () => {
    expect(resolveSectionIndex(SECTIONS, "3")).toEqual({ index: "3" });
  });

  it("matches a string input case-insensitively against line, returns that section's index", () => {
    expect(resolveSectionIndex(SECTIONS, "timeline of major events")).toEqual({ index: "2" });
  });

  it("matches first occurrence when multiple sections share a line", () => {
    const dup = [
      ...SECTIONS,
      { toclevel: 1, level: "2", line: "Overview", number: "3", index: "4", byteoffset: 900, anchor: "Overview_2", fromtitle: "X" },
    ];
    expect(resolveSectionIndex(dup, "Overview")).toEqual({ index: "1" });
  });

  it("returns notFound when string does not match any line", () => {
    expect(resolveSectionIndex(SECTIONS, "Trivia")).toEqual({ index: null, notFound: true });
  });

  it("supports regex-based match via matchMode: 'regex'", () => {
    expect(resolveSectionIndex(SECTIONS, /timeline/i, { matchMode: "regex" })).toEqual({ index: "2" });
  });
});
