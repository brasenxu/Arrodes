/**
 * Eval runner (ticket 014) — replays the JSONL eval set against the live
 * retrieval stack and scores recall@k on expected_chapters plus spoiler-leak
 * violations. Skips draft entries (they aren't trusted ground truth yet —
 * finish them with `pnpm tsx scripts/eval-helper.ts`).
 *
 * Writes the full run to the eval_runs table.
 *
 * Run: pnpm eval
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { readFileSync } from "fs";
import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";
import { evalEntrySchema } from "@/lib/eval/types";
import type { EvalEntry } from "@/lib/eval/types";
import { scoreEntry, type EntryScore, type RetrievedLite } from "@/lib/eval/score";
import { hybridSearch } from "@/lib/rag/retrieval";
import { extractChapterPin, stripProviderPrefix } from "@/lib/rag/schemas";
import { db, schema } from "@/lib/db/client";
import type { BookId, ReadingPosition } from "@/lib/rag/types";

const path = "data/eval/eval-set.jsonl";

// Same direct-provider wiring as the chat path (audit defect 6).
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embedModel = openai.embedding(
  stripProviderPrefix(process.env.INGEST_EMBED_MODEL ?? "text-embedding-3-small"),
);

const FULL_POSITION: ReadingPosition = { lotm1: 1432, coi: 1181 };

function positionFor(entry: EvalEntry): ReadingPosition {
  return entry.reading_position ?? FULL_POSITION;
}

async function main() {
  const entries = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => evalEntrySchema.parse(JSON.parse(l)));

  const verified = entries.filter((e) => e.status === "verified");
  const drafts = entries.filter((e) => e.status === "draft");
  console.log(
    `Loaded ${entries.length} eval entries — verified: ${verified.length}, draft (skipped): ${drafts.length}`,
  );
  if (drafts.length > 0) {
    console.log(`Draft ids: ${drafts.map((e) => e.id).join(", ")}`);
  }

  const results: Array<EntryScore & { question: string; queryType: string }> = [];
  for (const entry of verified) {
    const { embedding } = await embed({
      model: embedModel,
      value: entry.question,
    });
    const position = positionFor(entry);
    const books: BookId[] =
      entry.book === "both" ? ["lotm1", "coi"] : [entry.book];
    const chunks = await hybridSearch({
      queryEmbedding: embedding,
      queryText: entry.question,
      books,
      position,
      limit: 8,
      // Same chapter pin the chat path's searchBook applies (014 fix).
      chapterNum: extractChapterPin(entry.question) ?? undefined,
    });
    const retrieved: RetrievedLite[] = chunks.map((c) => ({
      bookId: c.bookId,
      chapterNum: c.chapterNum,
    }));
    const score = scoreEntry(entry, retrieved);
    results.push({ ...score, question: entry.question, queryType: entry.query_type });
    const viol = score.spoilerViolations.length > 0 ? "  ⚠ SPOILER LEAK" : "";
    console.log(
      `${entry.id} ${entry.query_type.padEnd(16)} recall@8=${score.recall === null ? "n/a" : score.recall.toFixed(2)}${viol}`,
    );
  }

  // Aggregate by query type.
  const byType: Record<string, { count: number; recallSum: number; scored: number }> = {};
  for (const r of results) {
    byType[r.queryType] ??= { count: 0, recallSum: 0, scored: 0 };
    byType[r.queryType].count++;
    if (r.recall !== null) {
      byType[r.queryType].recallSum += r.recall;
      byType[r.queryType].scored++;
    }
  }
  const summary: Record<string, unknown> = {
    total: results.length,
    spoilerLeaks: results.filter((r) => r.spoilerViolations.length > 0).length,
    byType: Object.fromEntries(
      Object.entries(byType).map(([type, v]) => [
        type,
        {
          entries: v.count,
          recallAt8: v.scored > 0 ? Number((v.recallSum / v.scored).toFixed(3)) : null,
        },
      ]),
    ),
  };

  console.log("\n=== Baseline summary ===");
  console.log(JSON.stringify(summary, null, 2));

  const config = {
    models: {
      chat: process.env.CHAT_MODEL ?? "(not used — retrieval-only eval)",
      embed: process.env.INGEST_EMBED_MODEL ?? "text-embedding-3-small",
    },
    k: 8,
    verifiedEntries: verified.length,
    draftEntries: drafts.length,
  };
  await db.insert(schema.evalRuns).values({ config, results, summary });
  console.log("Wrote run to eval_runs");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
