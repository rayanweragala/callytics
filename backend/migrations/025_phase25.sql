CREATE TABLE IF NOT EXISTS preflight_runs (
  id          SERIAL PRIMARY KEY,
  ran_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  summary     TEXT NOT NULL,
  checks      JSONB NOT NULL
);
