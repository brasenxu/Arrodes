-- Hand-authored migration for features Drizzle can't model natively.
-- Run after `drizzle-kit migrate`.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- tsvector column + trigger (generated from contextual_prefix || content)
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(contextual_prefix, '') || ' ' || coalesce(content, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS chunks_trgm_idx ON chunks USING GIN (content gin_trgm_ops);

-- HNSW index for dense retrieval. m=16, ef_construction=64 — defaults work for
-- ~25k vectors at 1536d. Revisit if recall drops after ingest.
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS summaries_embedding_hnsw_idx
  ON summaries USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
