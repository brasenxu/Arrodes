# Drizzle migrations — bootstrap sequence

## Fresh-clone / fresh-database setup

The journal (`meta/_journal.json`) covers the **full table schema**
(`0000_low_nightmare.sql`). It does NOT cover the two machine-local steps that
were originally run manually (ticket 001) — a bare `pnpm db:migrate` on a fresh
database will fail. Run in this order:

1. **Extensions + search column** — `drizzle/0000_init_extensions.sql`
   (pgvector extension, `chunks.tsv` tsvector column + trigger, pg_trgm).
   Not journaled: drizzle-kit doesn't manage extensions/trigger DDL.
2. **Full schema** — `pnpm db:migrate` (applies the journal: tables, FKs,
   indexes incl. the ticket 030 unique keys + content_kind CHECK).
3. **Data** — re-ingestion requires the EPUBs (`data/epub/*.epub`, gitignored)
   and the provider keys; see `scripts/ingest.ts` header. Do NOT re-run
   casually: ticket 030's unique keys make inserts conflict-safe, but
   `--phase chapters` cascades chunks/mentions/events.

## Migration-history note (2026-10-02)

`drizzle/meta/` was previously gitignored and the journal was lost —
drizzle-kit regenerated a full-state baseline (`0000_low_nightmare.sql`) and
the live database's `drizzle.__drizzle_migrations` was reset to that baseline
(`scripts/apply-data-dedupe.ts`). The pre-baseline SQL files
(`0000_fluffy_cable.sql`, `0001_wild_sersi.sql`, `0002_material_tusk.sql`) are
kept for history but are no longer referenced by the journal. The hand-written
`0003_data_dedupe.sql` records the constraint delta applied to the live DB;
fresh databases get the same constraints from 0000 directly.
