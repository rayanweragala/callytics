-- Phase 20: PSTN vs SIP endpoint separation

-- Add transport type to sip_extensions
ALTER TABLE sip_extensions
ADD COLUMN IF NOT EXISTS transport_type VARCHAR(20) NOT NULL DEFAULT 'sip';

ALTER TABLE sip_extensions
DROP CONSTRAINT IF EXISTS sip_extensions_transport_type_check;

ALTER TABLE sip_extensions
ADD CONSTRAINT sip_extensions_transport_type_check
CHECK (transport_type IN ('sip', 'webrtc'));

-- Create contact_numbers table for PSTN dial targets
CREATE TABLE IF NOT EXISTS contact_numbers (
  id         SERIAL PRIMARY KEY,
  label      VARCHAR(255) NOT NULL,
  number     VARCHAR(50)  NOT NULL,
  trunk_id   INTEGER REFERENCES sip_trunks(id) ON DELETE SET NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link operators to SIP extension and optional PSTN fallback
ALTER TABLE operators
ADD COLUMN IF NOT EXISTS extension_id INTEGER REFERENCES sip_extensions(id) ON DELETE SET NULL;

ALTER TABLE operators
ADD COLUMN IF NOT EXISTS contact_number_id INTEGER REFERENCES contact_numbers(id) ON DELETE SET NULL;

ALTER TABLE operators DROP COLUMN IF EXISTS pin;
ALTER TABLE operators DROP COLUMN IF EXISTS phone_number;

CREATE INDEX IF NOT EXISTS idx_contact_numbers_trunk_id ON contact_numbers(trunk_id);
CREATE INDEX IF NOT EXISTS idx_operators_extension_id ON operators(extension_id);
CREATE INDEX IF NOT EXISTS idx_operators_contact_number_id ON operators(contact_number_id);
CREATE INDEX IF NOT EXISTS idx_queues_wait_audio_file_id ON queues(wait_audio_file_id);
CREATE INDEX IF NOT EXISTS idx_queue_operators_operator_id ON queue_operators(operator_id);
