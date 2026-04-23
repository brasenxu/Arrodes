/**
 * Stratified-random chunk sampler for NER eval labeling.
 *
 * Writes data/eval/ner-gold.jsonl with one entry per line, `gold_mentions: []`
 * left empty for manual labeling. `hint_entities` pre-populates canonical
 * names the alias scan already picked up so the labeler doesn't have to
 * remember exact canonical_name strings.
 *
 * Strata (defaults) — shape intentionally biased toward LOTM main story
 * because retrieval load will concentrate there:
 *   lotm1 chs   1–100   : 8  (Klein-arrival arc, Zhou Mingrui transitions)
 *   lotm1 chs 100–800   : 8  (Tarot Club ensemble, dialogue-dense)
 *   lotm1 chs 1000+     : 4  (late-stage god/pathway vocab)
 *   coi   any           : 4  (sequel cast + cross-book backstory)
 *   lotm1 side_story    : 2  (non-main content kind)
 * Total: 26.
 *
 * Seeded RNG (mulberry32) — same --seed reproduces the same sample, critical
 * so re-scoring a prompt change against the same labeled set is possible.
 *
 * Run:
 *   pnpm ner:sample                     # 26 chunks, seed=42, overwrites gold file
 *   pnpm ner:sample --seed 7 --n 20     # smaller sample, different seed
 *   pnpm ner:sample --force             # overwrite existing labeled file (prompts otherwise)
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { buildAliasIndex, loadEntities, scanAliases } from "@/lib/ingest/ner";

const OUT_PATH = "data/eval/ner-gold.jsonl";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type ChunkRow = {
  chunk_id: number;
  book_id: string;
  chapter_num: number;
  chapter_title: string;
  chunk_index: number;
  content: string;
  content_kind: string;
};

type Stratum = {
  label: string;
  // Raw SQL predicate applied to the joined chunks+chapters query.
  predicate: ReturnType<typeof sql>;
  take: number;
};

function parseArgs() {
  const a = process.argv.slice(2);
  const getFlag = (name: string): string | undefined => {
    const i = a.indexOf(name);
    return i === -1 ? undefined : a[i + 1];
  };
  const force = a.includes("--force");
  const seed = Number(getFlag("--seed") ?? 42);
  const totalN = getFlag("--n");
  return { seed, totalN: totalN ? Number(totalN) : null, force };
}

// Scale the per-stratum `take` proportionally if `--n` is passed.
function rescale(strata: Stratum[], totalN: number): Stratum[] {
  const total = strata.reduce((acc, s) => acc + s.take, 0);
  if (totalN === total) return strata;
  const scale = totalN / total;
  const scaled = strata.map((s) => ({
    ...s,
    take: Math.max(1, Math.round(s.take * scale)),
  }));
  // Repair rounding drift so the sum matches totalN exactly.
  let diff = totalN - scaled.reduce((acc, s) => acc + s.take, 0);
  let i = 0;
  while (diff !== 0 && scaled.length > 0) {
    scaled[i % scaled.length].take += diff > 0 ? 1 : -1;
    scaled[i % scaled.length].take = Math.max(1, scaled[i % scaled.length].take);
    diff = totalN - scaled.reduce((acc, s) => acc + s.take, 0);
    i++;
    if (i > 1000) break;
  }
  return scaled;
}

async function fetchStratum(pred: ReturnType<typeof sql>): Promise<ChunkRow[]> {
  const res = (await db.execute(sql`
    SELECT
      c.id           AS chunk_id,
      c.book_id      AS book_id,
      c.chapter_num  AS chapter_num,
      c.chunk_index  AS chunk_index,
      c.content      AS content,
      c.content_kind AS content_kind,
      ch.chapter_title AS chapter_title
    FROM chunks c
    JOIN chapters ch ON ch.id = c.chapter_id
    WHERE ${pred}
  `)) as unknown as { rows: ChunkRow[] };
  return res.rows ?? [];
}

async function main(): Promise<void> {
  const { seed, totalN, force } = parseArgs();
  const rand = mulberry32(seed);

  if (existsSync(OUT_PATH) && !force) {
    throw new Error(
      `${OUT_PATH} already exists. Pass --force to overwrite existing labels, or back it up first.`,
    );
  }

  const entities = await loadEntities();
  const aliasIndex = buildAliasIndex(entities);
  console.log(
    `[ner-sample] loaded ${entities.length} canonical entities for hint generation`,
  );

  const baseStrata: Stratum[] = [
    {
      label: "lotm1_early",
      predicate: sql`c.book_id = 'lotm1' AND c.chapter_num BETWEEN 1 AND 100 AND c.content_kind = 'main'`,
      take: 8,
    },
    {
      label: "lotm1_mid",
      predicate: sql`c.book_id = 'lotm1' AND c.chapter_num BETWEEN 101 AND 800 AND c.content_kind = 'main'`,
      take: 8,
    },
    {
      label: "lotm1_late",
      predicate: sql`c.book_id = 'lotm1' AND c.chapter_num >= 1000 AND c.content_kind = 'main'`,
      take: 4,
    },
    {
      label: "coi_main",
      predicate: sql`c.book_id = 'coi' AND c.content_kind = 'main'`,
      take: 4,
    },
    {
      label: "lotm1_side",
      predicate: sql`c.book_id = 'lotm1' AND c.content_kind = 'side_story'`,
      take: 2,
    },
  ];

  const strata = totalN != null ? rescale(baseStrata, totalN) : baseStrata;
  const targetCount = strata.reduce((acc, s) => acc + s.take, 0);
  console.log(
    `[ner-sample] seed=${seed} target=${targetCount} chunks across ${strata.length} strata`,
  );

  const sampled: Array<ChunkRow & { stratum: string }> = [];
  for (const s of strata) {
    const pool = await fetchStratum(s.predicate);
    if (pool.length === 0) {
      console.warn(`[ner-sample]   ${s.label}: pool EMPTY — skipped`);
      continue;
    }
    const picked = shuffle(pool, rand).slice(0, s.take);
    for (const p of picked) sampled.push({ ...p, stratum: s.label });
    console.log(
      `[ner-sample]   ${s.label}: pool=${pool.length} → took ${picked.length}`,
    );
  }

  // Write JSONL. gold_mentions is left empty; hint_entities surfaces the alias
  // scan's guesses so the labeler can crib canonical name spellings.
  const dir = dirname(OUT_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const lines = sampled.map((s) => {
    const hits = scanAliases(s.content, aliasIndex);
    const hintEntities = Array.from(hits.keys())
      .map((id) => aliasIndex.byId.get(id)?.canonicalName)
      .filter((n): n is string => typeof n === "string")
      .sort();
    return JSON.stringify({
      chunk_id: s.chunk_id,
      book_id: s.book_id,
      chapter_num: s.chapter_num,
      chapter_title: s.chapter_title,
      chunk_index: s.chunk_index,
      stratum: s.stratum,
      content: s.content,
      hint_entities: hintEntities,
      gold_mentions: [],
      notes: "",
    });
  });

  writeFileSync(OUT_PATH, lines.join("\n") + "\n", "utf8");
  console.log(
    `\n[ner-sample] wrote ${sampled.length} entries to ${OUT_PATH}`,
  );
  console.log(`[ner-sample] Next step: label the gold_mentions arrays.`);
  console.log(`[ner-sample]   - Each entry is one line of JSON.`);
  console.log(`[ner-sample]   - Fill gold_mentions with entries like:`);
  console.log(
    `[ner-sample]       {"name": "Klein Moretti", "role": "speaker"}`,
  );
  console.log(
    `[ner-sample]     role ∈ {"speaker", "addressee", "mentioned"} or null.`,
  );
  console.log(
    `[ner-sample]   - Use canonical names from hint_entities when applicable.`,
  );
  console.log(
    `[ner-sample]   - For entities NOT in hint_entities, use the name as it appears in the chunk.`,
  );
  console.log(`[ner-sample]   - Leave gold_mentions: [] if the chunk truly has no entities.`);
  console.log(
    `[ner-sample]   - Optional: use "notes" to flag tricky cases for later review.`,
  );
  console.log(
    `[ner-sample] Then run: pnpm ner:score`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
