CREATE TABLE IF NOT EXISTS settings (
  id                         INTEGER PRIMARY KEY,
  default_outbound_trunk_id  INTEGER REFERENCES sip_trunks(id) ON DELETE SET NULL,
  record_outbound_calls      BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO settings (id, default_outbound_trunk_id, record_outbound_calls)
VALUES (1, NULL, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS trunk_id INTEGER REFERENCES sip_trunks(id) ON DELETE SET NULL;

ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS recorded BOOLEAN NOT NULL DEFAULT false;
