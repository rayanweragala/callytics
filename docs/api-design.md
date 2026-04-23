# API design

This API is for the localhost web UI. It is REST-first. Realtime updates for the dashboard go through Socket.io, not polling-only endpoints.

## Flows

### Current thin-slice endpoints implemented in Phase 7

### `GET /flows`

- What it does:
  Returns all flows as thin summaries for the builder and diagnostics UI
- Input:
  `page` and `limit` query parameters
- Returns:
  `{ data, total, page, limit, totalPages }`
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
  - `versionMessage?`
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
  - `versionMessage?`
  - `nodes[]`
  - `edges[]`
- Returns:
  `{ data: FlowDetail }`

### `GET /flows/:id/versions`

- What it does:
  Lists committed versions for one flow
- Input:
  Flow ID in the path
- Returns:
  `{ data: FlowVersionSummary[] }`

### `GET /flows/:id/versions/:versionId`

- What it does:
  Returns one committed version including its snapshot
- Input:
  Flow ID and version ID in the path
- Returns:
  `{ data: FlowVersionDetail }`

### `POST /flows/:id/versions`

- What it does:
  Creates an explicit committed version using the flow's current graph state
- Input:
  - `message`
- Returns:
  `{ data: FlowVersionSummary }`

### `POST /flows/:id/versions/:versionId/restore`

- What it does:
  Restores a committed version snapshot into the current flow state and writes a new version entry
- Input:
  Flow ID and version ID in the path
- Returns:
  `{ data: { success: true } }`

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

### Flow versioning notes

- The API now supports commit/list/detail/restore for flow versions
- `POST /flows` and `PUT /flows/:id` also create visible committed versions for editor saves
- Version snapshots are stored in `flow_versions.snapshot` with message and node count metadata

## Audio

### `GET /audio?page=X&limit=Y`

- What it does:
  Returns the audio library as a paginated list
- Input:
  `page` and `limit` query parameters
- Returns:
  `{ data, total, page, limit, totalPages }`

### `GET /audio/:id`

- What it does:
  Returns one audio asset with resolved media URLs
- Input:
  Audio ID in the path
- Returns:
  `{ data: AudioDetail }`

### `POST /audio/upload`

- What it does:
  Uploads one audio file, stores it, and runs the `ffmpeg` conversion pipeline
- Input:
  Multipart file upload with optional `name`
- Returns:
  `{ data: AudioDetail }`

### `POST /audio/tts`

- What it does:
  Generates a new audio asset from text using offline Piper inside the backend container and saves it to the audio library
- Input:
  `name`, `text`, `voice`, and optional `speed`
- Returns:
  `{ data: AudioDetail }`

### `POST /audio/tts/preview`

- What it does:
  Renders a temporary Piper preview stream for inline browser playback without saving any DB row or file
- Input:
  `text`, `voice`, and optional `speed`
- Returns:
  `audio/wav`

### `GET /audio/voices`

- What it does:
  Returns the local voice catalog used by the audio page
- Input:
  None
- Returns:
  `{ data: VoiceSummary[], total: number }`

### `DELETE /audio/:id`

- What it does:
  Deletes an audio asset if it is not used in a published flow
- Input:
  Audio ID in the path
- Returns:
  `{ data: { id: number, deleted: true } }`

### Static media serving

NestJS serves audio files through `/media/audio/...` with the current storage paths:

- `/media/audio/originals/...`
- `/media/audio/previews/...`
- `/media/audio/converted/...`
- `/media/audio/tts/...`

### Audio API notes

- `GET /audio` uses the paginated response envelope `{ data, total, page, limit, totalPages }`
- Browser preview uses the preview WAV path served by NestJS
- Telephony playback uses the converted WAV path mounted into Asterisk

## Recordings

### `GET /recordings?page=X&limit=Y`

- What it does:
  Returns the call recordings library as a paginated list
- Input:
  `page` and `limit` query parameters
- Returns:
  `{ data, total, page, limit, totalPages }`

### `GET /recordings/:id`

- What it does:
  Returns one recording row with resolved `streamUrl`
- Input:
  Recording ID in the path
- Returns:
  `{ data: RecordingDetail }`

### `GET /recordings/:id/stream`

- What it does:
  Streams the WAV file inline for browser preview playback
- Input:
  Recording ID in the path
- Returns:
  `audio/wav`

### `GET /recordings/:id/download`

- What it does:
  Downloads the WAV file with an attachment filename derived from `file_name`
- Input:
  Recording ID in the path
- Returns:
  `audio/wav` with `Content-Disposition: attachment`

### `DELETE /recordings/:id`

- What it does:
  Deletes the DB row and attempts to remove the backing recording file
- Input:
  Recording ID in the path
- Returns:
  `{ data: { id: number, deleted: true } }`

### `POST /recordings/internal`

- What it does:
  Internal persistence endpoint called by Stasis when a bridge recording completes
- Input:
  `callId`, `channelId`, `flowId?`, `fileName`, `format`, `durationSeconds?`, `startedAt`, `endedAt?`
- Returns:
  `{ data: RecordingDetail }`

### Recording API notes

- The backend owns the `call_recordings` startup migration through `RecordingsService.ensureSchema()`
- `RecordingsModule` is registered in `AppModule` together with the `CallRecordingEntity`
- `POST /recordings/internal` is intended for the Stasis service only and is protected by the shared `x-internal-token` header
- `GET /recordings/:id/stream` is used by the inline browser preview player on `/recordings`
- `GET /recordings/:id/download` is used by the labeled download button on `/recordings`

## Extensions

### `GET /extensions`

- What it does:
  Returns all database-backed SIP extensions
- Input:
  `limit` and `offset`
- Returns:
  `{ data, total }`

### `POST /extensions`

- What it does:
  Creates one extension, regenerates `pjsip_callytics_extensions.conf`, ensures the include in `pjsip.conf`, and reloads PJSIP through AMI
- Input:
  `username`, `password`, `displayName?`
- Returns:
  `{ data: ExtensionDetail }`

### `PUT /extensions/:id`

- What it does:
  Updates one extension and rewrites the managed PJSIP config
- Input:
  Extension ID in the path plus `username?`, `password?`, `displayName?`
- Returns:
  `{ data: ExtensionDetail }`

### `DELETE /extensions/:id`

- What it does:
  Deletes one extension and rewrites the managed PJSIP config
- Input:
  Extension ID in the path
- Returns:
  `{ data: { id: number, deleted: true } }`

## Trunks

### `GET /trunks`

- What it does:
  Returns all database-backed SIP trunks ordered by newest first
- Input:
  `limit` and `offset`
- Returns:
  `{ data, total }`

### `POST /trunks`

- What it does:
  Creates one SIP trunk, regenerates `pjsip_callytics_trunks.conf`, normalizes both managed `pjsip.conf` includes at the file end, and reloads PJSIP through AMI
- Input:
  `name`, `host`, `providerPreset?`, `port?`, `username?`, `password?`, `fromDomain?`, `fromUser?`, `enabled?`
- Returns:
  `{ data: TrunkDetail }`

### `PUT /trunks/:id`

- What it does:
  Updates one SIP trunk and rewrites the managed trunk config
- Input:
  Trunk ID in the path plus `name?`, `host?`, `providerPreset?`, `port?`, `username?`, `password?`, `fromDomain?`, `fromUser?`, `enabled?`
- Returns:
  `{ data: TrunkDetail }`

### `DELETE /trunks/:id`

- What it does:
  Deletes one SIP trunk and rewrites the managed trunk config
- Input:
  Trunk ID in the path
- Returns:
  `204 No Content`

### `POST /trunks/:id/test`

- What it does:
  Triggers AMI `PJSIPQualify` for the generated `trunk-{id}` endpoint, inspects the follow-up endpoint detail, and returns a UI-ready reachability result
- Input:
  Trunk ID in the path
- Returns:
  `{ status, rtt_ms, message }`

## Diagnostics

### `GET /diagnostics/sip-messages`

- What it does:
  Returns paginated SIP messages from persistent diagnostics history
- Input:
  Query params:
  - `page` (default `1`)
  - `limit` (default `50`, max `200`)
  - `callId?` (optional exact Call-ID filter)
- Returns:
  ```json
  {
    "data": [
      {
        "id": 1,
        "callId": "abc-123",
        "timestamp": "2026-04-21T20:00:00.000Z",
        "method": "INVITE",
        "fromUri": "<sip:1001@example.com>",
        "toUri": "<sip:2001@example.com>",
        "direction": "inbound",
        "responseCode": 180,
        "rawMessage": "...",
        "createdAt": "2026-04-21T20:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 50
  }
  ```

### `GET /diagnostics/sip-messages/:callId`

- What it does:
  Returns all SIP messages for one Call-ID in ascending timestamp order
- Input:
  Path param: `callId`
- Returns:
  `SipMessage[]` (empty array when no matching messages exist)

## Capture

### `GET /capture/packets/:callId`

- What it does:
  Returns historical SIP packets for one Call-ID from PostgreSQL persistence (`sip_packets`)
- Input:
  Path param: `callId`
- Returns:
  `SipPacket[]` ordered ascending by packet capture time (`captured_at`)
  - Empty array when no packets exist (never 404)

### `GET /capture/export/dialog/:callId`

- What it does:
  Exports a single SIP dialog (by Call-ID) as `.pcap`
- Input:
  Path param: `callId`
- Returns:
  Binary `application/vnd.tcpdump.pcap` response with attachment filename

### `GET /capture/export/bulk`

- What it does:
  Exports the current SIP capture filtered view as `.pcap`
- Input:
  Optional query filters (method, callId, trunkOrExtension, from, to, page slice)
- Returns:
  Binary `application/vnd.tcpdump.pcap` response with attachment filename

## Inbound routes

### `GET /inbound-routes`

- What it does:
  Returns all inbound DID routes, with optional `did` query filtering for Stasis lookup
- Input:
  Optional `did`, plus `limit` and `offset`
- Returns:
  `{ data, total }`

### `POST /inbound-routes`

- What it does:
  Creates one DID-to-flow mapping, regenerates `extensions_callytics_inbound.conf`, ensures the include in `extensions.conf`, and reloads the dialplan through AMI
- Input:
  `did`, `flowId`, `label?`
- Returns:
  `{ data: InboundRouteDetail }`

### `PUT /inbound-routes/:id`

- What it does:
  Updates one DID route and rewrites the managed inbound dialplan config
- Input:
  Route ID in the path plus `did?`, `flowId?`, `label?`
- Returns:
  `{ data: InboundRouteDetail }`

### `DELETE /inbound-routes/:id`

- What it does:
  Deletes one DID route and rewrites the managed inbound dialplan config
- Input:
  Route ID in the path
- Returns:
  `{ data: { id: number, deleted: true } }`

## Quality

### `GET /quality/:callId`

Returns the RTP quality record for a completed call.

**Params:**
- `callId` — the call identifier string from Stasis/Asterisk

**Response 200:**
```json
{
  "callId": "1776868925.5",
  "mos": 3.72,
  "jitter": 18.4,
  "packetLoss": 1.2,
  "rtt": 44.0,
  "grade": "fair",
  "recordedAt": "2026-04-22T17:07:19.000Z"
}
```

**Response 404:**
```json
{ "message": "No quality data for this call" }
```

**Notes:**
- Returns 404 if call was too short to generate RTCP data, or if media
  was never established (failed calls, very short calls < ~5s)
- MOS is computed at call end by Stasis and stored; this endpoint is read-only
- Used by the Call Logs QualityDrawer component
- No authentication required (same as other internal endpoints)

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


### Phase 8 builder integration note

The flow builder node config now supports real audio asset selection:

- `play_audio` nodes can select `audio_file_id` through the searchable audio picker
- `get_digits` nodes can select `prompt_audio_file_id` through the searchable audio picker
- Static fallback fields remain available for built-in or manually named sound paths
