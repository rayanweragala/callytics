# How callytics works

When a user runs the install command, `callytics` installs a small control layer and starts the local services it needs. The exact command may be `npm install -g callytics`, followed by a first-run command such as `callytics start`, but the user experience should feel like one install flow.

At a high level, these parts come up:

- A web UI on `localhost` for flows, audio, dashboards, and settings
- A backend API that stores data, talks to Asterisk, and handles live events
- A PostgreSQL database for saved configuration and call history
- A Redis instance for short-lived live state and background jobs
- An Asterisk service that handles calls, IVR logic, voicemail, and SIP
- An `ffmpeg` worker path for audio conversion
- A TTS path for generating spoken audio from text

What the user sees:

1. The installer checks Docker and Docker Compose support.
2. It pulls the needed containers and creates a local data directory.
3. It asks one optional question: do you want to configure a SIP trunk now?
4. If the user says yes, it collects trunk settings and stores them.
5. If the user says no, it skips external calling and keeps the system local only.
6. It starts the stack and prints the local web URL, default login, and service status.

Asterisk is the telephony engine. It still answers calls, plays prompts, receives DTMF key presses, records voicemail, and bridges calls. `callytics` does not replace that. It sits on top of Asterisk and uses a Stasis app plus runtime commands to drive each published flow.

The web UI does not talk to Asterisk directly. It talks to the backend API. The backend stores the flow in the database, and the Stasis app reads the published flow from the database on each incoming call and executes it through ARI while the backend listens to Asterisk event streams for live dashboard updates.

If a SIP trunk is configured, Asterisk can place and receive real calls through the provider. If no trunk is configured, the same call flows still work inside the local setup using softphones or local SIP endpoints. That keeps development and testing possible without needing a public phone number on day one.


## Current implementation status after Phase 4

The runtime engine is no longer just a plan. The current implementation now does the following:

- The NestJS backend starts in Docker and connects to PostgreSQL
- The Stasis app starts in Docker, connects to PostgreSQL, runs migrations, and seeds a published test flow only when flow 1 does not already exist with saved nodes
- Incoming calls enter Asterisk through the static dialplan and are handed to the `callytics` Stasis app
- The Stasis app loads the published flow from PostgreSQL, creates an in-memory call session, and executes the flow node by node
- The first implemented node executors are `start`, `play_audio`, `get_digits`, `branch`, `transfer`, `voicemail`, `hangup`, and `set_variable`
- The published flow is now expected to come from the builder and database state rather than being reset back to the original seed on every restart

The Stasis app now also owns the initial schema for:

- `call_flows`
- `flow_versions`
- `flow_nodes`
- `flow_edges`
- `call_logs`

## Networking change made during first-call debugging

The original Docker layout used bridge networking for the Stasis container and host networking for Asterisk. That did not work once Asterisk moved to `network_mode: host`, because the Stasis container could no longer reliably reach ARI through Docker host aliases.

The working state is now:

- `asterisk`: `network_mode: host`
- `stasis`: `network_mode: host`
- `stasis` ARI URL: `http://127.0.0.1:8088`
- `stasis` database host: `127.0.0.1`

The older bridge-networked Stasis setup should not be restored.


## Current implementation status after Phase 5

The diagnostics loop is now partially live end to end.

What now works:

- Stasis publishes structured node execution events to Redis before and after node execution
- Stasis also publishes SIP endpoint registration snapshots derived from AMI endpoint polling
- NestJS subscribes to Redis pub/sub and relays those updates to connected browsers with Socket.io
- The React frontend renders a diagnostics surface with a SIP status panel and a live per-call execution timeline
- The frontend receives these updates through Socket.io push only; it does not poll for timeline data

Current diagnostics data flow:

- `Stasis -> Redis pub/sub -> NestJS -> Socket.io -> React frontend`

The current diagnostics UI is meant as an operations surface, not a general dashboard template. It is the first concrete implementation of the Control Room design system.


## Current implementation status after Phase 7

The flow builder now has a real backend persistence slice instead of mocked flow data.

What now works:

- NestJS exposes a thin REST API for flow CRUD
- The API lists existing flows, including the seed flow created in Phase 4
- The API returns a single flow with nested nodes and edges for the latest stored version
- New flows can be created with nodes and edges in one request
- Existing flows can be updated by writing a new latest version and replacing nodes and edges for that version
- Flows can be deleted together with their related versions, nodes, and edges

Current flow API endpoints:

- `GET /flows`
- `GET /flows/:id`
- `POST /flows`
- `PUT /flows/:id`
- `DELETE /flows/:id`

This is intentionally a thin slice. It exists to unblock the flow builder UI with real saved data while keeping the backend small and understandable.


## Current implementation status after Phase 6

The flow builder now has a real frontend editing surface wired to the live Phase 7 backend API.

What now works:

- `/flows` lists flows from the backend
- users can create a new flow from the UI
- users can open `/flows/:id` and edit a flow on a React Flow canvas
- the editor supports the current node types:
  - `start`
  - `play_audio`
  - `get_digits`
  - `hangup`
- users can drag nodes onto the canvas, connect nodes, delete nodes, delete edges, and reconnect edges
- users can edit node config in the right-side config panel and save changes back to the backend
- save feedback and delete confirmations are implemented in the Control Room UI

This means the builder is no longer blocked on mock data. The browser now edits real flows stored through the backend CRUD API.


**Canvas tools:**
- Mini-map (bottom-right): shows all nodes with type-colored indicators, pannable and zoomable
- Tidy layout button: auto-arranges nodes into a clean top-down tree using the dagre layout algorithm


## Current implementation status after Phase 8

The audio path is now a real implemented part of the system, not just a design note.

What now works:

- Audio can be uploaded into the backend and stored as database-backed assets
- The backend writes an `audio_files` record before and after conversion work
- `ffmpeg` produces a telephony playback WAV and a browser-preview WAV for each asset
- NestJS statically serves audio files from `/media/audio/...` for browser preview
- Offline Piper TTS runs inside the backend container and writes generated assets into the same audio pipeline
- The Stasis runtime now resolves `audio_file_id` from the database through `audioResolver.ts` before playback
- `play_audio` and `get_digits` still support direct built-in/static sound paths as fallback fields

Current implemented Phase 8 pipeline:

1. User uploads audio or generates TTS in the frontend
2. NestJS creates an `audio_files` record in PostgreSQL
3. The backend stores the source file under `storage/audio/...`
4. `ffmpeg` produces a converted telephony WAV and a preview WAV
5. NestJS serves those files at `/media/audio/...`
6. Stasis resolves `audio_file_id` to the converted asset path and plays it through Asterisk

Current audio mount path into Asterisk:

- `./storage/audio/converted -> /var/lib/asterisk/sounds/callytics`

That lets the browser preview and the telephony runtime share one asset pipeline while still using the format each side needs.

## Current implementation status after Phase 11

Phase 11 adds call recording, a recordings management surface, and a fix for the playback regression discovered when recording was first introduced.

What now works:

- The backend owns a `call_recordings` startup migration and persists recording metadata through `RecordingsModule`
- NestJS now exposes `GET /recordings`, `GET /recordings/:id`, `GET /recordings/:id/stream`, `GET /recordings/:id/download`, `DELETE /recordings/:id`, and `POST /recordings/internal`
- Stasis answers the inbound call, creates a mixing bridge for the inbound channel, plays prompts on that bridge, and records the same bridge through ARI
- Recording metadata is persisted on `StasisEnd` after the live bridge recording is stopped
- The frontend now includes a `/recordings` page with inline `AudioPreviewPlayer`, download/delete controls, and backend-driven pagination
- The diagnostics page now paginates both the live execution panel and the SIP endpoints panel in pages of 10 rows

Why bridge-based recording is required:

- The original Phase 11 attempt used channel-level recording started immediately after answer
- In live testing that caused prompts to be delayed until after hangup, so greeting and menu playback became effectively silent during the call
- Moving playback and recording onto the same inbound ARI mixing bridge fixed the regression: the caller hears bridge playback live while ARI records that same mixed bridge

Current recording volume layout:

- Docker volume: `asterisk_recordings`
- Asterisk mounts it at both `/var/lib/asterisk/recording` and `/var/spool/asterisk/recording`
- Backend mounts the same volume at `/var/lib/asterisk/recording`
- Reason: ARI writes recordings under `/var/spool/asterisk/recording`, while the backend serves files from `/var/lib/asterisk/recording`; dual-mounting the same named volume keeps both paths valid without copying files

Transfer-path note after the bridge change:

- Before outbound bridging, the runtime stops the temporary inbound bridge recording and tears down the temporary inbound recording/playback bridge
- The transfer node then originates the outbound leg, creates a new ARI mixing bridge, and adds both inbound and outbound channels to that bridge for the live conversation

## Current implementation status after Phase 10

The end-to-end call path is now verified with database-backed audio assets, conditional routing, and builder-owned flow persistence.

What now works:

- Stasis publishes a terminal hangup telemetry event when `StasisEnd` fires
- The backend diagnostics service derives active call count from the in-memory timeline rather than a Redis counter
- The backend now evicts stale non-terminal timeline entries after one hour, checked every five minutes
- Audio playback uses `sound:callytics/<id>` and Asterisk resolves that to the mounted `.ulaw` asset
- `get_digits` subscribes to DTMF on the active ARI channel and returns live digit results such as `3` and `timeout`
- The runtime resolves conditional edges from flow data, so menu branches such as `3`, `timeout`, and `default` can route to different nodes
- The transfer node now executes and attempts outbound originate/bridge flow rather than acting as a placeholder
- Stasis ignores `StasisStart` events for the `h` extension in `callytics-inbound`, preventing a second answer/run attempt on an already-ended channel
- The Stasis seed path no longer overwrites flow 1 on restart; if flow 1 already has saved nodes, seeding is skipped entirely
- Completed calls no longer need to remain stuck as active if a terminal event was missed in an older session
