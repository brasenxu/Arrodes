import { describe, it, expect } from "vitest";
import { lorePathway, lorePathwaysList } from "../src/tools/lore";

describe("lorePathway", () => {
  it("returns pathway by canonical name (case-insensitive)", () => {
    const r = lorePathway({ name: "fool" });
    expect(r).not.toBeNull();
    expect(r!.pathway).toBe("Fool");
    expect(r!.great_old_one).toBe("Lord of Mysteries");
    expect(r!.sequences).toHaveLength(10);
    expect(r!.sequences[0]).toEqual({ tier: 9, title: "Seer" });
  });

  it("resolves by sequence title (case-insensitive): Seer → Fool", () => {
    const r = lorePathway({ name: "Seer" });
    expect(r!.pathway).toBe("Fool");
  });

  it("resolves by great_old_one title: 'Lord of Mysteries' → Fool", () => {
    const r = lorePathway({ name: "lord of mysteries" });
    expect(r!.pathway).toBe("Fool");
  });

  it("resolves by true_god title: 'Tyrant' → Tyrant", () => {
    const r = lorePathway({ name: "Tyrant" });
    expect(r!.pathway).toBe("Tyrant");
  });

  it("returns null for unknown input", () => {
    expect(lorePathway({ name: "NonexistentPathway" })).toBeNull();
  });
});

describe("lorePathwaysList", () => {
  it("lists all pathways when no category filter", () => {
    const r = lorePathwaysList({});
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.map((p) => p.pathway)).toContain("Fool");
  });

  it("filters by category", () => {
    const r = lorePathwaysList({ category: "standard" });
    expect(r.every((p) => p.category === "standard")).toBe(true);
  });

  it("returns only pathway + category fields (no sequence ladder)", () => {
    const r = lorePathwaysList({});
    const first = r[0];
    expect(Object.keys(first).sort()).toEqual(["category", "pathway"]);
  });
});
