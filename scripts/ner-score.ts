/**
 * NER scorer — runs the actual NER module against labeled gold chunks and
 * computes precision/recall/F1 for entity detection plus role accuracy.
 *
 * Critical: uses the SAME model, prompt, caching, and resolver shape as the
 * real ingest run (lib/ingest/ner.ts). This is what makes the eval trustworthy
 * — we're scoring the exact pipeline that will hit the corpus, not a reduced
 * approximation.
 *
 * Resolver runs in dryRun mode: novel names returned by Haiku are NOT
 * persisted. Names that can't resolve to a seeded canonical entity are still
 * scored — they match gold entries by normalized string. This exposes cases
 * where the seed catalog is missing coverage.
 *
 * Output:
 *   - Overall entity P/R/F1 (role-agnostic).
 *   - Per-role breakdown (speaker, addressee, mentioned, null).
 *   - Role accuracy (given correct entity detection).
 *   - Per-chunk failures: hallucinated, missed, role-mismatched.
 *
 * Run:
 *   pnpm ner:score                        # score all labeled entries
 *   pnpm ner:score --limit 10             # first 10 entries (for quick iteration)
 *   pnpm ner:score --verbose              # print predictions alongside gold
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readFileSync, existsSync } from "fs";
import { anthropic } from "@ai-sdk/anthropic";
import { inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  buildAliasIndex,
  buildCatalogBlock,
  EntityResolver,
  extractChapterMentions,
  loadEntities,
  type AliasIndex,
  type ChapterMeta,
  type ChunkInput,
} from "@/lib/ingest/ner";

const IN_PATH = "data/eval/ner-gold.jsonl";

type Role = "speaker" | "addressee" | "mentioned" | null;

type GoldMention = { name: string; role: Role };
type GoldEntry = {
  chunk_id: number;
  book_id: string;
  chapter_num: number;
  chapter_title: string;
  chunk_index: number;
  stratum: string;
  content: string;
  hint_entities: string[];
  gold_mentions: GoldMention[];
  notes: string;
};

function bareModelId(envValue: string): string {
  return envValue.includes("/") ? envValue.split("/").slice(-1)[0] : envValue;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const getFlag = (name: string): string | undefined => {
    const i = a.indexOf(name);
    return i === -1 ? undefined : a[i + 1];
  };
  const limit = getFlag("--limit");
  return {
    limit: limit ? Number(limit) : null,
    verbose: a.includes("--verbose"),
  };
}

function loadGold(): GoldEntry[] {
  if (!existsSync(IN_PATH)) {
    throw new Error(
      `${IN_PATH} not found. Run \`pnpm ner:sample\` first and label the gold_mentions.`,
    );
  }
  const text = readFileSync(IN_PATH, "utf8");
  const entries: GoldEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    entries.push(JSON.parse(trimmed) as GoldEntry);
  }
  return entries;
}

// Resolve a display name to a stable ID for matching. If the name is a known
// canonical_name or alias, return `entity:<id>`. Otherwise return `raw:<lower>`
// so gold and pred mentions with the same novel string still match.
function canonicalKey(name: string, aliasIndex: AliasIndex): string {
  const id = aliasIndex.nameLookup.get(name.trim().toLowerCase());
  if (id !== undefined) return `entity:${id}`;
  return `raw:${name.trim().toLowerCase()}`;
}

function displayName(key: string, aliasIndex: AliasIndex): string {
  if (key.startsWith("entity:")) {
    const id = Number(key.slice("entity:".length));
    return aliasIndex.byId.get(id)?.canonicalName ?? `entity#${id}`;
  }
  return key.slice("raw:".length);
}

type ScoreRecord = {
  chunkId: number;
  gold: Map<string, Role>; // key → role
  pred: Map<string, Role>; // key → role
  goldNames: Map<string, string>;
  predNames: Map<string, string>;
};

type RoleBucket = "speaker" | "addressee" | "mentioned" | "null";
const ROLE_BUCKETS: readonly RoleBucket[] = [
  "speaker",
  "addressee",
  "mentioned",
  "null",
] as const;

function roleBucket(role: Role): RoleBucket {
  return role ?? "null";
}

function summarizeByRole(
  records: ScoreRecord[],
): Record<RoleBucket, { tp: number; fp: number; fn: number }> {
  const out = {} as Record<RoleBucket, { tp: number; fp: number; fn: number }>;
  for (const r of ROLE_BUCKETS) {
    out[r] = { tp: 0, fp: 0, fn: 0 };
  }
  for (const rec of records) {
    for (const [key, goldRole] of rec.gold) {
      const predRole = rec.pred.get(key);
      const goldKey = roleBucket(goldRole);
      if (predRole === undefined) {
        out[goldKey].fn++;
      } else {
        const predKey = roleBucket(predRole);
        if (predKey === goldKey) {
          out[goldKey].tp++;
        } else {
          out[goldKey].fn++;
          out[predKey].fp++;
        }
      }
    }
    for (const [key, predRole] of rec.pred) {
      if (!rec.gold.has(key)) {
        out[roleBucket(predRole)].fp++;
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const { limit, verbose } = parseArgs();

  const contextModelEnv = process.env.INGEST_CONTEXT_MODEL;
  if (!contextModelEnv) {
    throw new Error("INGEST_CONTEXT_MODEL is not set in .env.local");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set in .env.local");
  }
  const contextModelId = bareModelId(contextModelEnv);
  const model = anthropic(contextModelId);

  const entities = await loadEntities();
  const aliasIndex = buildAliasIndex(entities);
  const catalogBlock = buildCatalogBlock(entities);
  const resolver = new EntityResolver(aliasIndex, { dryRun: true });

  const goldAll = loadGold();
  const goldEntries = limit != null ? goldAll.slice(0, limit) : goldAll;
  const labeled = goldEntries.filter((e) => e.gold_mentions.length > 0 || e.notes === "EMPTY_OK");
  const unlabeled = goldEntries.length - labeled.length;
  console.log(
    `[ner-score] loaded ${goldEntries.length} entries (${labeled.length} labeled, ${unlabeled} skipped as unlabeled)`,
  );
  if (unlabeled > 0) {
    console.log(
      `[ner-score]   note: unlabeled entries are skipped. Set notes to "EMPTY_OK" to score a chunk with truly zero entities.`,
    );
  }
  if (labeled.length === 0) {
    console.log("[ner-score] nothing to score. Label gold_mentions first.");
    return;
  }

  // Fetch chapter raw text for every chapter referenced by the labeled set.
  const chapterMeta = new Map<string, ChapterMeta>();
  const bookIds = Array.from(new Set(labeled.map((e) => e.book_id)));
  for (const bookId of bookIds) {
    const nums = labeled
      .filter((e) => e.book_id === bookId)
      .map((e) => e.chapter_num);
    const rows = await db
      .select({
        id: schema.chapters.id,
        bookId: schema.chapters.bookId,
        chapterNum: schema.chapters.chapterNum,
        chapterTitle: schema.chapters.chapterTitle,
        rawText: schema.chapters.rawText,
      })
      .from(schema.chapters)
      .where(
        sql`${schema.chapters.bookId} = ${bookId} AND ${schema.chapters.chapterNum} IN ${nums}`,
      );
    for (const r of rows) {
      chapterMeta.set(`${r.bookId}|${r.chapterNum}`, r);
    }
  }

  // Group labeled entries by chapter so each chapter's cache writes once.
  const groups = new Map<string, GoldEntry[]>();
  for (const e of labeled) {
    const key = `${e.book_id}|${e.chapter_num}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const records: ScoreRecord[] = [];

  for (const [chapterKey, entries] of groups) {
    const meta = chapterMeta.get(chapterKey);
    if (!meta) {
      throw new Error(`chapter metadata missing for ${chapterKey}`);
    }

    // Fetch actual chunk content from DB so we score against exactly what the
    // ingest pipeline will see, not the snapshot in the gold file (which could
    // drift if the corpus is re-chunked).
    const chunkIds = entries.map((e) => e.chunk_id);
    const chunkRows = await db
      .select({
        id: schema.chunks.id,
        chunkIndex: schema.chunks.chunkIndex,
        content: schema.chunks.content,
      })
      .from(schema.chunks)
      .where(inArray(schema.chunks.id, chunkIds));
    const chunkMap = new Map<number, ChunkInput>();
    for (const r of chunkRows) {
      chunkMap.set(r.id, {
        id: r.id,
        chunkIndex: r.chunkIndex,
        content: r.content,
      });
    }
    const chunks: ChunkInput[] = entries
      .map((e) => chunkMap.get(e.chunk_id))
      .filter((c): c is ChunkInput => !!c);

    const r = await extractChapterMentions({
      chapter: meta,
      chunks,
      aliasIndex,
      entityResolver: resolver,
      model,
      catalogBlock,
      dryRun: true,
      returnSamples: true,
    });
    if (!r.samples) continue;

    for (const sample of r.samples) {
      const entry = entries.find((e) => e.chunk_id === sample.chunkId)!;

      const predMap = new Map<string, Role>();
      const predNames = new Map<string, string>();
      for (const m of sample.mentions) {
        // sample.mentions uses display names. Sample mentions without the "(new)"
        // suffix resolve through the alias index; new ones come from the dry-run
        // pseudo-id pool — strip the suffix for scoring.
        const rawName = m.canonicalName.replace(/ \(new\)$/, "");
        const key = canonicalKey(rawName, aliasIndex);
        // First mention wins for role on the predicted side; the inner ranker
        // in extractChapterMentions already collapses duplicates.
        predMap.set(key, m.role);
        predNames.set(key, rawName);
      }

      const goldMap = new Map<string, Role>();
      const goldNames = new Map<string, string>();
      for (const g of entry.gold_mentions) {
        const key = canonicalKey(g.name, aliasIndex);
        goldMap.set(key, g.role);
        goldNames.set(key, g.name);
      }

      records.push({
        chunkId: entry.chunk_id,
        gold: goldMap,
        pred: predMap,
        goldNames,
        predNames,
      });

      if (verbose) {
        console.log(
          `\n[ner-score] chunk#${entry.chunk_id} ${entry.book_id} ch${entry.chapter_num} idx=${entry.chunk_index} stratum=${entry.stratum}`,
        );
        console.log(`  content: ${entry.content.slice(0, 120).replace(/\s+/g, " ")}…`);
        console.log(
          `  GOLD: ${entry.gold_mentions.map((g) => `${g.name}[${g.role ?? "null"}]`).join(", ") || "(empty)"}`,
        );
        console.log(
          `  PRED: ${sample.mentions.map((m) => `${m.canonicalName}[${m.role ?? "null"}]`).join(", ") || "(empty)"}`,
        );
      }
    }
  }

  // Aggregate metrics.
  let tpEntity = 0;
  let fpEntity = 0;
  let fnEntity = 0;
  let roleCorrect = 0;
  const failures: string[] = [];

  for (const rec of records) {
    const goldKeys = new Set(rec.gold.keys());
    const predKeys = new Set(rec.pred.keys());

    for (const k of predKeys) {
      if (goldKeys.has(k)) {
        tpEntity++;
        if (rec.gold.get(k) === rec.pred.get(k)) {
          roleCorrect++;
        } else {
          failures.push(
            `chunk#${rec.chunkId}  ROLE_MISMATCH  ${rec.predNames.get(k) ?? displayName(k, aliasIndex)}  gold=${rec.gold.get(k) ?? "null"}  pred=${rec.pred.get(k) ?? "null"}`,
          );
        }
      } else {
        fpEntity++;
        failures.push(
          `chunk#${rec.chunkId}  HALLUCINATED  ${rec.predNames.get(k) ?? displayName(k, aliasIndex)}[${rec.pred.get(k) ?? "null"}]`,
        );
      }
    }
    for (const k of goldKeys) {
      if (!predKeys.has(k)) {
        fnEntity++;
        failures.push(
          `chunk#${rec.chunkId}  MISSED  ${rec.goldNames.get(k) ?? displayName(k, aliasIndex)}[${rec.gold.get(k) ?? "null"}]`,
        );
      }
    }
  }

  const entityP = tpEntity / Math.max(tpEntity + fpEntity, 1);
  const entityR = tpEntity / Math.max(tpEntity + fnEntity, 1);
  const entityF1 =
    entityP + entityR > 0 ? (2 * entityP * entityR) / (entityP + entityR) : 0;
  const roleAccuracy = tpEntity > 0 ? roleCorrect / tpEntity : 0;

  const roleBreakdown = summarizeByRole(records);

  console.log("\n== Entity detection (role-agnostic) ==");
  console.log(
    `  precision:  ${entityP.toFixed(3)}  (${tpEntity}/${tpEntity + fpEntity})`,
  );
  console.log(
    `  recall:     ${entityR.toFixed(3)}  (${tpEntity}/${tpEntity + fnEntity})`,
  );
  console.log(`  F1:         ${entityF1.toFixed(3)}`);

  console.log("\n== Role accuracy (on correctly-detected entities) ==");
  console.log(
    `  overall:    ${roleAccuracy.toFixed(3)}  (${roleCorrect}/${tpEntity})`,
  );

  console.log("\n== Per-role breakdown (gold-bucketed) ==");
  for (const r of ["speaker", "addressee", "mentioned", "null"] as const) {
    const b = roleBreakdown[r];
    const p = b.tp / Math.max(b.tp + b.fp, 1);
    const rr = b.tp / Math.max(b.tp + b.fn, 1);
    const f1 = p + rr > 0 ? (2 * p * rr) / (p + rr) : 0;
    console.log(
      `  ${r.padEnd(10)} P=${p.toFixed(2)} R=${rr.toFixed(2)} F1=${f1.toFixed(2)}  (tp=${b.tp} fp=${b.fp} fn=${b.fn})`,
    );
  }

  if (failures.length > 0) {
    console.log(`\n== Per-chunk failures (${failures.length}) ==`);
    for (const f of failures) console.log(`  ${f}`);
  }

  console.log(
    `\n[ner-score] scored ${records.length} chunks across ${groups.size} chapters`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
