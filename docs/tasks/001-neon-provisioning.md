---
id: 001
title: Neon provisioning & env wiring
phase: 1
status: done
depends_on: []
estimate: S
updated: 2026-04-21
---

## Context

Neon Postgres is the single backing store (chunks + entities + events + summaries + eval_runs). Provision via Vercel Marketplace so env vars are auto-injected into the Vercel project later, and so local `.env.local` stays in sync.

## Scope

- Provision a Neon project (free tier) either:
  - via Vercel Marketplace — `vercel integration add neon` after `vercel link`, or
  - via Neon dashboard directly if skipping Vercel link for now.
- Pull env vars into `.env.local` — `DATABASE_URL` (pooled) + `DATABASE_URL_UNPOOLED` (direct, for migrations).
- Verify connection from local: `psql $DATABASE_URL_UNPOOLED -c '\dx'`.
- Run Drizzle migrations: `pnpm db:generate && pnpm db:migrate`.
- Apply hand-authored extensions SQL: `psql $DATABASE_URL_UNPOOLED -f drizzle/0000_init_extensions.sql`.
- Verify extensions: `psql $DATABASE_URL_UNPOOLED -c '\dx'` should list `vector`, `pg_trgm`.
- Verify HNSW index via `\di chunks_embedding_hnsw_idx`.

## Out of scope

- Ingesting any data (ticket 005).
- Branching strategy for schema changes (Phase 5).

## Deliverables

- Neon project live.
- `.env.local` populated with DATABASE_URL + DATABASE_URL_UNPOOLED (gitignored).
- Schema migrated, extensions applied, indexes present.

## Acceptance criteria

- `pnpm db:studio` opens and shows 7 tables: books, chapters, chunks, entities, entity_mentions, events, summaries, eval_runs.
- `SELECT extname FROM pg_extension;` returns `vector` and `pg_trgm`.
- `\di chunks_embedding_hnsw_idx` returns a row.

## Verification

```bash
psql $DATABASE_URL_UNPOOLED -c '\dt'
psql $DATABASE_URL_UNPOOLED -c '\dx'
psql $DATABASE_URL_UNPOOLED -c 'SELECT count(*) FROM chunks;'  # expect 0
```

## Resolution

Completed 2026-04-21.

- Neon provisioned through the Vercel dashboard (Storage → Create → Neon) under the personal Vercel scope, not via `vercel integration add neon` — that CLI subcommand wasn't needed.
- `.env.local` populated via `vercel env pull` (which writes to the file but doesn't export to the shell). Used `set -a; source .env.local; set +a` to get `$DATABASE_URL_UNPOOLED` visible to `psql` and `pnpm db:migrate`.
- **Ordering gotcha (worth remembering for ticket 005 and any schema changes):** the generated Drizzle migration uses `vector(1536)` column types, which require `CREATE EXTENSION vector` to already exist. The original plan ran `drizzle-kit migrate` first then `0000_init_extensions.sql` — that fails with `type "vector" does not exist`. Fixed by splitting the workflow:
    1. `psql ... -c 'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;'`
    2. `pnpm db:migrate`
    3. `psql ... -f drizzle/0000_init_extensions.sql` (idempotent — re-runs the extension creates harmlessly, then adds the `tsv` generated column + HNSW/trgm/tsv indexes).
  Header comment in `drizzle/0000_init_extensions.sql` updated to document this ordering so the next fresh environment doesn't repeat the mistake.
- Drizzle migration tag applied: `0000_fluffy_cable`.

### Verification output

```
=== TABLES ===          8 rows: books, chapters, chunks, entities, entity_mentions, eval_runs, events, summaries
=== EXTENSIONS ===      vector 0.8.0, pg_trgm 1.6, plpgsql 1.0
=== HNSW INDEX ===      chunks_embedding_hnsw_idx present
=== CHUNK COUNT ===     0
```

All acceptance criteria green.
