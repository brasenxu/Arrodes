/**
 * Audits `data/eval/ner-gold.jsonl` for names that don't appear in the chapter
 * text (or in a referenced-alias form that the chapter uses). Surfaces labels
 * that were drawn from book-wide memory rather than chapter-local text, which
 * systematically punish Haiku on the scorer.
 *
 * Output:
 *   - For each gold name not found in the chapter:
 *     - Whether the first word OR any seeded alias appears in the chapter.
 *     - Suggested replacement (chapter-local form).
 *   - Summary counts.
 *
 * Run:
 *   pnpm tsx scripts/ner-gold-audit.ts
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { readFileSync } from "fs";
import { inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { buildAliasIndex, loadEntities } from "@/lib/ingest/ner";

type GoldMention = { name: string; role: string | null };
type GoldEntry = {
  chunk_id: number;
  book_id: string;
  chapter_num: number;
  chapter_title: string;
  chunk_index: number;
  content: string;
  gold_mentions: GoldMention[];
};

async function main() {
  const entities = await loadEntities();
  const aliasIndex = buildAliasIndex(entities);

  const gold: GoldEntry[] = readFileSync("data/eval/ner-gold.jsonl", "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  // Fetch chapter raw text for every referenced chapter.
  const keys = Array.from(
    new Set(gold.map((g) => `${g.book_id}|${g.chapter_num}`)),
  );
  const chapterByKey = new Map<string, string>();
  for (const key of keys) {
    const [bookId, chapterNumStr] = key.split("|");
    const rows = await db
      .select({
        bookId: schema.chapters.bookId,
        chapterNum: schema.chapters.chapterNum,
        rawText: schema.chapters.rawText,
      })
      .from(schema.chapters)
      .where(
        sql`${schema.chapters.bookId} = ${bookId} AND ${schema.chapters.chapterNum} = ${Number(chapterNumStr)}`,
      );
    if (rows[0]) chapterByKey.set(key, rows[0].rawText);
  }

  type Issue = {
    chunk_id: number;
    book_id: string;
    chapter_num: number;
    gold_name: string;
    role: string | null;
    in_chunk: boolean;
    in_chapter: boolean;
    alias_variant_in_chapter: string | null;
    suggested_chapter_local: string | null;
  };

  const issues: Issue[] = [];
  let totalNames = 0;

  for (const g of gold) {
    const chapter = chapterByKey.get(`${g.book_id}|${g.chapter_num}`) ?? "";
    for (const m of g.gold_mentions) {
      totalNames++;
      const inChunk = g.content.includes(m.name);
      const inChapter = chapter.includes(m.name);
      if (inChunk || inChapter) continue;

      // Look for any alias of this gold name's canonical entity that IS in the chapter.
      const entityId = aliasIndex.nameLookup.get(m.name.toLowerCase());
      let aliasHit: string | null = null;
      if (entityId !== undefined) {
        const e = aliasIndex.byId.get(entityId);
        if (e) {
          for (const a of [e.canonicalName, ...e.aliases]) {
            if (chapter.includes(a)) {
              aliasHit = a;
              break;
            }
          }
        }
      }

      // Simple heuristic for suggested chapter-local form: first word of gold
      // name if it alone appears in the chunk.
      let suggested: string | null = null;
      const firstWord = m.name.split(" ")[0];
      if (firstWord !== m.name && g.content.includes(firstWord)) {
        suggested = firstWord;
      }

      issues.push({
        chunk_id: g.chunk_id,
        book_id: g.book_id,
        chapter_num: g.chapter_num,
        gold_name: m.name,
        role: m.role,
        in_chunk: inChunk,
        in_chapter: inChapter,
        alias_variant_in_chapter: aliasHit,
        suggested_chapter_local: suggested,
      });
    }
  }

  console.log(
    `[audit] ${gold.length} gold entries, ${totalNames} total gold mentions`,
  );
  console.log(
    `[audit] ${issues.length} mentions use a name NOT in chunk or chapter (${((issues.length / totalNames) * 100).toFixed(1)}%)\n`,
  );

  // Group by chunk for readability.
  const byChunk = new Map<number, Issue[]>();
  for (const i of issues) {
    const arr = byChunk.get(i.chunk_id) ?? [];
    arr.push(i);
    byChunk.set(i.chunk_id, arr);
  }

  for (const [chunkId, list] of byChunk) {
    const first = list[0];
    console.log(
      `chunk#${chunkId} (${first.book_id} ch${first.chapter_num})`,
    );
    for (const i of list) {
      let note = "";
      if (i.alias_variant_in_chapter) {
        note = ` → chapter uses the alias "${i.alias_variant_in_chapter}" (resolves via seed, OK to keep)`;
      } else if (i.suggested_chapter_local) {
        note = ` → chunk uses short form "${i.suggested_chapter_local}" — consider replacing gold with this`;
      } else {
        note = ` → NEITHER short form nor any seeded alias found; likely pronoun/description reference`;
      }
      console.log(`  - "${i.gold_name}"[${i.role ?? "null"}]${note}`);
    }
  }

  console.log(
    `\n[audit] Recommended actions:`,
  );
  const aliasOk = issues.filter((i) => i.alias_variant_in_chapter).length;
  const shortForm = issues.filter(
    (i) => !i.alias_variant_in_chapter && i.suggested_chapter_local,
  ).length;
  const neither = issues.length - aliasOk - shortForm;
  console.log(`  ${aliasOk} mentions: alias in chapter resolves via seed → KEEP AS-IS`);
  console.log(
    `  ${shortForm} mentions: replace gold name with the short form actually in the chunk`,
  );
  console.log(
    `  ${neither} mentions: no match — likely pronoun/description reference, drop from gold`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
