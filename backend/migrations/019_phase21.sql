CREATE TABLE IF NOT EXISTS sip_messages (
  id            SERIAL PRIMARY KEY,
  call_id       VARCHAR(255),
  timestamp     TIMESTAMPTZ NOT NULL,
  method        VARCHAR(50),
  from_uri      TEXT,
  to_uri        TEXT,
  direction     VARCHAR(10),
  response_code INTEGER,
  raw_message   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sip_messages_call_id ON sip_messages(call_id);
CREATE INDEX IF NOT EXISTS idx_sip_messages_timestamp ON sip_messages(timestamp);
