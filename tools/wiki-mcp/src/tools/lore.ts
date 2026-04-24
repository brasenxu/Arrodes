import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { LorePathwayInputT, LorePathwaysListInputT } from "../schemas";

export interface PathwayData {
  pathway: string;
  category: "standard" | "outer-deity" | "non-standard";
  true_god: string;
  great_old_one: string;
  sequences: { tier: number; title: string }[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// tools/wiki-mcp/src/tools/lore.ts → repo root is four levels up
const PATHWAYS_PATH = resolve(__dirname, "../../../../data/lore/pathways.json");

let cached: PathwayData[] | null = null;
function loadPathways(): PathwayData[] {
  if (cached) return cached;
  const raw = readFileSync(PATHWAYS_PATH, "utf8");
  cached = JSON.parse(raw) as PathwayData[];
  return cached;
}

export function __resetCache() {
  cached = null;
}

export function lorePathway(input: LorePathwayInputT): PathwayData | null {
  const q = input.name.toLowerCase().trim();
  const pathways = loadPathways();
  for (const p of pathways) {
    if (p.pathway.toLowerCase() === q) return p;
    if (p.true_god.toLowerCase() === q) return p;
    if (p.great_old_one.toLowerCase() === q) return p;
    for (const s of p.sequences) {
      if (s.title.toLowerCase() === q) return p;
    }
  }
  return null;
}

export function lorePathwaysList(
  input: LorePathwaysListInputT,
): { pathway: string; category: PathwayData["category"] }[] {
  const pathways = loadPathways();
  const filtered = input.category
    ? pathways.filter((p) => p.category === input.category)
    : pathways;
  return filtered.map((p) => ({ pathway: p.pathway, category: p.category }));
}
