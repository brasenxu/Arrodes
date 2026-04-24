/**
 * Two one-off patches after ticket 007's event ingest:
 *
 *   1. data/eval/event-gold.jsonl — disagreement-review gold edits
 *      (applied 2026-04-23, left in place for reproducibility).
 *   2. events table — insert Klein's missing Sherlock Moriarty identity_assume
 *      row. Ticket 007 AC #6 required all three canonical identities; Haiku
 *      missed the Sherlock debut chunk (#2132, LOTM1 ch215 "Mrs. Sammer") —
 *      likely because the chunk lacks the `new identity` / `his present name`
 *      keyword phrases added in the post-eval gate expansion. Backfilled
 *      manually rather than re-running extraction for $0.01 worth of work.
 *
 * Re-runs are idempotent — the gold patches use filters; the events INSERT
 * checks for an existing Sherlock row first.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readFileSync, writeFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

// ---------------------------------------------------------------------------
// Patch 1 — gold file events (previously applied, preserved here for audit)
// ---------------------------------------------------------------------------

const GOLD_PATH = "data/eval/event-gold.jsonl";

type GoldEvent = {
  entity_canonical_name: string;
  event_type: string;
  extra?: Record<string, unknown>;
};

type GoldChunk = {
  chunk_id: number;
  events: GoldEvent[];
  [k: string]: unknown;
};

const GOLD_PATCHES: Record<number, (events: GoldEvent[]) => GoldEvent[]> = {
  5168: (events) => [
    ...events.filter(
      (e) =>
        !(
          e.entity_canonical_name === "Klein Moretti" &&
          e.event_type === "identity_reveal"
        ),
    ),
    {
      entity_canonical_name: "Klein Moretti",
      event_type: "identity_reveal",
      extra: { identity: "Hero Bandit Black Emperor" },
    },
  ],
  4271: (events) => {
    const existing = new Set(
      events
        .filter((e) => e.event_type === "death")
        .map((e) => e.entity_canonical_name),
    );
    const added: GoldEvent[] = [];
    for (const name of ["Steel Maveti", "Blood Brambles Hendry", "Calm Squall"]) {
      if (!existing.has(name)) {
        added.push({ entity_canonical_name: name, event_type: "death" });
      }
    }
    return [...events, ...added];
  },
  2666: (events) =>
    events.filter(
      (e) =>
        !(
          e.entity_canonical_name === "Klein Moretti" &&
          e.event_type === "sequence_advance"
        ),
    ),
  9560: (events) => {
    const has = events.some(
      (e) => e.entity_canonical_name === "Ariehogg" && e.event_type === "battle",
    );
    return has
      ? events
      : [...events, { entity_canonical_name: "Ariehogg", event_type: "battle" }];
  },
};

function applyGoldPatches(): void {
  const lines = readFileSync(GOLD_PATH, "utf8").split("\n");
  const out: string[] = [];
  let patched = 0;
  for (const line of lines) {
    if (!line.trim()) {
      out.push(line);
      continue;
    }
    let obj: GoldChunk;
    try {
      obj = JSON.parse(line);
    } catch {
      out.push(line);
      continue;
    }
    const patch = GOLD_PATCHES[obj.chunk_id];
    if (patch) {
      const before = JSON.stringify(obj.events);
      obj.events = patch(obj.events);
      if (JSON.stringify(obj.events) !== before) patched++;
    }
    out.push(JSON.stringify(obj));
  }
  writeFileSync(GOLD_PATH, out.join("\n"));
  console.log(`[gold] idempotent patch — ${patched} rows changed`);
}

// ---------------------------------------------------------------------------
// Patch 2 — Sherlock Moriarty identity_assume row
// ---------------------------------------------------------------------------

async function insertSherlockIdentityAssume(): Promise<void> {
  const [klein] = (await db
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .where(sql`${schema.entities.canonicalName} = 'Klein Moretti'`)
    .limit(1)) as { id: number }[];
  if (!klein) throw new Error("Klein Moretti entity not found");

  const existing = (await db.execute(sql`
    SELECT id FROM events
    WHERE entity_id = ${klein.id}
      AND event_type = 'identity_assume'
      AND extra->>'identity' ILIKE 'Sherlock%'
    LIMIT 1
  `)) as unknown as { rows: { id: number }[] };
  if (existing.rows.length > 0) {
    console.log(
      `[events] Sherlock row already exists (id=${existing.rows[0].id}) — skipping`,
    );
    return;
  }

  // Chunk 2132 = LOTM1 ch215 "Mrs. Sammer" — the literal debut where Klein
  // introduces himself as "Sherlock Moriarty. You can call me Sherlock. Klein
  // had long thought of a fake name."
  const chunkRes = (await db.execute(sql`
    SELECT c.id AS chunk_id, c.chapter_id, ch.book_id, ch.chapter_num
    FROM chunks c JOIN chapters ch ON ch.id = c.chapter_id
    WHERE c.id = 2132 AND ch.book_id = 'lotm1'
  `)) as unknown as {
    rows: { chunk_id: number; chapter_id: number; book_id: string; chapter_num: number }[];
  };
  const chunkRow = chunkRes.rows[0];
  if (!chunkRow) throw new Error("Target chunk 2132 not found");

  await db.insert(schema.events).values({
    entityId: klein.id,
    eventType: "identity_assume",
    chapterId: chunkRow.chapter_id,
    bookId: chunkRow.book_id,
    chapterNum: chunkRow.chapter_num,
    evidenceChunkId: chunkRow.chunk_id,
    snippet:
      '"Sherlock Moriarty. You can call me Sherlock." Klein had long thought of a fake name.',
    extra: {
      identity: "Sherlock Moriarty",
      context: "First introduction to Mrs. Sammer while renting 15 Minsk Street",
    },
  });
  console.log(
    `[events] inserted Klein → identity_assume(Sherlock Moriarty) at chunk#${chunkRow.chunk_id} ch${chunkRow.chapter_num}`,
  );
}

// ---------------------------------------------------------------------------
// Patch 3 — Klein identity_assume canon cleanup (2026-04-24)
//
// Cross-checked against the LOTM fandom wiki + corpus first-appearance queries.
// Haiku over-emitted identity_assume on re-uses of already-adopted working
// identities (prompt violation — the rule is "debut moment only"). Also
// misplaced The Fool and The World debuts. Manually align to the canonical
// first-use chunks, and add Zhou Mingrui (Klein's pre-transmigration identity
// that Q035 expects in the aggregation).
//
// Benson Moretti is intentionally NOT added — he's Klein's real brother, not
// an assumed identity. Q035's listing of Benson is an eval-set quirk.
// ---------------------------------------------------------------------------

// Specific event_ids of non-debut duplicates to delete. Each entry is a
// non-debut identity_assume row for Klein; the debut row for that identity is
// preserved. Idempotent: deleting a non-existent id is a no-op.
const CLEANUP_EVENT_IDS = [
  744,  // Gehrman ch 483 chunk 3951 — second chunk of same scene (keep 743)
  774,  // Gehrman ch 500 — re-use
  850,  // Gehrman ch 532 — re-use
  1232, // Gehrman ch 777 — re-use
  1721, // Gehrman ch 1079 — re-use
  1175, // Dwayne ch 732 chunk 5620 — second chunk of same scene (keep 1174)
  1176, // Dwayne ch 733 — re-use
  1339, // Dwayne ch 851 — re-use
  582,  // The Fool ch 6 chunk 735 — wrong chunk (the ch 7 chunk 736 has "You can address me as The Fool")
  336,  // The World ch 264 chunk 2467 — wrong chunk (chunk 2466 is the naming moment)
];

async function cleanupKleinIdentityAssume(): Promise<void> {
  const [klein] = (await db
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .where(sql`${schema.entities.canonicalName} = 'Klein Moretti'`)
    .limit(1)) as { id: number }[];
  if (!klein) throw new Error("Klein Moretti entity not found");

  // Delete non-debut duplicates via drizzle's typed `inArray` (neon-http
  // can't bind a JS array to int[] in a raw sql template — same issue as
  // event-sample.ts hit during development). Guard with entity_id +
  // event_type so a future schema change that reuses these IDs doesn't
  // silently destroy unrelated rows.
  const delResult = await db
    .delete(schema.events)
    .where(
      and(
        inArray(schema.events.id, CLEANUP_EVENT_IDS),
        eq(schema.events.entityId, klein.id),
        eq(schema.events.eventType, "identity_assume"),
      ),
    )
    .returning({ id: schema.events.id });
  console.log(
    `[cleanup] deleted ${delResult.length} non-debut identity_assume rows (target: ${CLEANUP_EVENT_IDS.length})`,
  );

  // Insert Zhou Mingrui at chunk 690 (LOTM1 ch 1 — transmigration opening).
  const existing = (await db.execute(sql`
    SELECT id FROM events
    WHERE entity_id = ${klein.id}
      AND event_type = 'identity_assume'
      AND extra->>'identity' = 'Zhou Mingrui'
    LIMIT 1
  `)) as unknown as { rows: { id: number }[] };
  if (existing.rows.length > 0) {
    console.log(
      `[cleanup] Zhou Mingrui row already exists (id=${existing.rows[0].id}) — skipping insert`,
    );
  } else {
    const chunkRes = (await db.execute(sql`
      SELECT c.id AS chunk_id, c.chapter_id, ch.book_id, ch.chapter_num
      FROM chunks c JOIN chapters ch ON ch.id = c.chapter_id
      WHERE c.id = 690 AND ch.book_id = 'lotm1'
    `)) as unknown as {
      rows: { chunk_id: number; chapter_id: number; book_id: string; chapter_num: number }[];
    };
    const chunkRow = chunkRes.rows[0];
    if (!chunkRow) throw new Error("Target chunk 690 not found");
    await db.insert(schema.events).values({
      entityId: klein.id,
      eventType: "identity_assume",
      chapterId: chunkRow.chapter_id,
      bookId: chunkRow.book_id,
      chapterNum: chunkRow.chapter_num,
      evidenceChunkId: chunkRow.chunk_id,
      snippet: "The sound asleep Zhou Mingrui felt an abnormal throbbing pain in his head",
      extra: {
        identity: "Zhou Mingrui",
        context:
          "Pre-transmigration identity — Klein's original self before waking up in Klein Moretti's body",
      },
    });
    console.log(
      `[cleanup] inserted Klein → identity_assume(Zhou Mingrui) at chunk#${chunkRow.chunk_id} ch${chunkRow.chapter_num}`,
    );
  }

  // John Yode — wiki-listed "Temporary" identity (LOTM1 ch 722), self-adopted
  // disguise during the Bayam arc. Earliest corpus mention is chunk #5555.
  const existingJohn = (await db.execute(sql`
    SELECT id FROM events
    WHERE entity_id = ${klein.id}
      AND event_type = 'identity_assume'
      AND extra->>'identity' = 'John Yode'
    LIMIT 1
  `)) as unknown as { rows: { id: number }[] };
  if (existingJohn.rows.length > 0) {
    console.log(
      `[cleanup] John Yode row already exists (id=${existingJohn.rows[0].id}) — skipping insert`,
    );
    return;
  }
  const johnChunkRes = (await db.execute(sql`
    SELECT c.id AS chunk_id, c.chapter_id, ch.book_id, ch.chapter_num
    FROM chunks c JOIN chapters ch ON ch.id = c.chapter_id
    WHERE c.id = 5555 AND ch.book_id = 'lotm1'
  `)) as unknown as {
    rows: { chunk_id: number; chapter_id: number; book_id: string; chapter_num: number }[];
  };
  const johnChunk = johnChunkRes.rows[0];
  if (!johnChunk) throw new Error("Target chunk 5555 not found");
  await db.insert(schema.events).values({
    entityId: klein.id,
    eventType: "identity_assume",
    chapterId: johnChunk.chapter_id,
    bookId: johnChunk.book_id,
    chapterNum: johnChunk.chapter_num,
    evidenceChunkId: johnChunk.chunk_id,
    snippet: "Deniel staggered backward",
    extra: {
      identity: "John Yode",
      context:
        "Temporary disguise during the Bayam arc (LOTM1 ch 722, per wiki aliases)",
    },
  });
  console.log(
    `[cleanup] inserted Klein → identity_assume(John Yode) at chunk#${johnChunk.chunk_id} ch${johnChunk.chapter_num}`,
  );
}

async function main() {
  applyGoldPatches();
  await insertSherlockIdentityAssume();
  await cleanupKleinIdentityAssume();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
