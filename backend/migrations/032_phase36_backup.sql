CREATE TABLE IF NOT EXISTS backup_history (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  CONSTRAINT backup_history_type_check CHECK (type IN ('full', 'db_only', 'recordings_only')),
  CONSTRAINT backup_history_status_check CHECK (status IN ('pending', 'running', 'complete', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_backup_history_created_at
  ON backup_history(created_at DESC);

CREATE TABLE IF NOT EXISTS backup_config (
  id INTEGER PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval VARCHAR(32) NOT NULL DEFAULT 'weekly',
  cron_expression VARCHAR(120),
  include_recordings BOOLEAN NOT NULL DEFAULT TRUE,
  retention_count INTEGER NOT NULL DEFAULT 5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT backup_config_singleton CHECK (id = 1),
  CONSTRAINT backup_config_interval_check CHECK (interval IN ('daily', 'weekly', 'custom'))
);

INSERT INTO backup_config (
  id,
  enabled,
  interval,
  cron_expression,
  include_recordings,
  retention_count,
  updated_at
)
VALUES (
  1,
  FALSE,
  'weekly',
  NULL,
  TRUE,
  5,
  NOW()
)
ON CONFLICT (id) DO NOTHING;
