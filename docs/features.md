# Features

## Flow builder

- Drag-and-drop canvas with custom nodes and editable connections
- Left sidebar for node types, center canvas for flow layout, right panel for node settings
- Start node that marks the entry point for incoming calls
- Play audio node for uploaded or TTS-generated prompts, including searchable database-backed audio asset selection
- Menu node for DTMF keypress routing such as `1 for sales`, `2 for support`, with prompt asset selection from the audio library
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
