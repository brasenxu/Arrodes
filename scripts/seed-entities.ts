/**
 * Seeds the `entities` table from data/entities/aliases.json.
 *
 * Idempotent: upserts on canonical_name. Re-running is safe — aliases, meta,
 * and entity_type get refreshed from the source JSON. is_spoiler stays 0 for
 * every seed row; entity-level reveal gating is deferred to ticket 017.
 *
 * Ticket 004.
 *
 * Run: pnpm seed:entities
 */

// Load .env.local first (Next.js convention for local secrets), then .env as
// fallback. `dotenv/config` alone only loads .env, which the project doesn't
// populate.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readFileSync } from "fs";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";

const ENTITY_TYPES = [
  "character",
  "organization",
  "pathway",
  "artifact",
  "location",
] as const;

const seedEntrySchema = z.object({
  canonical_name: z.string().min(1),
  entity_type: z.enum(ENTITY_TYPES),
  aliases: z.array(z.string().min(1)),
  is_spoiler: z.union([z.literal(0), z.literal(1)]),
  meta: z.record(z.unknown()).optional(),
});

const seedFileSchema = z.object({
  entities: z.array(seedEntrySchema),
});

type SeedEntry = z.infer<typeof seedEntrySchema>;

const SOURCE_PATH = "data/entities/aliases.json";

function loadSeed(): SeedEntry[] {
  const raw = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
  const parsed = seedFileSchema.parse(raw);

  const seen = new Set<string>();
  for (const e of parsed.entities) {
    if (seen.has(e.canonical_name)) {
      throw new Error(
        `Duplicate canonical_name in ${SOURCE_PATH}: ${e.canonical_name}`,
      );
    }
    seen.add(e.canonical_name);
  }

  return parsed.entities;
}

async function upsertEntity(e: SeedEntry): Promise<"inserted" | "updated"> {
  // Raw SQL keeps the ON CONFLICT clause readable and uses the jsonb cast
  // explicitly — Drizzle's $type<string[]> inference is fine on reads but the
  // ORM's insert .onConflictDoUpdate() path loses the jsonb affinity under
  // neon-http in practice.
  const rows = (await db.execute(sql`
    INSERT INTO entities (canonical_name, entity_type, aliases, is_spoiler, meta)
    VALUES (
      ${e.canonical_name},
      ${e.entity_type},
      ${JSON.stringify(e.aliases)}::jsonb,
      ${e.is_spoiler},
      ${JSON.stringify(e.meta ?? {})}::jsonb
    )
    ON CONFLICT (canonical_name) DO UPDATE SET
      entity_type = EXCLUDED.entity_type,
      aliases     = EXCLUDED.aliases,
      is_spoiler  = EXCLUDED.is_spoiler,
      meta        = EXCLUDED.meta
    RETURNING (xmax = 0) AS inserted
  `)) as unknown as { rows: { inserted: boolean }[] };

  // `xmax = 0` is Postgres folklore: true on a fresh insert, false when
  // ON CONFLICT updated an existing row. Cheaper than a pre-SELECT.
  const row = rows.rows?.[0];
  return row?.inserted ? "inserted" : "updated";
}

async function main() {
  const entries = loadSeed();
  console.log(`Loaded ${entries.length} entities from ${SOURCE_PATH}`);

  let inserted = 0;
  let updated = 0;
  const byType: Record<string, number> = {};

  for (const entry of entries) {
    const result = await upsertEntity(entry);
    if (result === "inserted") inserted++;
    else updated++;
    byType[entry.entity_type] = (byType[entry.entity_type] ?? 0) + 1;
  }

  console.log(`\nDone: ${inserted} inserted, ${updated} updated`);
  console.log("By type:", byType);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
