import { describe, test, expect } from "vitest";
import { assignArc } from "./arc-map";

describe("assignArc — LOTM1 main story", () => {
  test.each([
    [1, 1, "Clown"],
    [213, 1, "Clown"],
    [214, 2, "Faceless"],
    [482, 2, "Faceless"],
    [483, 3, "Traveler"],
    [732, 3, "Traveler"],
    [733, 4, "Undying"],
    [946, 4, "Undying"],
    [947, 5, "Red Priest"],
    [1150, 5, "Red Priest"],
    [1151, 6, "Lightseeker"],
    [1266, 6, "Lightseeker"],
    [1267, 7, "The Hanged Man"],
    [1353, 7, "The Hanged Man"],
    [1354, 8, "Fool"],
    [1394, 8, "Fool"],
  ])("ch %i → vol %i %s", (ch, volume, volumeName) => {
    const result = assignArc("lotm1", ch);
    expect(result).toEqual({ volume, volumeName, contentKind: "main" });
  });

  test("total main chapters 1..1394 sums to 1394", () => {
    let count = 0;
    for (let n = 1; n <= 1394; n++) {
      if (assignArc("lotm1", n).contentKind === "main") count++;
    }
    expect(count).toBe(1394);
  });

  test("arc chapter counts per the DAB arc table", () => {
    const counts: Record<string, number> = {};
    for (let n = 1; n <= 1394; n++) {
      const { volumeName } = assignArc("lotm1", n);
      counts[volumeName] = (counts[volumeName] ?? 0) + 1;
    }
    expect(counts).toEqual({
      Clown: 213,
      Faceless: 269,
      Traveler: 250,
      Undying: 214,
      "Red Priest": 204,
      Lightseeker: 116,
      "The Hanged Man": 87,
      Fool: 41,
    });
  });
});

describe("assignArc — LOTM1 side stories", () => {
  test("1395–1402 → An Ordinary Person's Daily Life (side_story)", () => {
    for (const ch of [1395, 1399, 1402]) {
      expect(assignArc("lotm1", ch)).toEqual({
        volume: 0,
        volumeName: "An Ordinary Person's Daily Life",
        contentKind: "side_story",
      });
    }
  });

  test("1403–1430 → In Modern Day (side_story)", () => {
    for (const ch of [1403, 1417, 1430]) {
      expect(assignArc("lotm1", ch)).toEqual({
        volume: 0,
        volumeName: "In Modern Day",
        contentKind: "side_story",
      });
    }
  });

  test("1431–1432 → That Corner (side_story)", () => {
    for (const ch of [1431, 1432]) {
      expect(assignArc("lotm1", ch)).toEqual({
        volume: 0,
        volumeName: "That Corner",
        contentKind: "side_story",
      });
    }
  });

  test("content_kind distribution for ch 1..1432 matches acceptance criteria", () => {
    const kinds: Record<string, number> = { main: 0, side_story: 0, bonus: 0 };
    for (let n = 1; n <= 1432; n++) {
      kinds[assignArc("lotm1", n).contentKind]++;
    }
    expect(kinds).toEqual({ main: 1394, side_story: 38, bonus: 0 });
  });
});

describe("assignArc — COI known arcs", () => {
  test.each([
    [1, "Nightmare", "main"],
    [109, "Nightmare", "main"],
    [110, "Lightseeker", "main"],
    [263, "Lightseeker", "main"],
    [885, "Dream Weaver", "main"],
    [1034, "Dream Weaver", "main"],
  ])("ch %i → %s (%s)", (ch, volumeName, contentKind) => {
    const r = assignArc("coi", ch);
    expect(r.volumeName).toBe(volumeName);
    expect(r.contentKind).toBe(contentKind);
    expect(r.volume).toBe(0);
  });
});

describe("assignArc — COI unmapped main chapters", () => {
  test.each([264, 500, 884, 1035, 1100, 1179])("ch %i → unmapped main", (ch) => {
    expect(assignArc("coi", ch)).toEqual({
      volume: 0,
      volumeName: "unmapped",
      contentKind: "main",
    });
  });
});

describe("assignArc — COI tail", () => {
  test("1180 → Author's Afterword (bonus)", () => {
    expect(assignArc("coi", 1180)).toEqual({
      volume: 0,
      volumeName: "Author's Afterword",
      contentKind: "bonus",
    });
  });

  test("1181 → Daily Life in Cordu (side_story)", () => {
    expect(assignArc("coi", 1181)).toEqual({
      volume: 0,
      volumeName: "Daily Life in Cordu",
      contentKind: "side_story",
    });
  });

  test("content_kind distribution for ch 1..1181 matches acceptance criteria", () => {
    const kinds: Record<string, number> = { main: 0, side_story: 0, bonus: 0 };
    for (let n = 1; n <= 1181; n++) {
      kinds[assignArc("coi", n).contentKind]++;
    }
    expect(kinds).toEqual({ main: 1179, side_story: 1, bonus: 1 });
  });
});

describe("assignArc — input validation", () => {
  test("chapter 0 or negative throws", () => {
    expect(() => assignArc("lotm1", 0)).toThrow();
    expect(() => assignArc("coi", -1)).toThrow();
  });

  test("chapter beyond known range throws", () => {
    expect(() => assignArc("lotm1", 1433)).toThrow();
    expect(() => assignArc("coi", 1182)).toThrow();
  });
});
