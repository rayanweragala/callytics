# callytics
Self-hosted open source call center platform. Install with one npm command.
> Full documentation in /docs


Current completed implementation phases:

- Phase 1: project skeleton, Docker Compose, and Asterisk base config
- Phase 2: Asterisk 20 from source, ARI and AMI verified, Stasis app connected
- Phase 3: NestJS backend running with PostgreSQL and health endpoint
- Phase 4: Stasis flow execution engine, schema migration, seed flow, and node executors
- Phase 5: diagnostics UI, SIP status panel, Redis pub/sub telemetry, Socket.io relay
- Phase 6: React Flow builder UI with flow list, editor canvas, config panel, node and edge editing
- Phase 7: thin-slice backend REST API for flow CRUD powering the builder
- Phase 8: audio management, ffmpeg conversion, offline Piper TTS, static media serving, and builder audio asset integration
- Phase 9: end-to-end live call verification with database-backed audio assets and `.ulaw` telephony playback
- Phase 10: conditional routing, transfer node execution, DTMF capture fix, Stasis hangup-extension guard, and seed overwrite protection
- Phase 11: call recordings, bridge-based recording/playback fix, recordings page, recording download support, and diagnostics panel pagination
- Phase 12: hunt group node execution with sequential, random, and group dialing strategies
- Phase 13: SIP extension management, QR provisioning, and DID-based inbound routing
- Phase 14: SIP Trunks + Audio Improvements + UI Polish
  - SIP Trunks UI: inline add/edit form, provider presets, enabled/disabled status
  - Trunk reachability test: real TCP socket check, structured backend logging
  - Audio page: TTS speed control slider (0.5×–2.0×), preview-before-save
    (streams Piper stdout directly, no DB write), generate renamed to save,
    speed stored on audio_files
  - Unified date-time format across all pages (DD Mon YYYY, HH:MM via formatDateTime)
  - Themed ConfirmDialog component replacing browser window.confirm on unsaved-leave guard
  - Trunks inline form Username field layout fix
  - Created column white-space: nowrap fix across all table pages

Current important infrastructure state:

- `asterisk`: `network_mode: host`
- `stasis`: `network_mode: host`
- `stasis` uses `ARI_URL=http://127.0.0.1:8088`
- `stasis` uses `DB_HOST=127.0.0.1`
- `backend`: `network_mode: host`
- `backend` uses `DB_HOST=127.0.0.1`
- `backend` uses `REDIS_HOST=127.0.0.1` and `REDIS_PORT=6380`
- `backend` now also mounts the shared `./asterisk/base` config directory at `/etc/asterisk` so NestJS can regenerate PJSIP and inbound dialplan snippets from database state on startup and after UI changes
- `stasis` uses host-local Redis at `127.0.0.1:6380`

Current audio management capabilities:

- Upload audio through the backend and convert it with `ffmpeg` into telephony and browser-preview WAV outputs
- Generate offline TTS with bundled Piper using the `en_US-lessac-medium` voice model
- Browse and manage assets in the frontend audio library at `/audio`
- Preview converted audio in the browser before assigning it to nodes
- Resolve database-backed audio assets in the Stasis runtime through `audio_file_id`

Current backend audio endpoints:

- `GET /audio?page=X&limit=Y`
- `GET /audio/:id`
- `POST /audio/upload`
- `POST /audio/tts`
- `POST /audio/tts/preview`
- `GET /audio/voices`
- `DELETE /audio/:id`
- Static media at `/media/audio/...`

Current recording capabilities:

- Stasis automatically records inbound calls through ARI bridge recording and persists metadata to `call_recordings`
- The backend exposes paginated recording list/detail/stream/download/delete endpoints plus an internal persistence endpoint
- The frontend provides a `/recordings` page with inline preview playback, download, delete, and pagination
- Recording files are written by Asterisk into a shared Docker volume and read by the backend from the mirrored mount path

Current backend recording endpoints:

- `GET /recordings?page=X&limit=Y`
- `GET /recordings/:id`
- `GET /recordings/:id/stream`
- `GET /recordings/:id/download`
- `DELETE /recordings/:id`
- `POST /recordings/internal`

Current extension and inbound routing endpoints:

- `GET /extensions`
- `POST /extensions`
- `PUT /extensions/:id`
- `DELETE /extensions/:id`
- `GET /inbound-routes`
- `GET /inbound-routes?did=<did>`
- `POST /inbound-routes`
- `PUT /inbound-routes/:id`
- `DELETE /inbound-routes/:id`
- `GET /trunks`
- `POST /trunks`
- `PUT /trunks/:id`
- `DELETE /trunks/:id`
- `POST /trunks/:id/test`
- `GET /config/host`

Current API pagination:

- `GET /audio` returns `{ data, total, page, limit, totalPages }`
- `GET /flows` returns `{ data, total, page, limit, totalPages }`
- `GET /recordings` returns `{ data, total, page, limit, totalPages }`
- diagnostics socket pagination now returns `{ data, total }` for the live execution panel and SIP endpoints panel using `limit=10`

Current asset/runtime notes:

- `backend/voices/` contains the bundled Piper voice model files used during backend image build
- Host-exposed Redis now uses `127.0.0.1:6380` rather than `6379`
- `asterisk_recordings` is mounted into Asterisk at both `/var/lib/asterisk/recording` and `/var/spool/asterisk/recording`; ARI writes under `/var/spool/asterisk/recording` while the backend reads the same named volume at `/var/lib/asterisk/recording`
- Phase 14 adds database-backed `sip_trunks` management and generates `/etc/asterisk/pjsip_callytics_trunks.conf` from enabled rows on startup and CRUD changes
- Backend-managed `pjsip.conf` include placement now removes any older managed include position and re-appends both `#include pjsip_callytics_extensions.conf` and `#include pjsip_callytics_trunks.conf` as the final top-level lines in the file. Older Phase 13 behavior moved the extensions include away from the broken in-template position and kept it near the file start; trunk support now standardizes both managed includes at file end so they remain top-level and ordered.
- Generated extension objects now use the same object name for endpoint and AOR (for example `[2001]` endpoint + `[2001]` AOR with `aors=2001`), matching the known-good static `test-phone` pattern and fixing registrar lookups for softphone registration
