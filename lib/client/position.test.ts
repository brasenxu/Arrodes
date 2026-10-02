import { describe, expect, it } from "vitest";
import {
  POSITION_STORAGE_KEY,
  parseStoredPosition,
  serializeStoredPosition,
} from "./position";

describe("parseStoredPosition", () => {
  it("parses a valid stored position", () => {
    const raw = JSON.stringify({
      lotm1: 100,
      coi: null,
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(parseStoredPosition(raw)).toEqual({
      lotm1: 100,
      coi: null,
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
  });

  it("accepts the both-null state (hasn't started either book)", () => {
    const raw = JSON.stringify({
      lotm1: null,
      coi: null,
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(parseStoredPosition(raw)?.lotm1).toBe(null);
  });

  it("returns null on garbage JSON", () => {
    expect(parseStoredPosition("not json{{{")).toBe(null);
  });

  it("returns null on a partial position (missing book)", () => {
    expect(
      parseStoredPosition(JSON.stringify({ lotm1: 50 })),
    ).toBe(null);
  });

  it("returns null on wrong types", () => {
    expect(parseStoredPosition(JSON.stringify({ lotm1: "100", coi: null, updatedAt: "x" }))).toBe(null);
    expect(parseStoredPosition(JSON.stringify({ lotm1: -1, coi: null, updatedAt: "x" }))).toBe(null);
    expect(parseStoredPosition(JSON.stringify({ lotm1: 1.5, coi: null, updatedAt: "x" }))).toBe(null);
    expect(parseStoredPosition(null)).toBe(null);
    expect(parseStoredPosition("null")).toBe(null);
  });
});

describe("serializeStoredPosition", () => {
  it("round-trips through parseStoredPosition", () => {
    const p = { lotm1: 245, coi: 12 };
    const raw = serializeStoredPosition(p);
    expect(JSON.parse(raw).lotm1).toBe(245);
    expect(parseStoredPosition(raw)).toMatchObject({ lotm1: 245, coi: 12 });
    expect(typeof JSON.parse(raw).updatedAt).toBe("string");
  });

  it("round-trips the both-null state", () => {
    const raw = serializeStoredPosition({ lotm1: null, coi: null });
    expect(parseStoredPosition(raw)).toMatchObject({ lotm1: null, coi: null });
  });
});

describe("POSITION_STORAGE_KEY", () => {
  it("matches the ticket-pinned localStorage key", () => {
    expect(POSITION_STORAGE_KEY).toBe("arrodes.position");
  });
});
