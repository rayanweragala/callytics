CREATE TABLE IF NOT EXISTS sip_packets (
  id           SERIAL PRIMARY KEY,
  call_id      VARCHAR(255),
  packet_data  JSONB NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sip_packets_call_id ON sip_packets(call_id);
CREATE INDEX IF NOT EXISTS idx_sip_packets_captured_at ON sip_packets(captured_at);
