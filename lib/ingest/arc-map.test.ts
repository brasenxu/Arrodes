import { describe, test, expect } from "vitest";
import { assignArc } from "./arc-map";

describe("assignArc — LOTM1 main-story per-arc sample", () => {
  test.each([
    // Volume 1: Clown
    [1, 1, "Clown", 1, "Transmigration & Nighthawks"],
    [57, 1, "Clown", 1, "Transmigration & Nighthawks"],
    [58, 1, "Clown", 2, "Antigonus Family's Notebook"],
    [106, 1, "Clown", 2, "Antigonus Family's Notebook"],
    [107, 1, "Clown", 3, "Mysticism Studies"],
    [171, 1, "Clown", 3, "Mysticism Studies"],
    [172, 1, "Clown", 4, "Qilangos Incident"],
    [202, 1, "Clown", 4, "Qilangos Incident"],
    [203, 1, "Clown", 5, "Tingen City Doomsday"],
    [213, 1, "Clown", 5, "Tingen City Doomsday"],
    // Volume 2: Faceless
    [214, 2, "Faceless", 1, "Backlund Detective Debut"],
    [294, 2, "Faceless", 2, "Death of Lanevus"],
    [322, 2, "Faceless", 3, "Black Emperor Heist"],
    [430, 2, "Faceless", 4, "The Hero Black Bandit"],
    [482, 2, "Faceless", 5, "Great Smog of Backlund"],
    // Volume 3: Traveler
    [483, 3, "Traveler", 1, "Sea God Kalvetua"],
    [732, 3, "Traveler", 5, "Chaos on Bayam Mountain"],
    // Volume 4: Undying
    [777, 4, "Undying", 2, "Primitive Island Expedition"],
    [946, 4, "Undying", 5, "Death of Ince Zangwill"],
    // Volume 5: Red Priest
    [1099, 5, "Red Priest", 3, "Feysac War Outbreak"],
    [1150, 5, "Red Priest", 5, "George III's Apotheosis Ritual"],
    // Volume 6: Lightseeker
    [1151, 6, "Lightseeker", 1, "Amon's Pursuit"],
    [1217, 6, "Lightseeker", 2, "Hunting Botis"],
    [1266, 6, "Lightseeker", 3, "Giant King's Court"],
    // Volume 7: The Hanged Man
    [1299, 7, "The Hanged Man", 2, "Belltaine City"],
    [1353, 7, "The Hanged Man", 3, "Utopia and the Corpse Cathedral"],
    // Volume 8: Fool
    [1373, 8, "Fool", 1, "Destroying Eden"],
    [1387, 8, "Fool", 2, "Klein's Apotheosis Ritual"],
    [1394, 8, "Fool", 3, "Klein's Eternal Sleep"],
  ])("ch %i → vol %i %s / arc %i %s", (ch, volume, volumeName, arc, arcName) => {
    expect(assignArc("lotm1", ch)).toEqual({
      volume,
      volumeName,
      arc,
      arcName,
      contentKind: "main",
    });
  });
});

describe("assignArc — LOTM1 side stories", () => {
  test("1395–1402 → An Ordinary Person's Daily Life (side_story)", () => {
    for (const ch of [1395, 1399, 1402]) {
      expect(assignArc("lotm1", ch)).toEqual({
        volume: 0,
        volumeName: "An Ordinary Person's Daily Life",
        arc: 1,
        arcName: "An Ordinary Person's Daily Life",
        contentKind: "side_story",
      });
    }
  });

  test("1403–1430 → In Modern Day (side_story)", () => {
    for (const ch of [1403, 1417, 1430]) {
      expect(assignArc("lotm1", ch)).toEqual({
        volume: 0,
        volumeName: "In Modern Day",
        arc: 2,
        arcName: "In Modern Day",
        contentKind: "side_story",
      });
    }
  });

  test("1431–1432 → That Corner (side_story)", () => {
    for (const ch of [1431, 1432]) {
      expect(assignArc("lotm1", ch)).toEqual({
        volume: 0,
        volumeName: "That Corner",
        arc: 3,
        arcName: "That Corner",
        contentKind: "side_story",
      });
    }
  });
});

describe("assignArc — LOTM1 contiguity + counts", () => {
  test("every chapter 1..1432 resolves to exactly one arc with valid tuple", () => {
    for (let n = 1; n <= 1432; n++) {
      const a = assignArc("lotm1", n);
      expect(Number.isInteger(a.volume) && a.volume >= 0).toBe(true);
      expect(a.volumeName.length).toBeGreaterThan(0);
      expect(Number.isInteger(a.arc) && a.arc >= 1).toBe(true);
      expect(a.arcName.length).toBeGreaterThan(0);
    }
  });

  test("content_kind distribution for ch 1..1432 matches scope (1394 main, 38 side, 0 bonus)", () => {
    const kinds: Record<string, number> = { main: 0, side_story: 0, bonus: 0 };
    for (let n = 1; n <= 1432; n++) {
      kinds[assignArc("lotm1", n).contentKind]++;
    }
    expect(kinds).toEqual({ main: 1394, side_story: 38, bonus: 0 });
  });

  test("distinct arc names = 37 (34 main + 3 side) across the whole book", () => {
    const names = new Set<string>();
    for (let n = 1; n <= 1432; n++) names.add(assignArc("lotm1", n).arcName);
    expect(names.size).toBe(37);
  });

  test("main-story volume chapter totals match DAB arc table", () => {
    const byVol: Record<string, number> = {};
    for (let n = 1; n <= 1394; n++) {
      const a = assignArc("lotm1", n);
      const key = `${a.volume}:${a.volumeName}`;
      byVol[key] = (byVol[key] ?? 0) + 1;
    }
    expect(byVol).toEqual({
      "1:Clown": 213,
      "2:Faceless": 269,
      "3:Traveler": 250,
      "4:Undying": 214,
      "5:Red Priest": 204,
      "6:Lightseeker": 116,
      "7:The Hanged Man": 87,
      "8:Fool": 41,
    });
  });

  test("per-arc chapter counts match the implementation table", () => {
    const counts: Record<string, number> = {};
    for (let n = 1; n <= 1432; n++) {
      const { arcName } = assignArc("lotm1", n);
      counts[arcName] = (counts[arcName] ?? 0) + 1;
    }
    expect(counts).toEqual({
      // Volume 1: Clown
      "Transmigration & Nighthawks": 57,
      "Antigonus Family's Notebook": 49,
      "Mysticism Studies": 65,
      "Qilangos Incident": 31,
      "Tingen City Doomsday": 11,
      // Volume 2: Faceless
      "Backlund Detective Debut": 40,
      "Death of Lanevus": 41,
      "Black Emperor Heist": 28,
      "The Hero Black Bandit": 108,
      "Great Smog of Backlund": 52,
      // Volume 3: Traveler
      "Sea God Kalvetua": 69,
      "Vice-Admiral Tracy Pursuit": 53,
      "Mother Tree's Trap": 29,
      "Sea of Ruins Voyage": 72,
      "Chaos on Bayam Mountain": 27,
      // Volume 4: Undying
      "Dwayne Dantès Identity": 44,
      "Primitive Island Expedition": 53,
      "Foggy Town": 19,
      "Southern Continent Arms Deal": 57,
      "Death of Ince Zangwill": 41,
      // Volume 5: Red Priest
      "Post-Demigod Reconnaissance": 40,
      "Hunting the Conspirators": 75,
      "Feysac War Outbreak": 38,
      "Scholar of Yore Advancement": 43,
      "George III's Apotheosis Ritual": 8,
      // Volume 6: Lightseeker
      "Amon's Pursuit": 30,
      "Hunting Botis": 37,
      "Giant King's Court": 49,
      // Volume 7: The Hanged Man
      "Miracle Invoker Advancement": 32,
      "Belltaine City": 22,
      "Utopia and the Corpse Cathedral": 33,
      // Volume 8: Fool
      "Destroying Eden": 20,
      "Klein's Apotheosis Ritual": 14,
      "Klein's Eternal Sleep": 7,
      // Side stories
      "An Ordinary Person's Daily Life": 8,
      "In Modern Day": 28,
      "That Corner": 2,
    });
  });
});

describe("assignArc — COI main-story per-arc sample", () => {
  test.each([
    // Volume 1: Nightmare
    [1, 1, "Nightmare", 1, "The Warlock Legend"],
    [25, 1, "Nightmare", 1, "The Warlock Legend"],
    [26, 1, "Nightmare", 2, "The Lent Massacre"],
    [60, 1, "Nightmare", 2, "The Lent Massacre"],
    [61, 1, "Nightmare", 3, "Provoker Advancement"],
    [90, 1, "Nightmare", 3, "Provoker Advancement"],
    [91, 1, "Nightmare", 4, "Aurore's Sacrifice"],
    [109, 1, "Nightmare", 4, "Aurore's Sacrifice"],
    // Volume 2: Lightseeker
    [110, 2, "Lightseeker", 1, "Trier Integration"],
    [191, 2, "Lightseeker", 2, "The Double Agent's Burden"],
    [244, 2, "Lightseeker", 3, "Pyromaniac's Ascent"],
    [263, 2, "Lightseeker", 4, "Tree of Shadow"],
    // Volume 3: Conspirer
    [264, 3, "Conspirer", 1, "The Deeper Network"],
    [494, 3, "Conspirer", 4, "The Hostel"],
    // Volume 4: Sinner
    [533, 4, "Sinner", 2, "Sea Prayer Ritual"],
    [698, 4, "Sinner", 4, "Dream Festival"],
    [735, 4, "Sinner", 5, "The Overseer's Judgment"],
    // Volume 5: Demoness
    [776, 5, "Demoness", 1, "Journey to the Underworld"],
    [841, 5, "Demoness", 3, "Battle at Morora"],
    [884, 5, "Demoness", 4, "Mirror World Infiltration"],
    // Volume 6: Dream Weaver — includes the 131-chapter Fool's Dream arc
    [902, 6, "Dream Weaver", 2, "The Fool's Dream"],
    [1032, 6, "Dream Weaver", 2, "The Fool's Dream"],
    [1034, 6, "Dream Weaver", 3, "The Fool Awakens"],
    // Volume 7: Second Law
    [1083, 7, "Second Law", 2, "Hunting Hidden Sage"],
    [1115, 7, "Second Law", 4, "The Day of Many Disasters"],
    // Volume 8: Eternal Aeon
    [1141, 8, "Eternal Aeon", 1, "Death of Primordial Demoness"],
    [1177, 8, "Eternal Aeon", 3, "The Apocalypse"],
    [1179, 8, "Eternal Aeon", 4, "Final Tarot Club"],
  ])("ch %i → vol %i %s / arc %i %s", (ch, volume, volumeName, arc, arcName) => {
    expect(assignArc("coi", ch)).toEqual({
      volume,
      volumeName,
      arc,
      arcName,
      contentKind: "main",
    });
  });
});

describe("assignArc — COI bonus + side story tail", () => {
  test("1180 → Author's Afterword (bonus)", () => {
    expect(assignArc("coi", 1180)).toEqual({
      volume: 0,
      volumeName: "Author's Afterword",
      arc: 1,
      arcName: "Author's Afterword",
      contentKind: "bonus",
    });
  });

  test("1181 → Daily Life in Cordu (side_story)", () => {
    expect(assignArc("coi", 1181)).toEqual({
      volume: 0,
      volumeName: "Daily Life in Cordu",
      arc: 2,
      arcName: "Daily Life in Cordu",
      contentKind: "side_story",
    });
  });
});

describe("assignArc — COI contiguity + counts", () => {
  test("every chapter 1..1181 resolves to exactly one arc with valid tuple", () => {
    for (let n = 1; n <= 1181; n++) {
      const a = assignArc("coi", n);
      expect(Number.isInteger(a.volume) && a.volume >= 0).toBe(true);
      expect(a.volumeName.length).toBeGreaterThan(0);
      expect(Number.isInteger(a.arc) && a.arc >= 1).toBe(true);
      expect(a.arcName.length).toBeGreaterThan(0);
    }
  });

  test("content_kind distribution for ch 1..1181 matches scope (1179 main, 1 side, 1 bonus)", () => {
    const kinds: Record<string, number> = { main: 0, side_story: 0, bonus: 0 };
    for (let n = 1; n <= 1181; n++) {
      kinds[assignArc("coi", n).contentKind]++;
    }
    expect(kinds).toEqual({ main: 1179, side_story: 1, bonus: 1 });
  });

  test("distinct arc names = 34 (32 main + 1 bonus + 1 side) across the whole book", () => {
    const names = new Set<string>();
    for (let n = 1; n <= 1181; n++) names.add(assignArc("coi", n).arcName);
    expect(names.size).toBe(34);
  });

  test("no chapter maps to 'unmapped' (ticket 014 deferral resolved)", () => {
    for (let n = 1; n <= 1181; n++) {
      expect(assignArc("coi", n).arcName).not.toBe("unmapped");
      expect(assignArc("coi", n).volumeName).not.toBe("unmapped");
    }
  });

  test("The Fool's Dream spans 131 chapters (902–1032)", () => {
    let count = 0;
    for (let n = 1; n <= 1181; n++) {
      if (assignArc("coi", n).arcName === "The Fool's Dream") count++;
    }
    expect(count).toBe(131);
  });

  test("per-arc chapter counts match the implementation table", () => {
    const counts: Record<string, number> = {};
    for (let n = 1; n <= 1181; n++) {
      const { arcName } = assignArc("coi", n);
      counts[arcName] = (counts[arcName] ?? 0) + 1;
    }
    expect(counts).toEqual({
      // Volume 1: Nightmare
      "The Warlock Legend": 25,
      "The Lent Massacre": 35,
      "Provoker Advancement": 30,
      "Aurore's Sacrifice": 19,
      // Volume 2: Lightseeker
      "Trier Integration": 38,
      "The Double Agent's Burden": 44,
      "Pyromaniac's Ascent": 53,
      "Tree of Shadow": 19,
      // Volume 3: Conspirer
      "The Deeper Network": 59,
      "Samaritan Women's Spring": 62,
      "Outer God Incursions": 51,
      "The Hostel": 59,
      // Volume 4: Sinner
      "The Westward Hunt": 38,
      "Sea Prayer Ritual": 65,
      "The Demon's Descent": 52,
      "Dream Festival": 49,
      "The Overseer's Judgment": 37,
      // Volume 5: Demoness
      "Journey to the Underworld": 41,
      "Lumian's Exile": 16,
      "Battle at Morora": 49,
      "Mirror World Infiltration": 43,
      // Volume 6: Dream Weaver
      "Pre-Dream Preparations": 17,
      "The Fool's Dream": 131,
      "The Fool Awakens": 2,
      // Volume 7: Second Law
      "Sick Church Hunts": 28,
      "Hunting Hidden Sage": 21,
      "Weather Warlock Advancement": 18,
      "The Day of Many Disasters": 14,
      // Volume 8: Eternal Aeon
      "Death of Primordial Demoness": 26,
      "Pre-Apocalypse Consolidation": 7,
      "The Apocalypse": 29,
      "Final Tarot Club": 2,
      // Bonus + side
      "Author's Afterword": 1,
      "Daily Life in Cordu": 1,
    });
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
