-- Phase 20: operators, queues, queue_operators

CREATE TABLE IF NOT EXISTS operators (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  pin_hash     TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queues (
  id                 SERIAL PRIMARY KEY,
  name               VARCHAR(255) NOT NULL,
  slug               VARCHAR(255) UNIQUE NOT NULL,
  wait_audio_file_id INTEGER REFERENCES audio_files(id) ON DELETE SET NULL,
  max_wait_seconds   INTEGER NOT NULL DEFAULT 300,
  pin_retry_attempts INTEGER NOT NULL DEFAULT 3,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queue_operators (
  queue_id    INTEGER NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  operator_id INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  PRIMARY KEY (queue_id, operator_id)
);
