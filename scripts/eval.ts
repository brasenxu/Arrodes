/**
 * Eval runner — replays the JSONL eval set against the live retrieval stack
 * and scores recall@k on expected_chapters plus spoiler-leak violations.
 *
 * Skeleton only — fill in once retrieval lands.
 *
 * Run: pnpm eval
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { evalEntrySchema } from "@/lib/eval/types";

const path = "data/eval/eval-set.jsonl";

async function main() {
  const entries = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => evalEntrySchema.parse(JSON.parse(l)));

  console.log(`Loaded ${entries.length} eval entries`);

  // TODO:
  // 1. For each entry, embed the question, run hybridSearch bounded by
  //    entry.reading_position (default: both books fully read).
  // 2. recall@8 = |retrieved_chapters ∩ expected_chapters| / |expected_chapters|
  // 3. Spoiler-leak: any retrieved chunk with chapter_num > reading_position.<book>
  //    is a hard fail for that entry.
  // 4. Optional: call chat route, LLM-judge the answer against reference_answer.
  // 5. Write full run to eval_runs table with {config, results, summary}.

  console.log("Not implemented yet. See TODO above.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
