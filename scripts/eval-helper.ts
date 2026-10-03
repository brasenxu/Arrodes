/**
 * Interactive eval-set verifier (ticket 014). For each draft entry:
 *   - runs the question through hybridSearch (retrieval only, no LLM),
 *   - prints the top-8 chunks' chapters/titles,
 *   - prompts: `Add chapter to expected? [n]` — type comma-separated chapter
 *     numbers to append, `all` to accept the retrieved chapters, `skip` to
 *     leave the entry untouched, `done` to stop the sweep,
 *   - when chapters are added: flips status to "verified" and writes the
 *     JSONL back in place.
 *
 * Usage: pnpm tsx scripts/eval-helper.ts [Q029 Q031 ...]
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { createInterface } from "node:readline/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";
import { evalEntrySchema } from "@/lib/eval/types";
import type { EvalEntry } from "@/lib/eval/types";
import { hybridSearch } from "@/lib/rag/retrieval";
import { extractChapterPin, stripProviderPrefix } from "@/lib/rag/schemas";
import type { BookId, ReadingPosition } from "@/lib/rag/types";

const PATH = "data/eval/eval-set.jsonl";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embedModel = openai.embedding(
  stripProviderPrefix(process.env.INGEST_EMBED_MODEL ?? "text-embedding-3-small"),
);
const FULL_POSITION: ReadingPosition = { lotm1: 1432, coi: 1181 };

function loadEntries(): EvalEntry[] {
  return readFileSync(PATH, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => evalEntrySchema.parse(JSON.parse(l)));
}

function saveEntries(entries: EvalEntry[]): void {
  const header = readFileSync(PATH, "utf8")
    .split("\n")
    .filter((l) => l.startsWith("//"))
    .join("\n");
  const body = entries
    .map((e) => JSON.stringify(e))
    .join("\n");
  writeFileSync(PATH, `${header}\n${body}\n`);
}

async function main() {
  const entries = loadEntries();
  const filterIds = process.argv.slice(2);
  const drafts = entries.filter(
    (e) => e.status === "draft" && (filterIds.length === 0 || filterIds.includes(e.id)),
  );

  if (drafts.length === 0) {
    console.log("No matching draft entries — nothing to verify.");
    process.exit(0);
  }
  console.log(`${drafts.length} draft entries to verify (of ${entries.length} total).\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const verifiedOn = new Date().toISOString().slice(0, 10);
  let changed = 0;

  for (const entry of drafts) {
    console.log(`--- ${entry.id} [${entry.query_type}] ${entry.question}`);
    if (entry.notes) console.log(`    notes: ${entry.notes}`);

    const { embedding } = await embed({ model: embedModel, value: entry.question });
    const position = entry.reading_position ?? FULL_POSITION;
    const books: BookId[] = entry.book === "both" ? ["lotm1", "coi"] : [entry.book];
    const chunks = await hybridSearch({
      queryEmbedding: embedding,
      queryText: entry.question,
      books,
      position,
      limit: 8,
      chapterNum: extractChapterPin(entry.question) ?? undefined,
    });

    for (const c of chunks) {
      console.log(`  ${c.bookId} ch.${c.chapterNum} (score ${c.score.toFixed(4)}) — ${c.chapterTitle}`);
    }

    const answer = await rl.question(
      "Add chapter to expected? [n,n / all / skip / done]: ",
    );
    const trimmed = answer.trim();

    if (trimmed.toLowerCase() === "done") break;
    if (trimmed.toLowerCase() === "skip") continue;

    let additions: number[] = [];
    if (trimmed.toLowerCase() === "all") {
      additions = [...new Set(chunks.map((c) => c.chapterNum))];
    } else if (/^\d+(\s*,\s*\d+)*$/.test(trimmed)) {
      additions = trimmed.split(",").map((s) => Number(s.trim()));
    } else {
      console.log("    unrecognized input — skipping entry");
      continue;
    }

    entry.expected_chapters = [
      ...new Set([...entry.expected_chapters, ...additions]),
    ];
    entry.status = "verified";
    entry.notes = `${entry.notes ? `${entry.notes} | ` : ""}Verified ${verifiedOn} via eval-helper (human chapter pass).`;
    changed++;
    console.log(`    → ${entry.id} verified with expected ${JSON.stringify(entry.expected_chapters)}\n`);
  }

  if (changed > 0) saveEntries(entries);
  rl.close();
  console.log(`Done — ${changed} entries updated in place.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
