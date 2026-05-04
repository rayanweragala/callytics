CREATE TABLE IF NOT EXISTS vpn_peers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  assigned_ip INET NOT NULL UNIQUE,
  public_key  TEXT NOT NULL UNIQUE,
  private_key TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vpn_peers_revoked_at
  ON vpn_peers(revoked_at);

ALTER TABLE sip_extensions
  ADD COLUMN IF NOT EXISTS vpn_only BOOLEAN NOT NULL DEFAULT FALSE;
