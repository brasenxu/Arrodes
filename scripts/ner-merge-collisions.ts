/**
 * Merges auto-created entity rows into their proper seed-canonical targets.
 *
 * When the NER run encountered a name that wasn't yet in the alias seed (e.g.,
 * "Anthony", "Ludwig", "Mr. Azik"), it created a new entity row with that name
 * as canonical_name. If the seed is later expanded so that name becomes an
 * alias of a different canonical entity (e.g., "Anthony" → Anthony Reid,
 * "Ludwig" → Ludwig Phil), the existing mentions are now orphaned — pointing
 * to an auto-created row that should instead resolve to the seeded entity.
 *
 * This script finds every such collision and migrates the mentions, then
 * deletes the now-empty auto row.
 *
 * AMBIGUOUS CASES (skipped, printed for manual review):
 *   If canonical_name is BOTH a seeded canonical_name (e.g., "Black Emperor"
 *   is canonical for the pathway) AND an alias of a different seed entity
 *   (e.g., "Black Emperor" is Roselle Gustav's Tarot nickname), automated
 *   merge would incorrectly re-attribute mentions. Skip and surface for
 *   human decision.
 *
 * Idempotent: re-running after a successful merge finds zero collisions.
 *
 * Run:
 *   pnpm tsx scripts/ner-merge-collisions.ts --dry-run   # preview only
 *   pnpm tsx scripts/ner-merge-collisions.ts --yes       # apply
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { readFileSync } from "fs";
import { inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

type SeedEntry = { canonical_name: string; aliases: string[] };

function parseArgs() {
  const a = process.argv.slice(2);
  return {
    dryRun: a.includes("--dry-run"),
    yes: a.includes("--yes"),
  };
}

async function main() {
  const { dryRun, yes } = parseArgs();

  const seed = JSON.parse(readFileSync("data/entities/aliases.json", "utf8"));
  const seedCanonicals = new Set<string>(
    seed.entities.map((e: SeedEntry) => e.canonical_name),
  );
  // alias string → seed canonical_name. Case-sensitive. If a string is an alias
  // of multiple seed entities, the LAST one in file order wins — mirrors the
  // aliasIndex.nameLookup resolution order in lib/ingest/ner.ts.
  const seedAliases = new Map<string, string>();
  for (const e of seed.entities as SeedEntry[]) {
    for (const a of e.aliases) {
      seedAliases.set(a, e.canonical_name);
    }
  }

  const rows = (await db.execute(sql`
    SELECT
      e.id,
      e.canonical_name,
      count(em.id)::int AS mentions
    FROM entities e
    LEFT JOIN entity_mentions em ON em.entity_id = e.id
    GROUP BY e.id
    ORDER BY mentions DESC
  `)) as unknown as {
    rows: Array<{ id: number; canonical_name: string; mentions: number }>;
  };

  type Plan = {
    autoId: number;
    autoName: string;
    targetName: string;
    mentions: number;
  };
  const cleanPlans: Plan[] = [];
  const ambiguousPlans: Array<Plan & { reason: string }> = [];

  for (const r of rows.rows ?? []) {
    const target = seedAliases.get(r.canonical_name);
    if (!target || r.canonical_name === target) continue;

    // Skip if the auto row's canonical_name is ALSO a seed canonical — this
    // means the row is now semantically the seeded entity of that name (a
    // pathway, etc.), and merging its mentions to some OTHER seed entity
    // would misattribute them.
    if (seedCanonicals.has(r.canonical_name)) {
      ambiguousPlans.push({
        autoId: r.id,
        autoName: r.canonical_name,
        targetName: target,
        mentions: r.mentions,
        reason: `"${r.canonical_name}" is ALSO a seed canonical_name — could be either entity`,
      });
      continue;
    }

    cleanPlans.push({
      autoId: r.id,
      autoName: r.canonical_name,
      targetName: target,
      mentions: r.mentions,
    });
  }

  // Fetch target entity IDs for clean plans in one batch.
  const targetNames = Array.from(new Set(cleanPlans.map((p) => p.targetName)));
  const targetRows = targetNames.length === 0
    ? []
    : await db
        .select({
          id: schema.entities.id,
          canonicalName: schema.entities.canonicalName,
        })
        .from(schema.entities)
        .where(inArray(schema.entities.canonicalName, targetNames));
  const targetIdByName = new Map<string, number>();
  for (const r of targetRows) {
    targetIdByName.set(r.canonicalName, r.id);
  }

  const missingTarget = cleanPlans.filter(
    (p) => !targetIdByName.has(p.targetName),
  );
  if (missingTarget.length > 0) {
    console.warn(
      `[merge] WARNING: ${missingTarget.length} target seed entities are not present in DB — run \`pnpm seed:entities\` first`,
    );
    for (const p of missingTarget) {
      console.warn(`  target missing: "${p.targetName}" (from "${p.autoName}")`);
    }
  }

  const executablePlans = cleanPlans.filter((p) =>
    targetIdByName.has(p.targetName),
  );

  console.log(`=== Merge plan ===`);
  console.log(
    `  ${executablePlans.length} clean merges (${executablePlans.reduce((a, p) => a + p.mentions, 0)} mentions)`,
  );
  console.log(
    `  ${ambiguousPlans.length} ambiguous (${ambiguousPlans.reduce((a, p) => a + p.mentions, 0)} mentions) — will be SKIPPED`,
  );

  console.log(`\n=== Clean merges (top 30 by mention count) ===`);
  for (const p of executablePlans.slice(0, 30)) {
    console.log(
      `  ${String(p.mentions).padStart(5)}  "${p.autoName}" → "${p.targetName}"`,
    );
  }
  if (executablePlans.length > 30) {
    console.log(`  ... and ${executablePlans.length - 30} more`);
  }

  if (ambiguousPlans.length > 0) {
    console.log(`\n=== Ambiguous (SKIPPED — needs human decision) ===`);
    for (const p of ambiguousPlans) {
      console.log(
        `  ${String(p.mentions).padStart(5)}  "${p.autoName}" → "${p.targetName}"  [${p.reason}]`,
      );
    }
  }

  if (dryRun) {
    console.log(`\n[merge] --dry-run — nothing applied.`);
    return;
  }
  if (!yes) {
    console.log(
      `\n[merge] pass --yes to apply (or --dry-run to just preview).`,
    );
    return;
  }

  console.log(`\n[merge] applying ${executablePlans.length} merges...`);
  let mergedMentions = 0;
  let deletedEntities = 0;

  for (const p of executablePlans) {
    const targetId = targetIdByName.get(p.targetName)!;
    // Migrate mentions. Neon HTTP doesn't do multi-statement transactions, so
    // if an update succeeds but the following delete fails, the row is left
    // with zero mentions — harmless.
    const updated = (await db.execute(sql`
      UPDATE entity_mentions SET entity_id = ${targetId}
      WHERE entity_id = ${p.autoId}
    `)) as unknown as { rowCount?: number };
    mergedMentions += updated.rowCount ?? p.mentions;

    await db.execute(sql`DELETE FROM entities WHERE id = ${p.autoId}`);
    deletedEntities++;
  }

  console.log(
    `[merge] DONE — ${deletedEntities} auto entities deleted, ${mergedMentions} mentions reattributed`,
  );

  const after = (await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM entities) AS entities,
      (SELECT count(*)::int FROM entity_mentions) AS mentions
  `)) as unknown as { rows: Array<{ entities: number; mentions: number }> };
  console.log(
    `[merge] post-merge: ${after.rows[0].entities} entities, ${after.rows[0].mentions} mentions`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
