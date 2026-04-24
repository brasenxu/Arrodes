import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePathwaysWikitext } from "../../../scripts/refresh-lore";

const FIXTURE_PATH = resolve(__dirname, "../../../data/lore/__fixtures__/pathways-wikitext.txt");
const WIKITEXT = readFileSync(FIXTURE_PATH, "utf8");

describe("parsePathwaysWikitext", () => {
  const parsed = parsePathwaysWikitext(WIKITEXT);

  it("extracts at least 22 standard pathways", () => {
    expect(parsed.filter((p) => p.category === "standard").length).toBeGreaterThanOrEqual(22);
  });

  it("extracts at least 6 outer-deity pathways", () => {
    expect(parsed.filter((p) => p.category === "outer-deity").length).toBeGreaterThanOrEqual(6);
  });

  it("extracts at least 10 non-standard pathways (lower bound per screenshot scan)", () => {
    expect(parsed.filter((p) => p.category === "non-standard").length).toBeGreaterThanOrEqual(10);
  });

  it("Fool pathway has the correct 10 sequence titles in tier 9→0 order", () => {
    const fool = parsed.find((p) => p.pathway === "Fool");
    expect(fool).toBeDefined();
    expect(fool!.sequences.map((s) => s.title)).toEqual([
      "Seer", "Clown", "Magician", "Faceless", "Marionettist",
      "Bizarro Sorcerer", "Scholar of Yore", "Miracle Invoker",
      "Attendant of Mysteries", "Fool",
    ]);
  });

  it("Fool pathway has Lord of Mysteries as its Great Old One", () => {
    const fool = parsed.find((p) => p.pathway === "Fool");
    expect(fool!.great_old_one).toBe("Lord of Mysteries");
  });
});
