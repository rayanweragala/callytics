CREATE TABLE IF NOT EXISTS sip_trunks (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  provider_preset VARCHAR(50) NOT NULL DEFAULT 'generic',
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 5060,
  username VARCHAR(255),
  password VARCHAR(255),
  from_domain VARCHAR(255),
  from_user VARCHAR(255),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
