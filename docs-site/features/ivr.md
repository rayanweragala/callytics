# IVR Flow Builder

IVR Flow Builder is the visual editor for designing how calls move through Callytics. You build call routing with a drag-and-drop canvas instead of editing dialplan text, making it straightforward to design menus, queues, transfers, voicemail paths, and after-hours behavior.

Flows use a draft and publish model so you can prepare changes safely before they affect live calls. Published versions are tracked, and you can restore older versions with one click when a previous routing setup needs to be recovered.

Before a flow is published, Callytics validates the nodes and connections to catch missing configuration or invalid routing. The canvas also includes a minimap and auto-layout tools for keeping large call flows readable.

## Capabilities

- Drag-and-drop call flow canvas
- Draft editing before publishing to live calls
- Flow version history
- One-click restore of previous versions
- Validation before publish
- Canvas minimap for navigating large flows
- Auto-layout for organizing complex diagrams

## Node Reference

> Terminal nodes (hangup, voicemail, callback, queue_login) have no outgoing edges except to webhook nodes. Any node — including terminal nodes — can connect to a webhook.

### Start

The entry point for every flow. Each flow has exactly one Start node. It has no configuration options. It has a single outgoing edge that connects to the first step of the call.

### Play Audio

Plays an uploaded audio file or a TTS-generated prompt to the caller.

- **Config:** `audio_file_id` — the ID of the audio file from the Audio library
- **Behaviour:** Playback runs via the ARI `play` command. The node resolves when playback completes.
- **Edges:** Single outgoing edge — continues after playback finishes
- IVR audio playback is never recorded, regardless of any recording settings on other nodes

### Get Digits

Waits for DTMF input from the caller and stores the collected digit string in a named call session variable for use downstream.

- **Config:** variable name, expected digit count, timeout in milliseconds (default `10000ms`)
- **Behaviour:** Registers a `ChannelDtmfReceived` listener on the ARI channel. Resolves when the digit count is reached, the timeout elapses, or the caller hangs up.
- **Edges:** Single outgoing edge — continues after digits are collected or timeout expires

### Menu

Routes the call based on which DTMF digit or digit sequence the caller pressed.

- **Config:** Digit-to-edge mappings. Supports double-digit sequences — for example, press `21` for HR, `22` for Finance.
- **Behaviour:** Waits for DTMF input, matches against configured patterns, and follows the corresponding edge. A subflow stack handles nested menu re-entry.
- **Edges:** One edge per configured digit pattern, plus separate edges for invalid input and timeout

### Business Hours

Routes the call based on configured weekly schedules.

- **Config:** Weekly schedule per day with start and end times
- **Behaviour:** Checks the current server time against the configured schedule at the moment the node is reached
- **Edges:** Two edges — `in-hours` and `out-of-hours`
- **Limitation:** Midnight-crossing schedules (for example, 22:00–02:00) are not currently supported

### Transfer

Bridges the caller to a SIP extension or a PSTN number via the configured trunk.

- **Config:** destination type (extension or PSTN), destination value, trunk selection, `record_call` toggle
- **Behaviour:** Uses `formatDialNumber` to clean and format the number according to the trunk's `dial_format` field before dialing. When `record_call` is enabled, Stasis calls `POST /ari/bridges/{bridgeId}/record` to start bridge recording.
- **Edges:** Single outgoing edge after transfer completes (hangup or disconnect)

### Hunt Group

Tries multiple destinations with one of three distribution strategies.

- **Config:** destination list, strategy, `record_call` toggle
- **Strategies:**
  - *Group (simultaneous)* — originates all destinations at once via ARI. Takes the first channel to answer and immediately hangs up all losing channels.
  - *One by one ordered* — tries destinations in the configured order. Moves to the next on no-answer or busy.
  - *One by one random* — same as ordered, but shuffles the destination list on each call.
- **Recording:** When `record_call` is enabled, bridge recording starts on the winning channel via ARI.
- **Edges:** Single outgoing edge after the hunt group call ends

### Queue

Places the caller in a waiting queue until an available operator is matched.

- **Config:** queue selection, timeout duration, abandon edge, timeout edge
- **Behaviour:**
  - Stasis checks `queue:<id>:operators` in Redis for logged-in operators
  - Polls Redis every 500ms waiting for an available operator
  - When matched, Stasis creates a `mixing,dtmf_events` ARI bridge between the caller channel and the operator channel
  - Queue live state is Redis only — PostgreSQL is never polled for queue state
- **Edges:** Outgoing edges for abandoned (caller hangs up) and timeout (max wait exceeded)

### Queue Login

Lets a call-center operator log in or out of a queue from their softphone using a PIN.

- **Config:** queue selection
- **Behaviour:**
  - Stasis prompts the operator for their PIN via DTMF
  - Matches the input against `operators.pin_hash` in the database
  - On match, Stasis writes to Redis:
    - `operator:<id>:queue` = queue ID
    - `operator:<id>:channel` = ARI channel ID
    - Adds the operator's channel to the `queue:<id>:operators` set
  - Operator dials `#` during the PIN prompt to log out
- **Edges:** Terminal node — no outgoing edges except to webhook

### Conference

Places the caller into a named ARI conference bridge. Multiple callers joining the same room name are bridged together in a single mixing bridge.

- **Config:** room name
- **Edges:** Resolves when the caller leaves the conference or hangs up

### Callback

Records the caller's callback number and stores it in the database. The caller either enters their number via DTMF or confirms their caller ID.

- **Config:** callback number source (DTMF entry or caller ID), optional confirmation prompt
- **Behaviour:** Stores the callback record as pending. The Callbacks page in the UI shows pending callbacks. An operator initiates the return call from the UI.
- **Edges:** Terminal node — no outgoing edges except to webhook

### Voicemail

Records a voice message from the caller via ARI channel recording.

- **Config:** start audio prompt (required), maximum recording duration
- **Behaviour:** Stasis calls the ARI channel recording endpoint. Recording saved as a `.ulaw` file in the `asterisk_recordings` volume.
- **Edges:** Terminal node — no outgoing edges except to webhook

### Webhook

Sends an async fire-and-forget HTTP POST to a configured URL.

- **Config:** URL, optional headers, optional payload template
- **Behaviour:** The HTTP request is fired without awaiting a response. Call flow execution continues immediately — the webhook never blocks the call. Can be connected from any node, including terminal nodes (hangup, voicemail, callback, queue_login).
- **Canvas:** Edges to and from webhook nodes render with dashed lines. The node card shows a small "async" label.
- **Edges:** Single outgoing edge (call flow continues after webhook is dispatched, not after HTTP response)

### Hangup

Ends the call immediately.

- **Edges:** Terminal node — no outgoing edges except to webhook
