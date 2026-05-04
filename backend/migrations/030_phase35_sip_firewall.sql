CREATE TABLE IF NOT EXISTS blocked_ips (
  id               SERIAL PRIMARY KEY,
  ip               INET NOT NULL UNIQUE,
  country_code     TEXT NOT NULL DEFAULT 'unknown',
  country_name     TEXT NOT NULL DEFAULT 'Unknown',
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  reason           TEXT NOT NULL,
  enforcement_mode TEXT NOT NULL DEFAULT 'iptables',
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_whitelisted   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_blocked_ips_created_at
  ON blocked_ips(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blocked_ips_whitelisted
  ON blocked_ips(is_whitelisted);

CREATE TABLE IF NOT EXISTS firewall_events (
  id           SERIAL PRIMARY KEY,
  ip           INET NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'unknown',
  country_name TEXT NOT NULL DEFAULT 'Unknown',
  event_type   TEXT NOT NULL CHECK (event_type IN ('blocked', 'allowed', 'whitelisted')),
  reason       TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_firewall_events_created_at
  ON firewall_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_firewall_events_type
  ON firewall_events(event_type);

CREATE TABLE IF NOT EXISTS firewall_stats (
  id             SERIAL PRIMARY KEY,
  date           DATE NOT NULL UNIQUE,
  total_blocked  INTEGER NOT NULL DEFAULT 0,
  total_attempts INTEGER NOT NULL DEFAULT 0,
  top_countries  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS firewall_config (
  id                     INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enforcement_mode       TEXT NOT NULL DEFAULT 'iptables',
  threshold              INTEGER NOT NULL DEFAULT 5,
  time_window_seconds    INTEGER NOT NULL DEFAULT 300,
  block_duration_seconds INTEGER,
  trunk_ceilings         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO firewall_config (id, enforcement_mode, threshold, time_window_seconds, block_duration_seconds)
VALUES (1, 'iptables', 5, 300, 86400)
ON CONFLICT (id) DO NOTHING;
