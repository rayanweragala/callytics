# Database schema

This is a planning schema, not a migration. Field names may change slightly later, but the shape should stay close to this.

## `users`

- `id`
  Primary key
- `email`
  Login identity if email login is enabled
- `username`
  Local username for single-admin installs
- `password_hash`
  Stored password hash
- `role`
  `admin`, later `manager` or `viewer`
- `created_at`
- `updated_at`
- `last_login_at`

## `user_settings`

- `id`
- `user_id`
  Owner of the settings row
- `timezone`
- `locale`
- `default_tts_voice`
- `dashboard_filters`
  Saved UI filter preferences
- `created_at`
- `updated_at`

## `system_settings`

- `id`
- `business_name`
- `business_hours_json`
- `default_caller_id`
- `recording_retention_days`
- `local_ui_port`
- `api_port`
- `created_at`
- `updated_at`

## `sip_settings`

- `id`
- `provider_name`
- `host`
- `port`
- `username`
- `auth_id`
- `password_encrypted`
- `outbound_caller_id`
- `transport`
- `codecs_json`
- `registration_enabled`
- `registration_status`
- `last_registration_at`
- `created_at`
- `updated_at`

## `call_flows`

- `id`
- `name`
- `slug`
- `description`
- `status`
  `draft`, `published`, `archived`
- `entry_type`
  `default`, `did`, `extension`
- `entry_value`
  DID number or extension if used
- `current_version_id`
  Points to the active published version
- `created_by`
- `created_at`
- `updated_at`

## `flow_versions`

- `id`
- `flow_id`
- `version_number`
- `is_published`
- `published_at`
- `created_by`
- `created_at`

## `flow_nodes`

- `id`
- `flow_version_id`
- `node_key`
  Stable canvas node identifier
- `type`
- `label`
- `position_x`
- `position_y`
- `config_json`
  Node-specific settings such as prompt ID, queue name, timeout, mailbox
- `created_at`
- `updated_at`

## `flow_edges`

- `id`
- `flow_version_id`
- `source_node_key`
- `target_node_key`
- `branch_key`
  `default`, `1`, `2`, `timeout`, `invalid`, `success`, `failure`
- `created_at`

## `audio_files`

- `id`
- `name`
- `source_type`
  `upload` or `tts`
- `original_filename`
- `mime_type`
- `duration_ms`
- `storage_path_original`
- `storage_path_converted`
- `storage_path_preview`
- `conversion_status`
- `tts_text`
  Nullable, only for TTS assets
- `tts_voice`
  Nullable, only for TTS assets
- `created_by`
- `created_at`
- `updated_at`

## `audio_usage`

- `id`
- `audio_file_id`
- `flow_version_id`
- `node_key`
  Lets us answer where a file is used
- `created_at`

## `call_logs`

- `id`
- `call_uuid`
  Stable call ID from Asterisk or app mapping
- `direction`
  `inbound`, `outbound`, `internal`
- `caller_number`
- `callee_number`
- `started_at`
- `answered_at`
- `ended_at`
- `end_reason`
- `duration_seconds`
- `talk_seconds`
- `wait_seconds`
- `flow_id`
- `flow_version_id`
- `entry_node_key`
- `exit_node_key`
- `queue_name`
- `agent_extension`
- `recording_path`
- `voicemail_path`

## `call_events`

- `id`
- `call_log_id`
- `event_type`
  `ringing`, `answered`, `menu_selection`, `transfer`, `queue_enter`, `queue_leave`, `hangup`
- `event_time`
- `node_key`
- `payload_json`

## `live_call_state`

- `id`
- `call_uuid`
- `channel_name`
- `current_state`
- `current_node_key`
- `flow_id`
- `queue_name`
- `agent_extension`
- `caller_number`
- `started_at`
- `last_event_at`

This table can be mirrored from Redis and may be optional if Redis becomes the real source of truth. It is still useful to document the shape.

## `voicemails`

- `id`
- `call_log_id`
- `mailbox`
- `caller_number`
- `recording_path`
- `duration_seconds`
- `created_at`
- `heard_at`
- `deleted_at`

## `report_exports`

- `id`
- `report_type`
- `filters_json`
- `file_path`
- `created_by`
- `created_at`
