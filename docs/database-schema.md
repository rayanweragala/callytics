# Database Schema

## audio_files
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| name | text | |
| source_type | text | upload or tts |
| original_filename | text | nullable |
| mime_type | text | nullable |
| duration_ms | integer | nullable |
| storage_path_original | text | nullable |
| storage_path_converted | text | nullable |
| storage_path_preview | text | nullable |
| conversion_status | text | |
| tts_text | text | nullable |
| tts_voice | text | nullable |
| speed | float | default 1.0, added phase 14 |
| created_by | text | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |

## call_flows
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| name | text | |
| slug | text | unique |
| description | text | nullable |
| status | text | draft, published, archived |
| entry_type | text | default, did, extension |
| entry_value | text | nullable |
| current_version_id | integer | nullable FK -> flow_versions.id |
| created_by | text | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |

## call_logs
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| call_uuid | text | |
| direction | text | inbound, outbound, internal |
| caller_number | text | nullable |
| callee_number | text | nullable |
| started_at | timestamptz | nullable |
| answered_at | timestamptz | nullable |
| ended_at | timestamptz | nullable |
| end_reason | text | nullable |
| duration_seconds | integer | nullable |
| talk_seconds | integer | nullable |
| wait_seconds | integer | nullable |
| flow_id | integer | nullable FK -> call_flows.id |
| flow_version_id | integer | nullable |
| entry_node_key | text | nullable |
| exit_node_key | text | nullable |
| queue_name | text | nullable |
| agent_extension | text | nullable |
| recording_path | text | nullable |
| voicemail_path | text | nullable |

## call_recordings
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| call_id | text | |
| channel_id | text | |
| flow_id | integer | nullable FK -> call_flows.id ON DELETE SET NULL |
| file_name | text | |
| file_path | text | |
| format | text | |
| duration_seconds | integer | nullable |
| started_at | timestamptz | nullable |
| ended_at | timestamptz | nullable |
| created_at | timestamptz | |

## flow_edges
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| flow_version_id | integer | FK -> flow_versions.id |
| source_node_key | text | |
| target_node_key | text | |
| branch_key | text | default, 0-9, timeout, invalid, success, failure |
| created_at | timestamptz | |

## flow_nodes
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| flow_version_id | integer | FK -> flow_versions.id |
| node_key | text | |
| type | text | start, play_audio, get_digits, menu, transfer, hunt, hangup, group |
| label | text | nullable |
| position_x | float | |
| position_y | float | |
| group_id | text | nullable, added phase 16 |
| config_json | jsonb | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |

## flow_versions
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| flow_id | integer | FK -> call_flows.id |
| version_number | integer | unique per flow |
| is_published | boolean | default false |
| published_at | timestamptz | nullable |
| message | text | nullable, user commit message |
| snapshot | jsonb | full node+edge snapshot |
| node_count | integer | |
| created_by | text | nullable |
| created_at | timestamptz | |

## inbound_routes
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| did | text | unique |
| label | text | nullable |
| flow_id | integer | FK -> call_flows.id |
| created_at | timestamptz | |

## sip_extensions
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| username | text | unique |
| password | text | |
| display_name | text | nullable |
| created_at | timestamptz | |

## sip_trunks
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| name | text | |
| provider_preset | text | nullable |
| host | text | |
| port | integer | default 5060 |
| username | text | nullable |
| password | text | nullable |
| from_domain | text | nullable |
| from_user | text | nullable |
| enabled | boolean | default true |
| created_at | timestamptz | |

## sip_messages
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| call_id | text | nullable |
| timestamp | timestamptz | |
| method | text | nullable |
| from_uri | text | nullable |
| to_uri | text | nullable |
| direction | text | inbound, outbound |
| response_code | integer | nullable |
| raw_message | text | nullable |
| created_at | timestamptz | default now() |

Indexes:
- `idx_sip_messages_call_id` on `(call_id)`
- `idx_sip_messages_timestamp` on `(timestamp)`
