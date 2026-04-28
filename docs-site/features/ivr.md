# IVR Flow Builder

## Node reference table

Built from stasis node executors and frontend node styling.

| Node | Color | What it does | Key parameters |
| --- | --- | --- | --- |
| `start` | `var(--color-active)` | Runtime entry marker. `executeStart()` returns `default`; flow walker moves to next edge. | `flow_default_timeout_ms` / `queue_login_default_input_timeout_ms` on start config |
| `play_audio` | `var(--primitive-cyan)` | Resolves audio path and sends ARI playback (`channel.play` or `bridges.play`), waits for `PlaybackFinished`. | `audio_file_id`, `audio_file_path` |
| `get_digits` | `var(--accent)` | Plays optional prompt, listens to `ChannelDtmfReceived`, returns first digit/`timeout`/`hangup`. | `prompt_audio_file_id`, `prompt_path`, timeout via node/flow default |
| `menu` | `var(--color-warning)` | Prompt + DTMF branch collector with retry counters for `timeout` and `invalid`; can route to submenu targets. | `branches`, `submenu_branch_targets`, `max_timeout_attempts`, `max_invalid_attempts`, prompt/invalid/timeout/final audio ids |
| `business_hours` | `var(--accent)` | Evaluates timezone schedule using `Intl.DateTimeFormat` and returns `open` or `closed`. | `timezone`, day-by-day `schedule` |
| `transfer` | `var(--primitive-blue)` | Resolves endpoint (`extension`/`pstn`/`sip_uri`), originates outbound leg via ARI, bridges legs, handles answer/no-answer paths. | `target_type`, `target_value`, `trunk_id` (pstn path), timeout, `on_no_answer`, optional waiting/no-answer sounds |
| `hunt` | `var(--color-warning)` (hunt node component) | Sequential/group hunt originate logic with waiter tokens; bridges first answer and handles timeout/fail/hangup cleanup. | `destinations[]`, `strategy`, `attempt_timeout_ms`, `total_timeout_ms`, hold/busy audio ids |
| `queue` | `var(--primitive-navy-300)` | Enters queue, optionally plays prompt, bridges to available operator or enqueues caller in Redis wait list until connected/timeout/abandon. | `queue_id`, `prompt_audio_file_id` |
| `queue_login` | `var(--primitive-navy-300)` | PIN-based operator auth: plays prompt, collects digits, bcrypt checks operator hashes, logs operator in/out and controls MOH. | `queue_id`, prompt/wrong/success audio ids, `use_flow_default_timeout`, `input_timeout_ms` |
| `conference` | `#2dd4bf` | Joins/creates room bridge, optional moderator gate, MOH for sole-survivor state, emits conference timeline events. | `roomName`, `waitForModerator`, `moderatorType`, `moderatorId` |
| `callback` | `var(--primitive-orange)` | Collects ANI or DTMF number, publishes callback creation event, plays confirmation, hangs up current leg. | `number_source`, `dtmf_prompt_audio_id`, `dtmf_max_digits`, `confirmation_audio_id`, destination/operator/trunk fields |
| `voicemail` | `var(--text-muted)` | Optional prompt then ARI channel record (`ulaw`), waits for `RecordingFinished`, persists recording row. | `mailbox_name`, `max_duration_seconds`, `prompt_audio_file_id` |
| `webhook` | `var(--text-muted)` | Not in main executor map; fired asynchronously by runtime as side-effect target via HTTP fetch with timeout. | `url`, `method`, `headers`, `include_caller`, `include_digits`, timeout |
| `hangup` | `var(--color-active)` | Calls channel hangup and returns terminal `done`. | none |

## Publish and draft model

From `backend/src/flows/entities/*` and `flows.service.ts`:

- `call_flows.status` is persisted (`draft`/`published`) and `current_version_id` points to the version snapshot to execute.
- `flow_versions` stores immutable snapshots with `is_published` and `published_at`.
- Stasis loader (`stasis/src/flowLoader.ts`) only loads rows with `status = 'published'` and then reads nodes/edges from `current_version_id`.

Operationally this means:

- Editing/saving creates/updates version snapshots in backend.
- A publish operation updates the flow’s active version pointer.
- Calls already running continue on the in-memory session flow they loaded at start; new calls load the newer published version.

## Flow execution engine

From `stasis/src/runtime.ts`:

1. `runFlow()` finds entry node (`start` or first node fallback).
2. For each step, it inserts a `call_node_logs` row (`entered_at`), executes node handler, then updates the same row with exit branch/error.
3. Next edge selection uses `resolveNextEdge(source, nodeType, result, edges)` from `engine/edgeResolver.ts`.
4. Menu subflow routing uses `submenu_branch_targets` + `subflow_id`; parent flow state is pushed to a stack and resumed on `complete` edge.
5. Webhook nodes are treated as async side-effect targets from outgoing edges and excluded from primary routing edges.
6. On missing node/edge or execution exception, the engine marks flow failed and publishes a `failed` call event.
7. On normal termination, it publishes `ended` with duration.
