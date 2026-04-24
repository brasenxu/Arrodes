#!/usr/bin/env -S tsx
/**
 * One-shot scraper: fetches the LOTM wiki Pathway chart templates and
 * regenerates data/lore/pathways.json. Run manually when canon updates.
 *
 * The `Pathway` / `Pathways` wiki page only transcludes two data templates
 * (`Template:Chart of All Standard Sequences` + `Template:Chart of All Non
 * Standard Sequences`), so we fetch the templates directly and concatenate.
 * The golden fixture at data/lore/__fixtures__/pathways-wikitext.txt mirrors
 * that concatenation, joined by a `===Chart of Non-Standard Sequences===`
 * marker the parser splits on.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MediaWikiClient } from "../tools/wiki-mcp/src/lib/mediawiki";

type Category = "standard" | "outer-deity" | "non-standard";

export interface PathwayData {
  pathway: string;
  category: Category;
  true_god: string;
  great_old_one: string;
  sequences: { tier: number; title: string }[];
}

// Group-code overrides. The parser derives pathway identity (pathway name,
// true god, great old one) directly from the row contents, so this map is
// only needed for groups where the chart cells disagree with the canonical
// identity we want to publish. Currently empty — kept as a seam for future
// canon corrections without editing the parser.
export const GROUP_TO_PATHWAY_OVERRIDES: Record<
  string,
  { pathway?: string; true_god?: string; great_old_one?: string }
> = {};

// Which group codes belong to the "outer-deity" bucket. Per LOTM canon the
// 22 Standard Pathways include these six (they originated from the three
// Outer Deities), so we emit each of these rows twice: once as
// category="standard" (membership in the 22) and once as
// category="outer-deity" (outer-deity-origin marker). The test suite asserts
// both counts independently.
const OUTER_DEITY_GROUPS = new Set(["goo", "fod", "ta"]);

interface RawRow {
  groupCode: string;
  hasRowspan: boolean;
  cells: string[]; // raw cell wikitext fragments
}

/**
 * Extract `{{SequenceChart/mid|group=X[|rowspan=N]| cell | cell | ... }}`
 * invocations. We match by scanning for the `{{SequenceChart/mid` token and
 * then balancing `{{`/`}}` so we correctly include nested templates like
 * `{{Language|{{Seq|...}}|...}}`.
 */
function extractRawRows(block: string): RawRow[] {
  const rows: RawRow[] = [];
  const opener = "{{SequenceChart/mid";
  let idx = 0;
  while (true) {
    const start = block.indexOf(opener, idx);
    if (start < 0) break;
    // Walk forward matching braces.
    let depth = 0;
    let i = start;
    let end = -1;
    while (i < block.length) {
      if (block.startsWith("{{", i)) {
        depth++;
        i += 2;
        continue;
      }
      if (block.startsWith("}}", i)) {
        depth--;
        i += 2;
        if (depth === 0) {
          end = i;
          break;
        }
        continue;
      }
      i++;
    }
    if (end < 0) break; // unbalanced — bail out
    const full = block.slice(start + opener.length, end - 2); // strip `{{SequenceChart/mid` and trailing `}}`
    // Split on top-level pipes (ignore pipes inside nested `{{...}}`).
    const parts = splitTopLevelPipes(full);
    // parts[0] is empty (leading `|` after the template name). Drop empties.
    const nonEmpty = parts.map((p) => p.trim()).filter((p) => p.length > 0);
    const groupPart = nonEmpty.find((p) => p.startsWith("group="));
    if (!groupPart) {
      idx = end;
      continue;
    }
    const groupCode = groupPart.slice("group=".length).trim();
    const hasRowspan = nonEmpty.some((p) => /^rowspan\s*=/i.test(p));
    const cells = nonEmpty.filter(
      (p) => !p.startsWith("group=") && !/^rowspan\s*=/i.test(p),
    );
    rows.push({ groupCode, hasRowspan, cells });
    idx = end;
  }
  return rows;
}

/**
 * Split a wikitext template body on top-level `|` separators, respecting
 * `{{...}}` nesting so we don't chop `{{Language|...|...}}` mid-template.
 */
function splitTopLevelPipes(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith("{{", i)) {
      depth++;
      current += "{{";
      i++;
      continue;
    }
    if (body.startsWith("}}", i)) {
      depth--;
      current += "}}";
      i++;
      continue;
    }
    const ch = body[i];
    if (ch === "|" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Pull the Sequence title from a cell. Cells wrap the name in `{{Seq|Name}}`
 * (optionally inside `{{Language|{{Seq|Name}}|...}}`).
 */
function extractSeqTitle(cell: string): string {
  const m = cell.match(/\{\{Seq\|([^}|]+)/);
  return m ? m[1].trim() : "";
}

export function parsePathwaysWikitext(wikitext: string): PathwayData[] {
  const nonStandardMarker = /=+\s*Chart of Non-?Standard Sequences\s*=+/i;
  const split = wikitext.split(nonStandardMarker);
  const standardBlock = split[0] ?? "";
  const nonStandardBlock = split[1] ?? "";

  const out: PathwayData[] = [];

  // --- Standard chart ---
  // Track each group's Great Old One across sibling rows (only the first row
  // of a rowspan group carries it, as the 11th cell).
  const groupGreatOldOne: Record<string, string> = {};
  const standardRows = extractRawRows(standardBlock);
  for (const row of standardRows) {
    const { groupCode, cells } = row;
    // 10-cell row: Seq9..Seq0. 11-cell row: Seq9..Seq0 + Great Old One.
    if (cells.length !== 10 && cells.length !== 11) {
      console.warn(
        `[refresh-lore] Unexpected cell count ${cells.length} for group=${groupCode} (standard)`,
      );
      continue;
    }
    const seqCells = cells.slice(0, 10);
    const tiers = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const sequences = seqCells.map((cell, i) => ({
      tier: tiers[i],
      title: extractSeqTitle(cell),
    }));
    const trueGod = sequences[9].title;
    let greatOldOne = "";
    if (cells.length === 11) {
      greatOldOne = extractSeqTitle(cells[10]);
      groupGreatOldOne[groupCode] = greatOldOne;
    } else {
      greatOldOne = groupGreatOldOne[groupCode] ?? "";
      if (!greatOldOne) {
        console.warn(
          `[refresh-lore] No Great Old One resolved for group=${groupCode} (standard); first row of group must have 11 cells`,
        );
      }
    }
    const override = GROUP_TO_PATHWAY_OVERRIDES[groupCode] ?? {};
    const entry: PathwayData = {
      pathway: override.pathway ?? trueGod,
      category: "standard",
      true_god: override.true_god ?? trueGod,
      great_old_one: override.great_old_one ?? greatOldOne,
      sequences,
    };
    out.push(entry);
    // Per canon, the 22 Standard Pathways include 6 outer-deity-origin ones.
    // Emit those rows a second time under category="outer-deity" so the
    // category filter carves out the origin-marker set cleanly.
    if (OUTER_DEITY_GROUPS.has(groupCode)) {
      out.push({ ...entry, category: "outer-deity" });
    }
  }

  // --- Non-standard chart ---
  const nonStandardRows = extractRawRows(nonStandardBlock);
  for (const row of nonStandardRows) {
    const { groupCode, cells } = row;
    if (cells.length !== 10 && cells.length !== 11) {
      console.warn(
        `[refresh-lore] Unexpected cell count ${cells.length} for group=${groupCode} (non-standard)`,
      );
      continue;
    }
    const seqCells = cells.slice(0, 10);
    const tiers = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const sequences = seqCells.map((cell, i) => ({
      tier: tiers[i],
      title: extractSeqTitle(cell),
    }));
    const trueGod = sequences[9].title;
    const greatOldOne =
      cells.length === 11 ? extractSeqTitle(cells[10]) : trueGod;
    const override = GROUP_TO_PATHWAY_OVERRIDES[groupCode] ?? {};
    out.push({
      pathway: override.pathway ?? trueGod,
      category: "non-standard",
      true_god: override.true_god ?? trueGod,
      great_old_one: override.great_old_one ?? greatOldOne,
      sequences,
    });
  }

  return out;
}

async function main() {
  const client = new MediaWikiClient();
  // The Pathways page just transcludes these two templates — fetch them
  // directly so we always get fresh data even if the wrapper page changes.
  const [standardRes, nonStandardRes] = await Promise.all([
    client.get<{ parse?: { wikitext?: string } }>({
      action: "parse",
      page: "Template:Chart of All Standard Sequences",
      prop: "wikitext",
    }),
    client.get<{ parse?: { wikitext?: string } }>({
      action: "parse",
      page: "Template:Chart of All Non Standard Sequences",
      prop: "wikitext",
    }),
  ]);
  const standard = standardRes.parse?.wikitext;
  const nonStandard = nonStandardRes.parse?.wikitext;
  if (!standard) throw new Error("No wikitext for Template:Chart of All Standard Sequences");
  if (!nonStandard) throw new Error("No wikitext for Template:Chart of All Non Standard Sequences");

  const wikitext = `${standard}\n\n===Chart of Non-Standard Sequences===\n\n${nonStandard}`;
  const pathways = parsePathwaysWikitext(wikitext);
  console.log(`Parsed ${pathways.length} pathways:`);
  console.log(`  standard: ${pathways.filter((p) => p.category === "standard").length}`);
  console.log(`  outer-deity: ${pathways.filter((p) => p.category === "outer-deity").length}`);
  console.log(`  non-standard: ${pathways.filter((p) => p.category === "non-standard").length}`);

  const outPath = resolve(process.cwd(), "data/lore/pathways.json");
  writeFileSync(outPath, JSON.stringify(pathways, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
