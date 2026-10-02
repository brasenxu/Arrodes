/**
 * One-off eval-set authoring assist (ticket 014). For each entry id, searches
 * chapter raw_text for key phrases (lexical ilike — independent of the
 * embedding retrieval being scored) and prints candidate chapters.
 *
 * Usage: pnpm tsx scripts/eval-author.ts            # all specs
 *        pnpm tsx scripts/eval-author.ts Q024 Q025  # subset
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

type Spec = { id: string; phrases: string[]; mode: "any" | "all"; limit?: number };

const SPECS: Spec[] = [
  // Timeline anchors (narrow predicates; earliest hit = the answer)
  { id: "Q024", phrases: ["Tarot Club"], mode: "any", limit: 8 },
  { id: "Q025", phrases: ["audrey", "tarot club"], mode: "all", limit: 8 },
  { id: "Q026", phrases: ["magician", "clown"], mode: "all", limit: 10 },
  { id: "Q027", phrases: ["roselle", "diary"], mode: "all", limit: 8 },
  { id: "Q028", phrases: ["gehrman sparrow"], mode: "any", limit: 6 },
  // Dialogue anchors
  { id: "Q029", phrases: ["grey fog", "prayer"], mode: "all", limit: 8 },
  { id: "Q033", phrases: ["The Fool that doesn't belong to this era"], mode: "any", limit: 6 },
  // Lore concepts (explanatory passages)
  { id: "Q008", phrases: ["Beyonder Characteristics"], mode: "any", limit: 8 },
  { id: "Q009", phrases: ["Uniqueness"], mode: "any", limit: 10 },
  { id: "Q011", phrases: ["Blasphemy Slate"], mode: "any", limit: 8 },
  { id: "Q012", phrases: ["digest", "potion"], mode: "all", limit: 10 },
];

async function main() {
  const ids = process.argv.slice(2);
  for (const spec of SPECS.filter((s) => ids.length === 0 || ids.includes(s.id))) {
    const conditions = spec.phrases.map(
      (p) => sql`(ch.chapter_title ilike ${`%${p}%`} OR ch.raw_text ilike ${`%${p}%`})`,
    );
    const combined =
      spec.mode === "all"
        ? sql.join(conditions, sql` AND `)
        : sql`(${sql.join(conditions, sql` OR `)})`;
    const result = await db.execute(sql`
      SELECT ch.book_id, ch.chapter_num, ch.chapter_title
      FROM chapters ch
      WHERE ${combined}
      ORDER BY ch.book_id, ch.chapter_num
      LIMIT ${spec.limit ?? 10}
    `);
    console.log(`=== ${spec.id} (${spec.mode}: ${spec.phrases.join(", ")})`);
    for (const r of ((result as unknown as { rows?: Array<{ book_id: string; chapter_num: number; chapter_title: string }> })
      .rows ?? [])) {
      console.log(`  ${r.book_id} ch.${r.chapter_num} — ${r.chapter_title}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
