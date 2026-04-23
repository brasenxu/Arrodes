/**
 * Normalizes `data/eval/ner-gold.jsonl` to align labels with chapter-local
 * names. For each gold mention that:
 *   (a) is already present in the chunk/chapter text as-is, OR
 *   (b) resolves via a seeded alias whose form IS in the chapter,
 * the mention is kept unchanged.
 *
 * Otherwise, the mention's `name` is replaced with the longest contiguous
 * word span of the original name that IS in the chunk. If no such span
 * exists, the mention is dropped (it was an out-of-chapter reference that
 * Haiku has no way to produce from chunk+chapter input).
 *
 * Backups the original file to ner-gold.jsonl.bak before writing.
 *
 * Run:
 *   pnpm tsx scripts/ner-gold-normalize.ts
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { buildAliasIndex, loadEntities } from "@/lib/ingest/ner";

const IN_PATH = "data/eval/ner-gold.jsonl";
const BACKUP_PATH = "data/eval/ner-gold.jsonl.bak";

type GoldMention = { name: string; role: string | null };
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

// Find the longest contiguous word span of `name` that is present in `chunk`.
// Returns null if no span of ≥1 word is in the chunk.
function longestSpanInText(name: string, text: string): string | null {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  for (let len = words.length; len >= 1; len--) {
    for (let start = 0; start + len <= words.length; start++) {
      const candidate = words.slice(start, start + len).join(" ");
      // Skip 1-word candidates that are just articles/common words.
      if (len === 1) {
        if (/^(The|A|An|Mr\.?|Mrs\.?|Miss|Madam|Old|Lord|Lady|Saint|Sir|Dr\.?)$/i.test(candidate)) continue;
      }
      if (text.includes(candidate)) return candidate;
    }
  }
  return null;
}

async function main() {
  const entities = await loadEntities();
  const aliasIndex = buildAliasIndex(entities);

  const lines = readFileSync(IN_PATH, "utf8").split("\n").filter(Boolean);
  const gold: GoldEntry[] = lines.map((l) => JSON.parse(l));

  const keys = Array.from(
    new Set(gold.map((g) => `${g.book_id}|${g.chapter_num}`)),
  );
  const chapterByKey = new Map<string, string>();
  for (const key of keys) {
    const [bookId, chapterNumStr] = key.split("|");
    const rows = await db
      .select({ rawText: schema.chapters.rawText })
      .from(schema.chapters)
      .where(
        sql`${schema.chapters.bookId} = ${bookId} AND ${schema.chapters.chapterNum} = ${Number(chapterNumStr)}`,
      );
    if (rows[0]) chapterByKey.set(key, rows[0].rawText);
  }

  copyFileSync(IN_PATH, BACKUP_PATH);
  console.log(`[normalize] backed up original to ${BACKUP_PATH}`);

  let kept = 0;
  let replaced = 0;
  let dropped = 0;

  const outLines: string[] = [];
  for (const g of gold) {
    const chapter = chapterByKey.get(`${g.book_id}|${g.chapter_num}`) ?? "";
    const newMentions: GoldMention[] = [];

    for (const m of g.gold_mentions) {
      // Case 1: name is in chunk or chapter as-is → keep
      if (g.content.includes(m.name) || chapter.includes(m.name)) {
        newMentions.push(m);
        kept++;
        continue;
      }
      // Case 2: name resolves via seeded alias to an entity that has any form
      // in the chapter → keep (the scorer will match it)
      const entityId = aliasIndex.nameLookup.get(m.name.toLowerCase());
      if (entityId !== undefined) {
        const e = aliasIndex.byId.get(entityId);
        if (e) {
          const anyFormInChapter = [e.canonicalName, ...e.aliases].some((a) =>
            chapter.includes(a),
          );
          if (anyFormInChapter) {
            newMentions.push(m);
            kept++;
            continue;
          }
        }
      }
      // Case 3: try to find a shorter span of the name that IS in the chunk.
      const span = longestSpanInText(m.name, g.content);
      if (span !== null) {
        console.log(
          `[normalize] chunk#${g.chunk_id}: "${m.name}" → "${span}"`,
        );
        newMentions.push({ name: span, role: m.role });
        replaced++;
        continue;
      }
      // Case 4: no viable form — drop.
      console.log(
        `[normalize] chunk#${g.chunk_id}: DROP "${m.name}"[${m.role ?? "null"}] (no form in chunk/chapter)`,
      );
      dropped++;
    }

    // De-duplicate (replacements can collide with existing mentions).
    const seen = new Set<string>();
    const dedup: GoldMention[] = [];
    for (const m of newMentions) {
      const key = `${m.name.toLowerCase()}|${m.role ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(m);
    }

    outLines.push(
      JSON.stringify({
        ...g,
        gold_mentions: dedup,
      }),
    );
  }

  writeFileSync(IN_PATH, outLines.join("\n") + "\n", "utf8");
  console.log(
    `\n[normalize] kept=${kept} replaced=${replaced} dropped=${dropped}`,
  );
  console.log(`[normalize] wrote updated ${IN_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
