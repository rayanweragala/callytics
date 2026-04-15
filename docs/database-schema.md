# Database schema

This started as a planning schema, but Phase 4 now includes a real runtime migration in the Stasis app that creates the initial flow-execution tables on startup.

Tables currently created by the Stasis migration:

- `call_flows`
- `flow_versions`
- `flow_nodes`
- `flow_edges`
- `call_logs`

Other tables in this document are still planning targets for later phases.

Phase 7 API note:

- The first flow CRUD API now works directly against `call_flows`, `flow_versions`, `flow_nodes`, and `flow_edges`
- The backend uses `current_version_id` to resolve the latest version returned to the builder

Phase 8 audio note:

- The `audio_files` table is now implemented and active in the backend
- NestJS writes audio asset records there for uploads and offline TTS generation
- Stasis now resolves `audio_file_id` from the database before playback

Phase 11 recording note:

- The `call_recordings` table is now implemented and active in the backend
- Stasis persists one row per completed inbound bridge recording through `POST /recordings/internal`
- Recording files are stored in the shared `asterisk_recordings` Docker volume

Phase 13 extension and routing note:

- The `sip_extensions` table is now implemented and active in the backend
- The `inbound_routes` table is now implemented and active in the backend
- NestJS regenerates managed PJSIP and inbound dialplan include files in `/etc/asterisk` from those tables on startup and after CRUD changes
- Managed extension generation now uses the same object name for the endpoint and AOR (`[2001]` endpoint plus `[2001]` AOR with `aors=2001`), matching the working static phone pattern and fixing PJSIP registrar lookups

Phase 14 trunk note:

- The `sip_trunks` table is now implemented and active in the backend
- NestJS regenerates `/etc/asterisk/pjsip_callytics_trunks.conf` from enabled DB rows on startup and after trunk CRUD changes
- Managed `pjsip.conf` include normalization now removes any older managed include placement and re-appends both generated extension and trunk includes as the final top-level lines in the file to avoid stanza-nesting regressions during Asterisk load

Phase 16 note:

- `flow_nodes.group_id` is now implemented for flow builder group membership
- `flow_versions` now stores `message`, `snapshot`, and `node_count` for commit history, compare, and restore
- `flow_versions(flow_id, version_number)` now has a unique index to enforce deterministic version numbering

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

## `sip_trunks`

This table is now implemented and active.

- `id`
- `name`
- `provider_preset`
- `host`
- `port`
- `username`
  Nullable. Blank means generate endpoint + AOR only without registration/auth objects.
- `password`
  Nullable. Used only when `username` is present.
- `from_domain`
- `from_user`
- `enabled`
- `created_at`

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
- `message`
  Commit message for this version (`Saved from editor`, custom commit text, or restore message)
- `snapshot`
  JSON snapshot of nodes and edges for compare and restore
- `node_count`
  Snapshot node count used by version list UI metadata
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
- `group_id`
  Nullable parent group node key for visual grouping in the flow builder
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

This table is now implemented and active.

- `id`
- `name`
- `source_type`
  `upload` or `tts`
- `original_filename`
- `mime_type`
- `duration_ms`
- `storage_path_original`
  Source upload or raw TTS WAV path
- `storage_path_converted`
  Telephony WAV path mounted into Asterisk
- `storage_path_preview`
  Browser-preview WAV path served by NestJS
- `conversion_status`
- `tts_text`
  Nullable, only for TTS assets
- `tts_voice`
  Nullable, only for TTS assets
- `speed`
  Float. Defaults to `1.0` and records the requested browser speed setting used for TTS generation.
- `created_by`
- `created_at`
- `updated_at`

## `audio_usage`

This table is still planned and not currently implemented in the backend. Current delete protection is done by querying `flow_nodes.config_json` directly.

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

The current runtime migration creates a smaller initial version of this table focused on:

- core call identity
- direction
- caller and callee numbers
- start, answer, and end timestamps
- end reason
- duration and talk seconds
- linked flow and flow version
- entry and exit node keys

## `call_recordings`

This table is now implemented and active.

- `id`
- `call_id`
  ARI/Stasis call identifier, currently matching the inbound channel ID
- `channel_id`
  Inbound channel recorded for the call
- `flow_id`
  Nullable foreign key to `call_flows(id)` with `ON DELETE SET NULL`
- `file_name`
  Recording basename such as `1776099073.26.wav`
- `file_path`
  Backend-readable path, currently `/var/lib/asterisk/recording/<name>.wav`
- `format`
  Current default is `wav`
- `duration_seconds`
- `started_at`
- `ended_at`
- `created_at`

Current indexes created by the backend startup migration:

- `idx_call_recordings_call_id`
- `idx_call_recordings_created_at`

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
