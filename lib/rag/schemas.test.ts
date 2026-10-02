import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EVENT_TYPES } from "./types";
import {
  EVENT_TYPE_FILTER_SCHEMA,
  isValidPosition,
  normalizeEmbedModelId,
} from "./schemas";

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

describe("normalizeEmbedModelId", () => {
  it('prefixes a bare OpenAI embed id with "openai/"', () => {
    expect(normalizeEmbedModelId("text-embedding-3-small")).toBe(
      "openai/text-embedding-3-small",
    );
  });

  it("leaves a gateway-format id unchanged", () => {
    expect(normalizeEmbedModelId("openai/text-embedding-3-small")).toBe(
      "openai/text-embedding-3-small",
    );
  });

  it("leaves a namespaced provider id unchanged", () => {
    expect(normalizeEmbedModelId("deepseek/deepseek-v4-flash")).toBe(
      "deepseek/deepseek-v4-flash",
    );
  });

  it("maps unknown bare ids to the openai/ namespace", () => {
    expect(normalizeEmbedModelId("text-embedding-3-large")).toBe(
      "openai/text-embedding-3-large",
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
