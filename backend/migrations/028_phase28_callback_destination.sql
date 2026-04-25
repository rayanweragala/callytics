ALTER TABLE callbacks
  ADD COLUMN IF NOT EXISTS destination_type TEXT,
  ADD COLUMN IF NOT EXISTS destination_value TEXT,
  ADD COLUMN IF NOT EXISTS destination_trunk_id INTEGER REFERENCES sip_trunks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_callbacks_destination_type
  ON callbacks(destination_type);
