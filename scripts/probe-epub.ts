/**
 * EPUB sanity probe — inspects chapter boundaries produced by @gxl/epub-parser
 * for data/epub/LOTM.epub and data/epub/COI.epub, without writing anything.
 *
 * Ticket 002. Runs free (no Haiku spend), catches parser quirks before ingest.
 *
 * Run: pnpm probe
 */

import { existsSync } from "fs";
import { parseEpub } from "@gxl/epub-parser";

type BookTarget = {
  bookId: string;
  path: string;
  expectedChapters: number;
};

const TARGETS: BookTarget[] = [
  { bookId: "lotm1", path: "data/epub/LOTM.epub", expectedChapters: 1396 },
  { bookId: "coi", path: "data/epub/COI.epub", expectedChapters: 1180 },
];

// Matches: "Chapter 1", "Chapter 23 - Crimson", "第1章", "第 23 章"
const CHAPTER_HEADER_RE = /^\s*(Chapter\s+\d+|第\s*\d+\s*章)/i;
const TOLERANCE_PCT = 0.02;

// Pull the first plausible title from a section's HTML: prefer <h1>/<h2>/<h3>,
// else first non-empty text. Return empty string if nothing usable.
function extractSectionTitle(htmlString: string): string {
  const headingMatch = htmlString.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (headingMatch) return stripTags(headingMatch[1]).trim().slice(0, 160);
  const firstText = htmlString.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return firstText.slice(0, 160);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

async function probe(target: BookTarget): Promise<void> {
  console.log("\n" + "=".repeat(72));
  console.log(`Book: ${target.bookId}   Path: ${target.path}`);
  console.log("=".repeat(72));

  if (!existsSync(target.path)) {
    console.log(`  MISSING: ${target.path} — skipping`);
    return;
  }

  const epub = await parseEpub(target.path, { type: "path" });
  const sections = epub.sections ?? [];

  console.log(`  Title:     ${epub.info?.title ?? "(unknown)"}`);
  console.log(`  Author:    ${epub.info?.author ?? "(unknown)"}`);
  console.log(`  Publisher: ${epub.info?.publisher ?? "(unknown)"}`);
  console.log(`  sectionCount: ${sections.length}`);

  const titles = sections.map((s) => extractSectionTitle(s.htmlString));

  console.log(`  firstSectionTitle: ${titles[0] ?? "(empty)"}`);
  console.log(`  lastSectionTitle:  ${titles[titles.length - 1] ?? "(empty)"}`);

  const midIdx = Math.floor(sections.length / 2);
  const midSection = sections[midIdx];
  const midTitle = titles[midIdx] ?? "(empty)";
  const midPreview = stripTags(midSection?.htmlString ?? "").slice(0, 240);
  console.log(`  sampleMiddleSection (index ${midIdx}):`);
  console.log(`    title:   ${midTitle}`);
  console.log(`    words:   ${wordCount(stripTags(midSection?.htmlString ?? ""))}`);
  console.log(`    preview: ${midPreview}${midPreview.length >= 240 ? "…" : ""}`);

  // Chapter-header heuristic matches
  const headerHits = titles.filter((t) => CHAPTER_HEADER_RE.test(t));
  const hitCount = headerHits.length;
  const expected = target.expectedChapters;
  const diff = hitCount - expected;
  const pctDiff = Math.abs(diff) / expected;
  const withinTolerance = pctDiff <= TOLERANCE_PCT;

  console.log(`  chapter-header matches: ${hitCount}   expected: ${expected}   diff: ${diff > 0 ? "+" : ""}${diff} (${(pctDiff * 100).toFixed(2)}%)`);
  console.log(`  within ±${(TOLERANCE_PCT * 100).toFixed(0)}% tolerance: ${withinTolerance ? "YES" : "NO"}`);

  // Flag sections that don't match the chapter pattern — useful to spot
  // boilerplate/front-matter/afterword.
  const nonChapter = titles
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.length > 0 && !CHAPTER_HEADER_RE.test(t));

  console.log(`  non-chapter sections (first 10 of ${nonChapter.length}):`);
  for (const { t, i } of nonChapter.slice(0, 10)) {
    console.log(`    [${i.toString().padStart(4, " ")}] ${t.slice(0, 120)}`);
  }

  // Also dump the first 5 and last 5 section titles — typical place for
  // cover / copyright / translator notes / afterword to surface.
  console.log(`  first 5 section titles:`);
  for (let i = 0; i < Math.min(5, titles.length); i++) {
    console.log(`    [${i.toString().padStart(4, " ")}] ${titles[i].slice(0, 120)}`);
  }
  console.log(`  last 5 section titles:`);
  for (let i = Math.max(0, titles.length - 5); i < titles.length; i++) {
    console.log(`    [${i.toString().padStart(4, " ")}] ${titles[i].slice(0, 120)}`);
  }
}

async function main() {
  console.log("EPUB sanity probe — ticket 002");
  for (const target of TARGETS) {
    try {
      await probe(target);
    } catch (err) {
      console.error(`\nFAILED to probe ${target.bookId}:`, err);
    }
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
