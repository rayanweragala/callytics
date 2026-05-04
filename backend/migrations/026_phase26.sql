-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft',
  -- status values: draft | scheduled | running | cancelling | completed | cancelled | failed
  flow_id         INTEGER REFERENCES call_flows(id) ON DELETE SET NULL,
  trunk_id        INTEGER REFERENCES sip_trunks(id) ON DELETE SET NULL,
  scheduled_at    TIMESTAMPTZ,
  max_concurrent  INTEGER NOT NULL DEFAULT 3,
  max_retries     INTEGER NOT NULL DEFAULT 2,
  retry_interval_minutes INTEGER NOT NULL DEFAULT 30,
  total_contacts  INTEGER NOT NULL DEFAULT 0,
  dialed_count    INTEGER NOT NULL DEFAULT 0,
  answered_count  INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Campaign contacts
CREATE TABLE IF NOT EXISTS campaign_contacts (
  id              SERIAL PRIMARY KEY,
  campaign_id     INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  phone_number    TEXT NOT NULL,
  name            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  -- status values: pending | dialing | answered | completed | no_answer | busy | failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-contact attempt history
CREATE TABLE IF NOT EXISTS campaign_contact_attempts (
  id              SERIAL PRIMARY KEY,
  campaign_id     INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id      INTEGER NOT NULL REFERENCES campaign_contacts(id) ON DELETE CASCADE,
  phone_number    TEXT NOT NULL,
  attempt_number  INTEGER NOT NULL,
  outcome         TEXT NOT NULL,
  -- outcome values: answered | no_answer | busy | failed | cancelled
  call_log_id     INTEGER REFERENCES call_logs(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ
);

-- Add direction column to call_logs if not exists
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'inbound';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_at ON campaigns(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign_id ON campaign_contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_status ON campaign_contacts(status);
CREATE INDEX IF NOT EXISTS idx_campaign_contact_attempts_contact_id ON campaign_contact_attempts(contact_id);
