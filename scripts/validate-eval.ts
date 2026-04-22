/**
 * Validates data/eval/eval-set.jsonl against the Zod schema and flags:
 *   - duplicate IDs
 *   - missing expected_chapters on non-lore queries
 *   - aggregation queries with no expected_entities
 *   - status='draft' entry counts
 *
 * Run: pnpm eval:validate
 */
import { readFileSync } from "fs";
import { evalEntrySchema, type EvalEntry } from "@/lib/eval/types";

const path = "data/eval/eval-set.jsonl";
const lines = readFileSync(path, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("//"));

const entries: EvalEntry[] = [];
const errors: string[] = [];
const seenIds = new Set<string>();

for (const [i, line] of lines.entries()) {
  try {
    const parsed = evalEntrySchema.parse(JSON.parse(line));
    if (seenIds.has(parsed.id)) errors.push(`Line ${i + 1}: duplicate id ${parsed.id}`);
    seenIds.add(parsed.id);
    entries.push(parsed);
  } catch (e) {
    errors.push(`Line ${i + 1}: ${(e as Error).message}`);
  }
}

// Soft warnings
const warnings: string[] = [];
for (const e of entries) {
  if (
    e.query_type !== "lore" &&
    e.query_type !== "aggregation" &&
    e.expected_chapters.length === 0
  ) {
    warnings.push(`${e.id}: ${e.query_type} has no expected_chapters`);
  }
  if (e.query_type === "aggregation" && e.expected_entities.length === 0) {
    warnings.push(`${e.id}: aggregation query has no expected_entities`);
  }
}

const byType = entries.reduce<Record<string, number>>((acc, e) => {
  acc[e.query_type] = (acc[e.query_type] ?? 0) + 1;
  return acc;
}, {});
const byStatus = entries.reduce<Record<string, number>>((acc, e) => {
  acc[e.status] = (acc[e.status] ?? 0) + 1;
  return acc;
}, {});

console.log(`Parsed ${entries.length} entries from ${path}`);
console.log("By type:", byType);
console.log("By status:", byStatus);

if (warnings.length) {
  console.log("\nWarnings:");
  warnings.forEach((w) => console.log("  -", w));
}

if (errors.length) {
  console.error("\nErrors:");
  errors.forEach((e) => console.error("  -", e));
  process.exit(1);
}
