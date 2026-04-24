-- Phase 19: execution traces, recording type, and template marketplace seeds

-- call_node_logs: records every node visited per call
CREATE TABLE IF NOT EXISTS call_node_logs (
  id            SERIAL PRIMARY KEY,
  call_uuid     TEXT NOT NULL,
  flow_id       INTEGER NOT NULL REFERENCES call_flows(id),
  node_key      TEXT NOT NULL,
  node_type     TEXT NOT NULL,
  entered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exited_at     TIMESTAMPTZ,
  exit_branch   TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_call_node_logs_call_uuid ON call_node_logs(call_uuid);

-- Add recording_type to call_recordings
CREATE TABLE IF NOT EXISTS call_recordings (
  id SERIAL PRIMARY KEY,
  call_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,
  flow_id INTEGER REFERENCES call_flows(id) ON DELETE SET NULL,
  file_name VARCHAR(500) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  format VARCHAR(20) NOT NULL DEFAULT 'wav',
  duration_seconds INTEGER,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE call_recordings
  ADD COLUMN IF NOT EXISTS recording_type TEXT NOT NULL DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS call_log_id INTEGER;

-- IVR template metadata stored on call_flows
ALTER TABLE call_flows
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_description TEXT,
  ADD COLUMN IF NOT EXISTS template_category TEXT;

-- ---------------------------------------------------------------------------
-- Template flow seed rows
-- ---------------------------------------------------------------------------
INSERT INTO call_flows (
  name,
  slug,
  description,
  status,
  entry_type,
  entry_value,
  is_template,
  template_description,
  template_category,
  created_at,
  updated_at
)
VALUES
  (
    'Medical Clinic IVR Template',
    'template-medical-clinic-ivr',
    'Business hours check with appointment booking menu and emergency transfer',
    'published',
    'template',
    'clinic',
    true,
    'Business hours check with appointment booking menu and emergency transfer',
    'clinic',
    NOW(),
    NOW()
  ),
  (
    'Restaurant IVR Template',
    'template-restaurant-ivr',
    'Reservations, hours, and location with staff transfer option',
    'published',
    'template',
    'restaurant',
    true,
    'Reservations, hours, and location with staff transfer option',
    'restaurant',
    NOW(),
    NOW()
  ),
  (
    'Dispatch Hotline Template',
    'template-dispatch-hotline',
    'Priority routing with on-call transfer and voicemail fallback',
    'published',
    'template',
    'dispatch',
    true,
    'Priority routing with on-call transfer and voicemail fallback',
    'dispatch',
    NOW(),
    NOW()
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO flow_versions (flow_id, version_number, is_published, published_at, created_at, message, node_count)
SELECT cf.id, 1, true, NOW(), NOW(), 'Seeded Phase 19 template', 0
FROM call_flows cf
WHERE cf.slug IN (
  'template-medical-clinic-ivr',
  'template-restaurant-ivr',
  'template-dispatch-hotline'
)
AND NOT EXISTS (
  SELECT 1 FROM flow_versions fv WHERE fv.flow_id = cf.id
);

UPDATE call_flows cf
SET current_version_id = fv.id,
    status = 'published',
    is_template = true
FROM flow_versions fv
WHERE fv.flow_id = cf.id
  AND cf.slug IN (
    'template-medical-clinic-ivr',
    'template-restaurant-ivr',
    'template-dispatch-hotline'
  )
  AND (
    cf.current_version_id IS DISTINCT FROM fv.id
    OR cf.status IS DISTINCT FROM 'published'
    OR cf.is_template IS DISTINCT FROM true
  );

-- ---------------------------------------------------------------------------
-- Template 1: Medical Clinic IVR
-- ---------------------------------------------------------------------------
WITH template AS (
  SELECT cf.id AS flow_id, cf.current_version_id AS flow_version_id
  FROM call_flows cf
  WHERE cf.slug = 'template-medical-clinic-ivr'
  LIMIT 1
), nodes_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'start', 'Start', 120::double precision, 140::double precision, '{}'::jsonb),
      ('biz_hours_1', 'business_hours', 'Business Hours', 360::double precision, 140::double precision, '{"timezone":"Asia/Colombo","schedule":{"monday":{"enabled":true,"open":"09:00","close":"17:00"},"tuesday":{"enabled":true,"open":"09:00","close":"17:00"},"wednesday":{"enabled":true,"open":"09:00","close":"17:00"},"thursday":{"enabled":true,"open":"09:00","close":"17:00"},"friday":{"enabled":true,"open":"09:00","close":"17:00"},"saturday":{"enabled":false,"open":"09:00","close":"17:00"},"sunday":{"enabled":false,"open":"09:00","close":"17:00"}}}'::jsonb),
      ('menu_1', 'menu', 'Main Menu', 620::double precision, 100::double precision, '{"timeout_ms":5000,"prompt_path":"","prompt_audio_file_id":"","timeout_prompt_audio_id":"","invalid_prompt_audio_id":"","final_failure_audio_id":"","max_timeout_attempts":3,"max_invalid_attempts":3,"branches":["1","2","9"],"submenu_branch_targets":{}}'::jsonb),
      ('transfer_appointments_1', 'transfer', 'Appointments', 900::double precision, 40::double precision, '{"destination":"PJSIP/2001","timeout_ms":30000,"on_no_answer":""}'::jsonb),
      ('play_location_hours_1', 'play_audio', 'Location & Hours', 900::double precision, 130::double precision, '{"audio_file_path":"custom/clinic-location-hours","audio_file_id":""}'::jsonb),
      ('transfer_emergency_1', 'transfer', 'Emergency Transfer', 900::double precision, 220::double precision, '{"destination":"PJSIP/2999","timeout_ms":15000,"on_no_answer":""}'::jsonb),
      ('play_after_hours_1', 'play_audio', 'After Hours Message', 620::double precision, 270::double precision, '{"audio_file_path":"custom/clinic-after-hours","audio_file_id":""}'::jsonb),
      ('hangup_1', 'hangup', 'Hangup', 1160::double precision, 160::double precision, '{}'::jsonb)
  ) AS t(node_key, type, label, position_x, position_y, config_json)
)
INSERT INTO flow_nodes (flow_version_id, node_key, type, label, position_x, position_y, config_json)
SELECT template.flow_version_id, n.node_key, n.type, n.label, n.position_x, n.position_y, n.config_json
FROM template
JOIN nodes_to_insert n ON true
WHERE template.flow_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM flow_nodes existing
    WHERE existing.flow_version_id = template.flow_version_id
      AND existing.node_key = n.node_key
  );

WITH template AS (
  SELECT cf.current_version_id AS flow_version_id
  FROM call_flows cf
  WHERE cf.slug = 'template-medical-clinic-ivr'
  LIMIT 1
), edges_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'biz_hours_1', 'default', NULL::varchar),
      ('biz_hours_1', 'menu_1', 'open', 'open'::varchar),
      ('biz_hours_1', 'play_after_hours_1', 'closed', 'closed'::varchar),
      ('menu_1', 'transfer_appointments_1', '1', '1'::varchar),
      ('menu_1', 'play_location_hours_1', '2', '2'::varchar),
      ('menu_1', 'transfer_emergency_1', '9', '9'::varchar),
      ('transfer_appointments_1', 'hangup_1', 'done', 'done'::varchar),
      ('play_location_hours_1', 'hangup_1', 'default', NULL::varchar),
      ('transfer_emergency_1', 'hangup_1', 'done', 'done'::varchar),
      ('play_after_hours_1', 'hangup_1', 'default', NULL::varchar)
  ) AS t(source_node_key, target_node_key, branch_key, condition)
)
INSERT INTO flow_edges (flow_version_id, source_node_key, target_node_key, branch_key, condition)
SELECT template.flow_version_id, e.source_node_key, e.target_node_key, e.branch_key, e.condition
FROM template
JOIN edges_to_insert e ON true
WHERE template.flow_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM flow_edges existing
    WHERE existing.flow_version_id = template.flow_version_id
      AND existing.source_node_key = e.source_node_key
      AND existing.target_node_key = e.target_node_key
      AND COALESCE(existing.condition, '') = COALESCE(e.condition, '')
  );

-- ---------------------------------------------------------------------------
-- Template 2: Restaurant IVR
-- ---------------------------------------------------------------------------
WITH template AS (
  SELECT cf.current_version_id AS flow_version_id
  FROM call_flows cf
  WHERE cf.slug = 'template-restaurant-ivr'
  LIMIT 1
), nodes_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'start', 'Start', 120::double precision, 140::double precision, '{}'::jsonb),
      ('welcome_audio_1', 'play_audio', 'Welcome Message', 360::double precision, 140::double precision, '{"audio_file_path":"custom/restaurant-welcome","audio_file_id":""}'::jsonb),
      ('menu_1', 'menu', 'Main Menu', 620::double precision, 140::double precision, '{"timeout_ms":5000,"prompt_path":"","prompt_audio_file_id":"","timeout_prompt_audio_id":"","invalid_prompt_audio_id":"","final_failure_audio_id":"","max_timeout_attempts":3,"max_invalid_attempts":3,"branches":["1","2","3"],"submenu_branch_targets":{}}'::jsonb),
      ('transfer_reservations_1', 'transfer', 'Reservations', 900::double precision, 60::double precision, '{"destination":"PJSIP/3101","timeout_ms":25000,"on_no_answer":""}'::jsonb),
      ('play_hours_location_1', 'play_audio', 'Hours & Location', 900::double precision, 150::double precision, '{"audio_file_path":"custom/restaurant-hours-location","audio_file_id":""}'::jsonb),
      ('transfer_staff_1', 'transfer', 'Speak to Staff', 900::double precision, 240::double precision, '{"destination":"PJSIP/3102","timeout_ms":25000,"on_no_answer":""}'::jsonb),
      ('hangup_1', 'hangup', 'Hangup', 1160::double precision, 160::double precision, '{}'::jsonb)
  ) AS t(node_key, type, label, position_x, position_y, config_json)
)
INSERT INTO flow_nodes (flow_version_id, node_key, type, label, position_x, position_y, config_json)
SELECT template.flow_version_id, n.node_key, n.type, n.label, n.position_x, n.position_y, n.config_json
FROM template
JOIN nodes_to_insert n ON true
WHERE template.flow_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM flow_nodes existing
    WHERE existing.flow_version_id = template.flow_version_id
      AND existing.node_key = n.node_key
  );

WITH template AS (
  SELECT cf.current_version_id AS flow_version_id
  FROM call_flows cf
  WHERE cf.slug = 'template-restaurant-ivr'
  LIMIT 1
), edges_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'welcome_audio_1', 'default', NULL::varchar),
      ('welcome_audio_1', 'menu_1', 'default', NULL::varchar),
      ('menu_1', 'transfer_reservations_1', '1', '1'::varchar),
      ('menu_1', 'play_hours_location_1', '2', '2'::varchar),
      ('menu_1', 'transfer_staff_1', '3', '3'::varchar),
      ('transfer_reservations_1', 'hangup_1', 'done', 'done'::varchar),
      ('play_hours_location_1', 'hangup_1', 'default', NULL::varchar),
      ('transfer_staff_1', 'hangup_1', 'done', 'done'::varchar)
  ) AS t(source_node_key, target_node_key, branch_key, condition)
)
INSERT INTO flow_edges (flow_version_id, source_node_key, target_node_key, branch_key, condition)
SELECT template.flow_version_id, e.source_node_key, e.target_node_key, e.branch_key, e.condition
FROM template
JOIN edges_to_insert e ON true
WHERE template.flow_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM flow_edges existing
    WHERE existing.flow_version_id = template.flow_version_id
      AND existing.source_node_key = e.source_node_key
      AND existing.target_node_key = e.target_node_key
      AND COALESCE(existing.condition, '') = COALESCE(e.condition, '')
  );

-- ---------------------------------------------------------------------------
-- Template 3: Dispatch Hotline
-- ---------------------------------------------------------------------------
WITH template AS (
  SELECT cf.current_version_id AS flow_version_id
  FROM call_flows cf
  WHERE cf.slug = 'template-dispatch-hotline'
  LIMIT 1
), nodes_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'start', 'Start', 120::double precision, 140::double precision, '{}'::jsonb),
      ('menu_1', 'menu', 'Dispatch Menu', 360::double precision, 140::double precision, '{"timeout_ms":5000,"prompt_path":"","prompt_audio_file_id":"","timeout_prompt_audio_id":"","invalid_prompt_audio_id":"","final_failure_audio_id":"","max_timeout_attempts":2,"max_invalid_attempts":2,"branches":["1","2","3"],"submenu_branch_targets":{}}'::jsonb),
      ('transfer_emergency_1', 'transfer', 'Emergency Dispatch', 640::double precision, 50::double precision, '{"destination":"PJSIP/4001","timeout_ms":15000,"on_no_answer":""}'::jsonb),
      ('transfer_nonurgent_1', 'transfer', 'Non-Urgent Queue', 640::double precision, 140::double precision, '{"destination":"PJSIP/4002","timeout_ms":20000,"on_no_answer":""}'::jsonb),
      ('voicemail_1', 'voicemail', 'Leave Voicemail', 640::double precision, 230::double precision, '{"mailbox_name":"dispatch","max_duration_seconds":60,"prompt_audio_file_id":null}'::jsonb),
      ('hangup_1', 'hangup', 'Hangup', 900::double precision, 140::double precision, '{}'::jsonb)
  ) AS t(node_key, type, label, position_x, position_y, config_json)
)
INSERT INTO flow_nodes (flow_version_id, node_key, type, label, position_x, position_y, config_json)
SELECT template.flow_version_id, n.node_key, n.type, n.label, n.position_x, n.position_y, n.config_json
FROM template
JOIN nodes_to_insert n ON true
WHERE template.flow_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM flow_nodes existing
    WHERE existing.flow_version_id = template.flow_version_id
      AND existing.node_key = n.node_key
  );

WITH template AS (
  SELECT cf.current_version_id AS flow_version_id
  FROM call_flows cf
  WHERE cf.slug = 'template-dispatch-hotline'
  LIMIT 1
), edges_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'menu_1', 'default', NULL::varchar),
      ('menu_1', 'transfer_emergency_1', '1', '1'::varchar),
      ('menu_1', 'transfer_nonurgent_1', '2', '2'::varchar),
      ('menu_1', 'voicemail_1', '3', '3'::varchar),
      ('transfer_emergency_1', 'hangup_1', 'done', 'done'::varchar),
      ('transfer_nonurgent_1', 'hangup_1', 'done', 'done'::varchar),
      ('voicemail_1', 'hangup_1', 'done', 'done'::varchar)
  ) AS t(source_node_key, target_node_key, branch_key, condition)
)
INSERT INTO flow_edges (flow_version_id, source_node_key, target_node_key, branch_key, condition)
SELECT template.flow_version_id, e.source_node_key, e.target_node_key, e.branch_key, e.condition
FROM template
JOIN edges_to_insert e ON true
WHERE template.flow_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM flow_edges existing
    WHERE existing.flow_version_id = template.flow_version_id
      AND existing.source_node_key = e.source_node_key
      AND existing.target_node_key = e.target_node_key
      AND COALESCE(existing.condition, '') = COALESCE(e.condition, '')
  );

-- Keep node_count current for seeded template versions
UPDATE flow_versions fv
SET node_count = counts.node_count
FROM (
  SELECT fn.flow_version_id, COUNT(*)::int AS node_count
  FROM flow_nodes fn
  GROUP BY fn.flow_version_id
) counts
JOIN call_flows cf ON cf.current_version_id = counts.flow_version_id
WHERE fv.id = counts.flow_version_id
  AND cf.slug IN (
    'template-medical-clinic-ivr',
    'template-restaurant-ivr',
    'template-dispatch-hotline'
  );
