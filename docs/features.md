# Features

## Flow builder

## Hunt Group Node

Dial multiple SIP destinations with configurable strategy.

**Strategies:**
- Sequential: dial each destination in order, retry until total timeout
- Random: same as sequential, no consecutive repeats
- Group: originate all simultaneously, first to answer wins, rest cancelled

**Features:**
- Hold audio loops on caller channel during dialing
- Busy audio plays between retry attempts
- Failed or unreachable endpoints count as failed attempts - retries continue
- Bare extension destinations auto-normalize to PJSIP/ prefix
- Routes to on_no_answer node when all attempts exhausted

## Conference Room Node

Multi-party conference rooms backed by Asterisk ConfBridge.

**Features:**
- ConfBridge-based conferencing with a named room per node
- Automatic MOH for participants waiting on a moderator
- Moderator can be designated by extension or PSTN operator
- Sole-survivor grace period with automatic hangup after 30 seconds

- Drag-and-drop canvas with custom nodes and editable connections
- Left sidebar for node types, center canvas for flow layout, right panel for node settings
- Start node that marks the entry point for incoming calls
- Play audio node for uploaded or TTS-generated prompts, including searchable database-backed audio asset selection
- Menu node for DTMF keypress routing such as `1 for sales`, `2 for support`, with prompt asset selection from the audio library
- Group node (`type: group`) for visual flow sections and swimlane-style organization
- Shift+click multi-select, plus toolbar group/ungroup actions
- Flow versioning drawer with commit message save, version list, compare view, and restore action
- Condition node for time-based rules, caller ID matching, business hours, and simple variable checks
- Transfer node for sending calls to an extension, ring group, queue, or external number
- Queue node for holding callers and routing to available agents
- Voicemail node with mailbox target, greeting, and recording rules
- Record node for capturing a caller message or consent clip
- Set variable node for storing branch state inside the call
- Webhook node for later product versions that need external integration
- Hangup node with selectable cause or reason
- Validation before publish so flows cannot be activated with broken links or missing prompts
- Draft and published versions so users can edit safely before applying changes

## SIP extension management

- `/extensions` page with inline create/edit/delete controls
- Database-backed PJSIP extensions written into `pjsip_callytics_extensions.conf`
- QR code provisioning modal for `sip:<username>@<host>:5080`
- Backend-triggered PJSIP reload after extension changes
- Host IP and SIP port come from backend `GET /config/host` so provisioning URIs and QR codes use the real machine address instead of `localhost`

## Inbound DID routing

- `/inbound` page with inline create/edit/delete controls
- Database-backed DID-to-flow mappings in `inbound_routes`
- Backend-generated `extensions_callytics_inbound.conf` dialplan include
- Stasis resolves the inbound DID on each call and loads the mapped flow live without restart
- Inbound routing add/edit forms use the shared `SearchableSelect` flow picker and the diagnostics-style inline pagination layout

## Audio management

- `/audio` page with upload form, offline TTS generation form, and paginated library table
- Upload audio in common formats such as `mp3`, `wav`, `m4a`, and `ogg`
- Automatic `ffmpeg` conversion into telephony and preview WAV outputs during import
- Browser preview player for ready assets
- Inline delete confirmation in the audio library
- Paginated audio library driven by the backend

## Call recordings

- Automatic inbound call recording through ARI bridge recording
- `/recordings` page with paginated table, inline preview player, download button, and delete action
- Browser preview through `GET /recordings/:id/stream`
- Direct WAV download through `GET /recordings/:id/download`
- Recording metadata persisted in `call_recordings`

## Text to speech

- Create an audio prompt from typed text inside the UI
- Offline Piper TTS bundled in the backend container
- Bundled `en_US-lessac-medium` voice model available from first boot
- Saved output appears in the same audio library as uploaded files

## Live dashboard

- Active calls list with caller ID, call state, duration, queue, and current flow node
- Queue status cards with waiting callers, available agents, busy agents, and longest wait time
- Recent event feed for answered calls, missed calls, transfers, voicemails, and hangups
- Service health panel for Asterisk, database, Redis, and API status
- Realtime counters for current calls, calls today, missed today, voicemail today, and average wait time
- Diagnostics live execution panel paginated to 10 calls per page
- Diagnostics SIP endpoints panel paginated to 10 rows per page

## Reports

- Call volume report by hour, day, and date range
- Missed calls report with caller ID, time, target flow, and missed reason
- Answered calls report with answer time, talk time, queue, and agent or destination
- Abandoned queue calls report with wait time before hangup
- Voicemail report with mailbox, caller, timestamp, and recording link
- Flow performance report showing entry count, branch count, and node-by-node drop-off
- Audio usage report showing which prompts are used most and where
- SIP trunk activity report with inbound count, outbound count, failures, and registration status
- Export to `CSV` for tabular reports

## SIP trunk setup

- Optional setup during first run
- Support for basic provider fields: host, username, password, auth ID, caller ID, codecs
- Registration status indicator in settings and dashboard
- Test call action to confirm inbound and outbound routing
- Skip mode that leaves the system local only

## User settings

- Local admin account and password change
- Timezone, business hours, and default locale
- Default audio language and TTS voice
- Recording retention settings
- Dashboard refresh and event noise filters
- SIP settings page
- Backup and restore entry point for future versions

## Shared UI components

- `SearchableSelect` is now a reusable picker used for voices and audio assets
- `Pagination` is now a reusable backend-driven list footer used across pages

## Network diagnostics

- Dedicated `/diagnostics` page for system and network observability
- System health panel for ARI, AMI, Asterisk, PostgreSQL, and Redis
- Trunk health panel with live reachability testing and PJSIP qualify actions
- SIP registration panel for active endpoint contacts
- SIP traffic inspector with real-time scrolling transport events
- SIP traffic persistence to `sip_messages` for historical diagnostics and Call-ID correlation
- SIP ladder diagram slide-in for per-Call-ID drill-down from traffic/failure rows
- Recent call failures panel with flow and destination resolution
- Dedicated `/capture` page (MONITOR -> Capture) for packet-level SIP troubleshooting
  - Live packet stream with method/Call-ID/trunk/time filters
  - Historical packet restore for completed calls via `?callId=` deep link and `GET /capture/packets/:callId`
  - Historical-call info banner when stored packets are loaded (live capture auto-paused)
  - Rule-based verdict banner (offline, no API dependency)
  - Inline SIP ladder and packet header accordion
  - `.pcap` export for selected dialog or current filtered view
  - Existing Diagnostics Panel D SIP Traffic Inspector remains unchanged (Capture is additive)

## Resource Usage Panel

- Built into `/diagnostics` under the Network tab with no new sidebar entry
- CPU arc meter with live percent refresh
- Memory and disk usage bars with used, free, and total values
- Asterisk active channels card backed by AMI `CoreShowChannels`
- Network I/O totals for sent and received traffic
- Resource metrics fetched from `GET /diagnostics/resources`
- System health panel no longer duplicates the channel count

### RTP Quality Monitor (Phase 23)

Per-call audio quality scoring surfaced directly on the Call Logs page.

**MOS badge** - every completed call row shows a colour-coded Mean Opinion
Score badge (green >= 4.0 / amber 3.0-3.9 / red < 3.0 / grey = no data).
Score is computed offline from RTCP statistics using the simplified E-model
(ITU-T G.107). No API cost.

**Quality drawer** - clicking the MOS badge opens a side drawer showing:
- MOS score (large, colour-coded)
- Jitter in ms with plain-English label (excellent / slight / high)
- Packet loss % with plain-English label (none / low / elevated)
- Round-trip time in ms with plain-English label (normal / moderate / high)
- A one-line verdict summarising the likely quality cause
- "View in Capture" button - jumps to the Capture page filtered by Call-ID

**No new page** - quality is accessible directly from Call Logs without
navigating away. The Execution Trace drawer and Quality drawer are two
independent interactions on the same call row.

## Node config validation

- Transfer node: destination required, timeout_ms required > 0
- Menu node: prompt audio required, timeout_ms required > 0, branches required
- Backend returns HTTP 400 with message pattern: "Node <nodeKey>: <field> is required"
- Frontend shows inline field errors and suppresses top-level banner for validation failures

## Skeleton loading

- Globally consistent skeleton loading using `SkeletonRow` and `SkeletonCard` components
- Applied to all core pages: Trunks, Extensions, Inbound, Audio, Recordings, CallLogs, and Diagnostics
- Independent resolving per panel/section for responsive data loading
