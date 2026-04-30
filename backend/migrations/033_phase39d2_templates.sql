-- Phase 39d-2: add built-in templates for templates marketplace

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
    'After Hours IVR',
    'template-after-hours-ivr',
    'Route callers based on business hours. Play a closed message and send to voicemail outside working hours.',
    'published',
    'template',
    'after-hours',
    true,
    'Route callers based on business hours. Play a closed message and send to voicemail outside working hours.',
    'After Hours',
    NOW(),
    NOW()
  ),
  (
    'Sales Callback',
    'template-sales-callback',
    'Capture callback requests from interested callers with a simple keypress flow.',
    'published',
    'template',
    'sales',
    true,
    'Capture callback requests from interested callers with a simple keypress flow.',
    'Sales',
    NOW(),
    NOW()
  ),
  (
    'Appointment Reminder',
    'template-appointment-reminder',
    'Play a webhook-driven appointment confirmation and collect a keypress response.',
    'published',
    'template',
    'support',
    true,
    'Play a webhook-driven appointment confirmation and collect a keypress response.',
    'Support',
    NOW(),
    NOW()
  ),
  (
    'Simple Queue',
    'template-simple-queue',
    'Answer the call, play a welcome message, and place the caller in a queue.',
    'published',
    'template',
    'support',
    true,
    'Answer the call, play a welcome message, and place the caller in a queue.',
    'Support',
    NOW(),
    NOW()
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO flow_versions (flow_id, version_number, is_published, published_at, created_at, message, node_count)
SELECT cf.id, 1, true, NOW(), NOW(), 'Seeded Phase 39d-2 template', 0
FROM call_flows cf
WHERE cf.slug IN (
  'template-after-hours-ivr',
  'template-sales-callback',
  'template-appointment-reminder',
  'template-simple-queue'
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
    'template-after-hours-ivr',
    'template-sales-callback',
    'template-appointment-reminder',
    'template-simple-queue'
  )
  AND (
    cf.current_version_id IS DISTINCT FROM fv.id
    OR cf.status IS DISTINCT FROM 'published'
    OR cf.is_template IS DISTINCT FROM true
  );

-- Template 1: After Hours IVR
WITH template AS (
  SELECT cf.current_version_id AS flow_version_id
  FROM call_flows cf
  WHERE cf.slug = 'template-after-hours-ivr'
  LIMIT 1
), nodes_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'start', 'Start', 120::double precision, 180::double precision, '{}'::jsonb),
      ('business_hours_1', 'business_hours', 'Business Hours Check', 380::double precision, 180::double precision, '{"timezone":"Asia/Colombo","schedule":{"monday":{"enabled":true,"open":"09:00","close":"17:00"},"tuesday":{"enabled":true,"open":"09:00","close":"17:00"},"wednesday":{"enabled":true,"open":"09:00","close":"17:00"},"thursday":{"enabled":true,"open":"09:00","close":"17:00"},"friday":{"enabled":true,"open":"09:00","close":"17:00"},"saturday":{"enabled":false,"open":"09:00","close":"17:00"},"sunday":{"enabled":false,"open":"09:00","close":"17:00"}}}'::jsonb),
      ('open_audio_1', 'play_audio', 'Open Greeting', 680::double precision, 90::double precision, '{"audio_file_id":1}'::jsonb),
      ('open_transfer_1', 'transfer', 'Transfer to Front Desk', 980::double precision, 90::double precision, '{"target_type":"extension","target_value":"2001","timeout_ms":30000}'::jsonb),
      ('closed_audio_1', 'play_audio', 'Closed Message', 680::double precision, 280::double precision, '{"audio_file_id":1}'::jsonb),
      ('closed_voicemail_1', 'voicemail', 'After Hours Voicemail', 980::double precision, 280::double precision, '{"start_audio_id":1,"max_duration_seconds":60}'::jsonb)
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
  WHERE cf.slug = 'template-after-hours-ivr'
  LIMIT 1
), edges_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'business_hours_1', 'default', NULL::varchar),
      ('business_hours_1', 'open_audio_1', 'open', 'open'::varchar),
      ('open_audio_1', 'open_transfer_1', 'default', NULL::varchar),
      ('business_hours_1', 'closed_audio_1', 'closed', 'closed'::varchar),
      ('closed_audio_1', 'closed_voicemail_1', 'default', NULL::varchar)
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

-- Template 2: Sales Callback
WITH template AS (
  SELECT cf.current_version_id AS flow_version_id
  FROM call_flows cf
  WHERE cf.slug = 'template-sales-callback'
  LIMIT 1
), nodes_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'start', 'Start', 120::double precision, 180::double precision, '{}'::jsonb),
      ('intro_audio_1', 'play_audio', 'Sales Intro Message', 360::double precision, 180::double precision, '{"audio_file_id":1}'::jsonb),
      ('collect_interest_1', 'get_digits', 'Callback Keypress', 620::double precision, 180::double precision, '{"variable_name":"sales_interest","max_digits":1,"timeout_ms":5000}'::jsonb),
      ('decision_menu_1', 'menu', 'Callback Decision', 860::double precision, 180::double precision, '{"prompt_audio_file_id":1,"timeout_ms":5000,"branches":["1","2"],"max_timeout_attempts":2,"max_invalid_attempts":2}'::jsonb),
      ('callback_1', 'callback', 'Schedule Callback', 1120::double precision, 90::double precision, '{"number_source":"ani","destination_type":"extension","destination_value":"2100"}'::jsonb),
      ('hangup_1', 'hangup', 'End Call', 1120::double precision, 280::double precision, '{}'::jsonb)
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
  WHERE cf.slug = 'template-sales-callback'
  LIMIT 1
), edges_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'intro_audio_1', 'default', NULL::varchar),
      ('intro_audio_1', 'collect_interest_1', 'default', NULL::varchar),
      ('collect_interest_1', 'decision_menu_1', 'default', NULL::varchar),
      ('decision_menu_1', 'callback_1', '1', '1'::varchar),
      ('decision_menu_1', 'hangup_1', '2', '2'::varchar)
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

-- Template 3: Appointment Reminder
WITH template AS (
  SELECT cf.current_version_id AS flow_version_id
  FROM call_flows cf
  WHERE cf.slug = 'template-appointment-reminder'
  LIMIT 1
), nodes_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'start', 'Start', 120::double precision, 180::double precision, '{}'::jsonb),
      ('intro_audio_1', 'play_audio', 'Appointment Intro', 360::double precision, 180::double precision, '{"audio_file_id":1}'::jsonb),
      ('lookup_webhook_1', 'webhook', 'Appointment Lookup', 620::double precision, 180::double precision, '{"url":"https://example.com/api/appointments/lookup","method":"POST"}'::jsonb),
      ('response_digits_1', 'get_digits', 'Confirmation Input', 880::double precision, 180::double precision, '{"variable_name":"appointment_response","max_digits":1,"timeout_ms":5000}'::jsonb),
      ('response_menu_1', 'menu', 'Response Route', 1140::double precision, 180::double precision, '{"prompt_audio_file_id":1,"timeout_ms":5000,"branches":["1","2"],"max_timeout_attempts":2,"max_invalid_attempts":2}'::jsonb),
      ('confirmed_audio_1', 'play_audio', 'Confirmed Message', 1410::double precision, 90::double precision, '{"audio_file_id":1}'::jsonb),
      ('cancelled_audio_1', 'play_audio', 'Cancelled Message', 1410::double precision, 280::double precision, '{"audio_file_id":1}'::jsonb),
      ('confirmed_hangup_1', 'hangup', 'End Confirmed Call', 1670::double precision, 90::double precision, '{}'::jsonb),
      ('cancelled_hangup_1', 'hangup', 'End Cancelled Call', 1670::double precision, 280::double precision, '{}'::jsonb)
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
  WHERE cf.slug = 'template-appointment-reminder'
  LIMIT 1
), edges_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'intro_audio_1', 'default', NULL::varchar),
      ('intro_audio_1', 'lookup_webhook_1', 'default', NULL::varchar),
      ('lookup_webhook_1', 'response_digits_1', 'default', NULL::varchar),
      ('response_digits_1', 'response_menu_1', 'default', NULL::varchar),
      ('response_menu_1', 'confirmed_audio_1', '1', '1'::varchar),
      ('response_menu_1', 'cancelled_audio_1', '2', '2'::varchar),
      ('confirmed_audio_1', 'confirmed_hangup_1', 'default', NULL::varchar),
      ('cancelled_audio_1', 'cancelled_hangup_1', 'default', NULL::varchar)
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

-- Template 4: Simple Queue
WITH template AS (
  SELECT cf.current_version_id AS flow_version_id
  FROM call_flows cf
  WHERE cf.slug = 'template-simple-queue'
  LIMIT 1
), nodes_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'start', 'Start', 120::double precision, 180::double precision, '{}'::jsonb),
      ('welcome_audio_1', 'play_audio', 'Welcome Message', 380::double precision, 180::double precision, '{"audio_file_id":1}'::jsonb),
      ('queue_1', 'queue', 'Support Queue', 640::double precision, 180::double precision, '{"queue_id":1}'::jsonb),
      ('hangup_1', 'hangup', 'Hangup', 900::double precision, 180::double precision, '{}'::jsonb)
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
  WHERE cf.slug = 'template-simple-queue'
  LIMIT 1
), edges_to_insert AS (
  SELECT * FROM (
    VALUES
      ('start_1', 'welcome_audio_1', 'default', NULL::varchar),
      ('welcome_audio_1', 'queue_1', 'default', NULL::varchar),
      ('queue_1', 'hangup_1', 'done', 'done'::varchar)
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
    'template-after-hours-ivr',
    'template-sales-callback',
    'template-appointment-reminder',
    'template-simple-queue'
  );
