CREATE SEQUENCE IF NOT EXISTS settings_id_seq;

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS key VARCHAR(255);

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS value TEXT;

ALTER TABLE settings
  ALTER COLUMN id SET DEFAULT nextval('settings_id_seq');

SELECT setval(
  'settings_id_seq',
  GREATEST(COALESCE((SELECT MAX(id) FROM settings), 0) + 1, 1),
  false
);

UPDATE settings
SET key = 'default_outbound_trunk_id',
    value = CASE
      WHEN default_outbound_trunk_id IS NULL THEN NULL
      ELSE default_outbound_trunk_id::text
    END
WHERE id = 1
  AND (key IS NULL OR key = '');

INSERT INTO settings (key, value)
SELECT 'record_outbound_calls', CASE WHEN legacy.record_outbound_calls THEN 'true' ELSE 'false' END
FROM settings legacy
WHERE legacy.id = 1
  AND NOT EXISTS (
    SELECT 1
    FROM settings
    WHERE key = 'record_outbound_calls'
  );

INSERT INTO settings (key, value)
SELECT 'recording_retention_days', '0'
WHERE NOT EXISTS (
  SELECT 1
  FROM settings
  WHERE key = 'recording_retention_days'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key_unique
ON settings(key);
