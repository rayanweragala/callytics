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

Current important infrastructure state:

- `asterisk`: `network_mode: host`
- `stasis`: `network_mode: host`
- `stasis` uses `ARI_URL=http://127.0.0.1:8088`
- `stasis` uses `DB_HOST=127.0.0.1`
- `backend` uses bridge networking and talks to Postgres/Redis by service name
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
- `GET /audio/voices`
- `DELETE /audio/:id`
- Static media at `/media/audio/...`

Current API pagination:

- `GET /audio` returns `{ data, total, page, limit, totalPages }`
- `GET /flows` returns `{ data, total, page, limit, totalPages }`

Current asset/runtime notes:

- `backend/voices/` contains the bundled Piper voice model files used during backend image build
- Host-exposed Redis now uses `127.0.0.1:6380` rather than `6379`
