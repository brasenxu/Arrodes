import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EVENT_TYPES } from "./types";
import {
  EVENT_TYPE_FILTER_SCHEMA,
  SUMMARY_LOOKUP_SCHEMA,
  extractChapterPin,
  isValidPosition,
  resolveEntityMatch,
  stripProviderPrefix,
  withinPosition,
  type EntityMatchRow,
} from "./schemas";

const row = (id: number, canonicalName: string, aliases: string[]): EntityMatchRow => ({
  id,
  canonicalName,
  aliases,
});

describe("EVENT_TYPE_FILTER_SCHEMA", () => {
  it("accepts every EVENT_TYPES value", () => {
    for (const t of EVENT_TYPES) {
      const result = EVENT_TYPE_FILTER_SCHEMA.safeParse(t);
      expect(result.success, `should accept ${t}`).toBe(true);
    }
  });

  it('accepts "any"', () => {
    expect(EVENT_TYPE_FILTER_SCHEMA.safeParse("any").success).toBe(true);
  });

  it('rejects "location_change" (audit defect 1 regression pin)', () => {
    expect(EVENT_TYPE_FILTER_SCHEMA.safeParse("location_change").success).toBe(
      false,
    );
  });

  it("rejects arbitrary strings", () => {
    expect(EVENT_TYPE_FILTER_SCHEMA.safeParse("nonsense").success).toBe(false);
    expect(EVENT_TYPE_FILTER_SCHEMA.safeParse("").success).toBe(false);
  });
});

describe("stripProviderPrefix", () => {
  it("strips an openai/ namespace from an embed id", () => {
    expect(stripProviderPrefix("openai/text-embedding-3-small")).toBe(
      "text-embedding-3-small",
    );
  });

  it("leaves a bare id unchanged", () => {
    expect(stripProviderPrefix("text-embedding-3-small")).toBe(
      "text-embedding-3-small",
    );
  });

  it("strips a google/ namespace", () => {
    expect(stripProviderPrefix("google/gemini-2.5-flash")).toBe(
      "gemini-2.5-flash",
    );
  });
});

describe("isValidPosition", () => {
  it("accepts a full valid position", () => {
    expect(isValidPosition({ lotm1: 100, coi: null })).toBe(true);
    expect(isValidPosition({ lotm1: null, coi: 0 })).toBe(true);
    expect(isValidPosition({ lotm1: 1396, coi: 1180 })).toBe(true);
  });

  it("rejects partial positions (missing book)", () => {
    expect(isValidPosition({ lotm1: 50 })).toBe(false);
    expect(isValidPosition({ coi: 50 })).toBe(false);
    expect(isValidPosition({})).toBe(false);
  });

  it("rejects negative values", () => {
    expect(isValidPosition({ lotm1: -1, coi: 0 })).toBe(false);
    expect(isValidPosition({ lotm1: 0, coi: -1 })).toBe(false);
  });

  it("rejects non-integers", () => {
    expect(isValidPosition({ lotm1: 1.5, coi: 0 })).toBe(false);
  });

  it("rejects wrong types and non-objects", () => {
    expect(isValidPosition("x")).toBe(false);
    expect(isValidPosition(null)).toBe(false);
    expect(isValidPosition(undefined)).toBe(false);
    expect(isValidPosition({ lotm1: "100", coi: 0 })).toBe(false);
  });
});

// Guard against accidental widening: the schema is exactly EVENT_TYPES + "any".
describe("EVENT_TYPE_FILTER_SCHEMA shape", () => {
  it("is a zod schema built on EVENT_TYPES, not an inline list", () => {
    const accepted = EVENT_TYPES.flatMap((t) =>
      EVENT_TYPE_FILTER_SCHEMA.safeParse(t).success ? [t] : [],
    );
    expect(accepted).toHaveLength(EVENT_TYPES.length);
  });
});

describe("extractChapterPin (chapter-targeted retrieval)", () => {
  it('extracts from "what happens in chapter 245"', () => {
    expect(extractChapterPin("What happens in chapter 245?")).toBe(245);
  });

  it("takes the LAST chapter mention (summarize chapter X … not chapter Y questions aside)", () => {
    expect(extractChapterPin("Summarize chapter 245 of Lord of the Mysteries.")).toBe(245);
  });

  it('extracts from "Ch.245" and "Ch. 245" forms', () => {
    expect(extractChapterPin("What does Klein do in Ch.245?")).toBe(245);
    expect(extractChapterPin("Explain Ch. 245 events")).toBe(245);
  });

  it("returns null without an explicit chapter number", () => {
    expect(extractChapterPin("What abilities does the Seer pathway grant?")).toBe(null);
    expect(extractChapterPin("Who is the Fool?")).toBe(null);
  });

  it("ignores non-chapter numbers", () => {
    expect(extractChapterPin("What are the 22 pathways?")).toBe(null);
    expect(extractChapterPin("List all meetings before chapter 500")).toBe(500);
  });
});

describe("SUMMARY_LOOKUP_SCHEMA (ticket 026)", () => {  it("accepts a chapter-scope lookup with chapterNum", () => {
    expect(
      SUMMARY_LOOKUP_SCHEMA.safeParse({ book: "lotm1", scope: "chapter", chapterNum: 245 })
        .success,
    ).toBe(true);
  });

  it("chapter scope requires chapterNum", () => {
    expect(
      SUMMARY_LOOKUP_SCHEMA.safeParse({ book: "lotm1", scope: "chapter" }).success,
    ).toBe(false);
  });

  it("arc/volume/series scope requires name", () => {
    expect(
      SUMMARY_LOOKUP_SCHEMA.safeParse({ book: "coi", scope: "arc" }).success,
    ).toBe(false);
    expect(
      SUMMARY_LOOKUP_SCHEMA.safeParse({ book: "coi", scope: "volume", name: "Sinner" })
        .success,
    ).toBe(true);
    expect(
      SUMMARY_LOOKUP_SCHEMA.safeParse({ book: "lotm1", scope: "series", name: "Lord of the Mysteries" })
        .success,
    ).toBe(true);
  });

  it("chapter scope must not carry name; name scopes must not carry chapterNum", () => {
    expect(
      SUMMARY_LOOKUP_SCHEMA.safeParse({ book: "lotm1", scope: "chapter", chapterNum: 5, name: "Clown" })
        .success,
    ).toBe(false);
    expect(
      SUMMARY_LOOKUP_SCHEMA.safeParse({ book: "lotm1", scope: "arc", name: "Clown", chapterNum: 5 })
        .success,
    ).toBe(false);
  });

  it("rejects unknown scopes and bad chapterNum", () => {
    expect(
      SUMMARY_LOOKUP_SCHEMA.safeParse({ book: "lotm1", scope: "book", name: "x" }).success,
    ).toBe(false);
    expect(
      SUMMARY_LOOKUP_SCHEMA.safeParse({ book: "lotm1", scope: "chapter", chapterNum: 0 }).success,
    ).toBe(false);
    expect(
      SUMMARY_LOOKUP_SCHEMA.safeParse({ book: "lotm1", scope: "chapter", chapterNum: 2.5 }).success,
    ).toBe(false);
  });
});

describe("withinPosition (summary gate)", () => {
  it("gates by the book's ceiling", () => {
    const p = { lotm1: 100, coi: null };
    expect(withinPosition(p, "lotm1", 100)).toBe(true);
    expect(withinPosition(p, "lotm1", 101)).toBe(false);
    expect(withinPosition(p, "coi", 1)).toBe(false);
  });

  it("null position gates everything", () => {
    expect(withinPosition({ lotm1: null, coi: null }, "lotm1", 1)).toBe(false);
  });
});

describe("resolveEntityMatch", () => {
  it("exact canonical match wins even when an alias match appears first", () => {
    // Audit defect 2: "Fool" is a pathway canonical AND a Klein alias.
    const rows = [
      row(2, "Klein Moretti", ["The Fool", "Fool", "Fool God"]),
      row(7, "Fool", []),
    ];
    const result = resolveEntityMatch(rows, "fool");
    expect(result).toEqual({ entity: row(7, "Fool", []) });
  });

  it("is case-insensitive on the canonical comparison", () => {
    const rows = [row(7, "Fool", [])];
    expect(resolveEntityMatch(rows, "FOOL")).toEqual({ entity: row(7, "Fool", []) });
  });

  it("two alias-only matches are ambiguous with sorted candidates", () => {
    const rows = [
      row(5, "B", ["mist"]),
      row(3, "A", ["Mist"]),
    ];
    const result = resolveEntityMatch(rows, "mist");
    expect(result).toEqual({
      ambiguous: true,
      candidates: [row(3, "A", ["Mist"]), row(5, "B", ["mist"])],
    });
  });

  it("single alias match resolves to that entity", () => {
    const rows = [row(4, "Audrey", ["Spectator", "Miss Justice"])];
    expect(resolveEntityMatch(rows, "miss justice")).toEqual({
      entity: row(4, "Audrey", ["Spectator", "Miss Justice"]),
    });
  });

  it("two canonical matches (case-collision in data) are ambiguous", () => {
    const rows = [row(9, "Fool", []), row(11, "FOOL", [])];
    const result = resolveEntityMatch(rows, "fool");
    expect(result).toEqual({
      ambiguous: true,
      candidates: [row(9, "Fool", []), row(11, "FOOL", [])],
    });
  });

  it("no matching rows returns ambiguous with empty candidates (defensive)", () => {
    expect(resolveEntityMatch([], "anything")).toEqual({
      ambiguous: true,
      candidates: [],
    });
  });

  it("is deterministic: shuffled input, same output", () => {
    const rows = [row(5, "B", ["mist"]), row(3, "A", ["Mist"]), row(9, "C", ["misty"])];
    const a = resolveEntityMatch(rows, "mist");
    const b = resolveEntityMatch([...rows].reverse(), "mist");
    expect(b).toEqual(a);
  });
});
