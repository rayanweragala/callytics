# API design

This API is for the localhost web UI. It is REST-first. Realtime updates for the dashboard go through Socket.io, not polling-only endpoints.

## Flows

### Current thin-slice endpoints implemented in Phase 7

### `GET /flows`

- What it does:
  Returns all flows as thin summaries for the builder and diagnostics UI
- Input:
  None
- Returns:
  `{ data: FlowSummary[], total: number }`
- Current summary fields:
  - `id`
  - `name`
  - `description`
  - `createdAt`

### `GET /flows/:id`

- What it does:
  Returns one flow with the latest active version, including all nodes and edges
- Input:
  Flow ID in the path
- Returns:
  `{ data: FlowDetail }`
- Current detail fields:
  - flow metadata
  - `versionId`
  - `versionNumber`
  - `nodes[]`
  - `edges[]`

### `POST /flows`

- What it does:
  Creates a new flow and its initial version, then stores all provided nodes and edges in that version
- Input:
  - `name`
  - `description?`
  - `slug?`
  - `nodes[]`
  - `edges[]`
- Returns:
  `{ data: FlowDetail }`

### `PUT /flows/:id`

- What it does:
  Updates a flow by creating a new latest version and replacing nodes and edges in that version
- Input:
  - `name`
  - `description?`
  - `slug?`
  - `nodes[]`
  - `edges[]`
- Returns:
  `{ data: FlowDetail }`

### `DELETE /flows/:id`

- What it does:
  Deletes the flow and removes its related versions, nodes, and edges
- Input:
  Flow ID in the path
- Returns:
  `{ data: { id: number, deleted: true } }`

### Thin-slice notes

- This is intentionally not the full long-term API yet
- The builder now has real persistence instead of mock data
- The backend currently works against the existing Phase 4 schema:
  - `call_flows`
  - `flow_versions`
  - `flow_nodes`
  - `flow_edges`
- The API uses the latest version per flow through `current_version_id`
- Authentication, pagination, publish workflows, and rollback endpoints can be added later without changing the basic response contract

### Planned later flow endpoints

- `GET /api/flows/:flowId/draft`
- `PUT /api/flows/:flowId/draft`
- `POST /api/flows/:flowId/validate`
- `POST /api/flows/:flowId/publish`
- `POST /api/flows/:flowId/rollback`

## Audio

### `GET /api/audio`

- What it does:
  Returns audio library entries
- Input:
  Optional filters for search, source type, and status
- Returns:
  Audio file summaries with duration, source, and usage count

### `POST /api/audio/upload`

- What it does:
  Uploads one audio file
- Input:
  Multipart file upload and optional tags
- Returns:
  Audio asset record with conversion status

### `POST /api/audio/tts`

- What it does:
  Generates a new audio asset from text
- Input:
  Text, voice, and optional speaking rate settings
- Returns:
  Audio asset record with generation status

### `GET /api/audio/:audioId`

- What it does:
  Returns full metadata for one audio asset
- Input:
  Audio ID in the path
- Returns:
  Metadata, usage references, and preview URL

### `PUT /api/audio/:audioId`

- What it does:
  Updates metadata such as display name or tags
- Input:
  Editable metadata fields
- Returns:
  Updated audio asset

### `POST /api/audio/:audioId/replace`

- What it does:
  Replaces the file contents while keeping the logical asset
- Input:
  Multipart file upload
- Returns:
  Updated asset with fresh conversion status

### `DELETE /api/audio/:audioId`

- What it does:
  Deletes an audio asset if safe
- Input:
  Audio ID in the path
- Returns:
  Success flag or a blocking reason if the file is used in a published flow

## Calls

### `GET /api/calls/live`

- What it does:
  Returns the current live call list as a snapshot
- Input:
  Optional filters for queue or state
- Returns:
  Active calls and queue summary data

### `GET /api/calls/history`

- What it does:
  Returns historical call logs
- Input:
  Date range, direction, flow, queue, answered status, and pagination
- Returns:
  Paginated call log rows

### `GET /api/calls/:callId`

- What it does:
  Returns one call record and its event timeline
- Input:
  Call ID in the path
- Returns:
  Full call detail with related events and voicemail or recording links if present

## Reports

### `GET /api/reports/call-volume`

- What it does:
  Returns grouped call counts over time
- Input:
  Date range and grouping level such as hour or day
- Returns:
  Time buckets with inbound, outbound, answered, missed, and abandoned counts

### `GET /api/reports/missed-calls`

- What it does:
  Returns missed call rows
- Input:
  Date range, flow, queue, and pagination
- Returns:
  List of missed calls with timestamp, caller ID, and missed reason

### `GET /api/reports/answered-calls`

- What it does:
  Returns answered call rows
- Input:
  Date range, agent, queue, and pagination
- Returns:
  List of answered calls with answer and talk durations

### `GET /api/reports/voicemails`

- What it does:
  Returns voicemail activity
- Input:
  Date range, mailbox, and pagination
- Returns:
  Rows with caller, mailbox, timestamp, and recording reference

### `GET /api/reports/flow-performance`

- What it does:
  Returns per-flow and per-node traffic metrics
- Input:
  Flow ID and date range
- Returns:
  Entry counts, branch counts, completion counts, and node drop-off stats

### `POST /api/reports/export`

- What it does:
  Queues a CSV export
- Input:
  Report type and filters
- Returns:
  Export job record and later a downloadable file reference

## Settings

### `GET /api/settings/system`

- What it does:
  Returns system-wide settings
- Input:
  None
- Returns:
  Business hours, ports, retention rules, timezone, and defaults

### `PUT /api/settings/system`

- What it does:
  Updates system-wide settings
- Input:
  Editable settings fields
- Returns:
  Updated settings

### `GET /api/settings/sip`

- What it does:
  Returns SIP trunk settings and current registration status
- Input:
  None
- Returns:
  Sanitized trunk configuration and status

### `PUT /api/settings/sip`

- What it does:
  Creates or updates SIP trunk settings
- Input:
  Provider connection fields and enable flag
- Returns:
  Saved settings and validation status

### `POST /api/settings/sip/test`

- What it does:
  Runs a connection or registration test against the configured trunk
- Input:
  Optional dry-run flag
- Returns:
  Success or failure plus diagnostic details

### `GET /api/settings/me`

- What it does:
  Returns the current user profile and personal UI settings
- Input:
  None
- Returns:
  User summary and saved preferences

### `PUT /api/settings/me`

- What it does:
  Updates the current user profile or UI preferences
- Input:
  Editable profile and settings fields
- Returns:
  Updated user summary and preferences


### Phase 6 builder integration note

The React Flow builder now uses the current thin-slice flow endpoints directly from the browser:

- `/flows` for list/create/delete flows
- `/flows/:id` for loading and saving a single flow

The current editor persists:

- flow name and description
- node positions
- node labels
- node config
- edges and edge reconnection changes
