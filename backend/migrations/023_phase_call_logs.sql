CREATE TABLE IF NOT EXISTS call_logs (
  id               SERIAL PRIMARY KEY,
  call_uuid        VARCHAR(255) NOT NULL UNIQUE,
  direction        VARCHAR(50)  DEFAULT 'inbound',
  caller_number    VARCHAR(100),
  callee_number    VARCHAR(100),
  started_at       TIMESTAMP    DEFAULT now(),
  answered_at      TIMESTAMP,
  ended_at         TIMESTAMP,
  end_reason       VARCHAR(100),
  duration_seconds INTEGER,
  talk_seconds     INTEGER,
  flow_id          INTEGER,
  flow_version_id  INTEGER,
  entry_node_key   VARCHAR(255),
  exit_node_key    VARCHAR(255)
);