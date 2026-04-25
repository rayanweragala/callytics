CREATE TABLE IF NOT EXISTS callbacks (
  id              SERIAL PRIMARY KEY,
  flow_id         INTEGER REFERENCES call_flows(id) ON DELETE SET NULL,
  trunk_id        INTEGER REFERENCES sip_trunks(id) ON DELETE SET NULL,
  customer_number TEXT NOT NULL,
  operator_id     INTEGER REFERENCES operators(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  fail_reason     TEXT,
  call_log_id     INTEGER REFERENCES call_logs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at     TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);

ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS callback_number TEXT,
  ADD COLUMN IF NOT EXISTS callback_trunk_id INTEGER REFERENCES sip_trunks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_callbacks_status ON callbacks(status);
CREATE INDEX IF NOT EXISTS idx_callbacks_created_at ON callbacks(created_at DESC);
