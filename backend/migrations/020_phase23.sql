CREATE TABLE IF NOT EXISTS call_quality (
  id           SERIAL PRIMARY KEY,
  call_id      VARCHAR(255) NOT NULL UNIQUE,
  mos          DECIMAL(4,2),
  jitter       DECIMAL(8,2),
  packet_loss  DECIMAL(6,2),
  rtt          DECIMAL(8,2),
  grade        VARCHAR(10),
  recorded_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_quality_call_id ON call_quality(call_id);
