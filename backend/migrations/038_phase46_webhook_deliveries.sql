CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id INTEGER REFERENCES call_flows(id) ON DELETE SET NULL,
  node_id VARCHAR(255),
  call_id VARCHAR(255),
  url VARCHAR NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  http_status INTEGER,
  response_body VARCHAR(500),
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error_message VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_flow_node
  ON webhook_deliveries(flow_id, node_id);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_call_id
  ON webhook_deliveries(call_id);
