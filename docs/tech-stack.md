# Tech stack

## Runtime

- `Node.js`
  Chosen because the install story is npm-first, the web stack can share one language, and the ecosystem is strong for CLI tooling and realtime apps. We are not using Python or Go for the main app because the install and packaging story would become less direct for npm users.

## Backend framework

- `NestJS`
  Chosen for a structured backend with modules, background jobs, WebSocket support, and clear service boundaries. Plain Express would be lighter, but this project has enough moving pieces that a stronger structure will help.

## Frontend framework

- `React` with `Vite`
  Chosen because the app is an interactive dashboard and flow editor, and React has the strongest tooling around node-based editors. We are not using Next.js because this is a localhost app, not a server-rendered website.

## Database

- `PostgreSQL`
  Chosen because the data has relationships, reports need SQL, and JSON columns can still hold flexible flow metadata where needed. SQLite would be simpler, but concurrent writes, reporting, and future multi-user features point toward Postgres.

## Cache and live state

- `Redis`
  Chosen for short-lived call state, pub/sub, job queues, and fast live dashboard fanout. We are not using Postgres alone for this because live state and background work fit Redis better.

## IVR engine

- `Asterisk`
  Chosen because it already solves PBX and IVR basics well and has years of real-world deployment behind it. Building a telephony engine from scratch would be a mistake.

## Asterisk integration

- `AMI` for live events and operational control
  Chosen because it exposes call events, channel updates, queue events, and enough runtime control for dashboards and status.
- `ARI` with a `Stasis` app for flow execution
  Chosen because the visual flow lives in the database while the Node.js runtime executes each call step through ARI. Asterisk keeps a small static dialplan that hands calls into the Stasis app.

## Current telephony runtime topology

- `Asterisk 20` built from source in Docker
  Chosen because Ubuntu apt gave Asterisk 18, which was not acceptable for the Stasis runtime we need.
- `Asterisk` container uses `network_mode: host`
  Chosen because Docker's UDP proxying caused RTP and SIP media-path problems during live-call debugging.
- `Stasis` container also uses `network_mode: host`
  This was changed after Phase 4. The old state was bridge networking, but once Asterisk moved to host networking the Stasis app could no longer reach ARI reliably through Docker host aliases. Running Stasis on host networking and targeting `127.0.0.1` fixed ARI registration.
- SIP transport now binds to `5080`
  Chosen because the host already occupies `5060`.
- `ari-client`
  Chosen because `node-ari-client` does not exist on npm.

## Audio handling

- `ffmpeg`
  Now implemented inside the backend container to convert uploads and TTS output into a telephony WAV for Asterisk playback and a preview WAV for browser playback.

## Text to speech

- `Piper`
  Now implemented inside the backend container for offline generation. The current bundled voice model is `en_US-lessac-medium`, stored in `backend/voices/` and copied into the backend image. Cloud TTS is still optional future work, not required for the current product.

## Current backend audio runtime

- Backend container base: `node:20-bookworm-slim`
- Backend container installs: `python3`, `python3-pip`, `ffmpeg`, and `piper-tts`
- NestJS statically serves generated and uploaded media from `/media/audio/...`
- The backend image bundles `en_US-lessac-medium` voice model files from `backend/voices/`

## Realtime updates

- `Socket.io`
  Chosen because it handles reconnects, rooms, and browser support cleanly for dashboards. Raw WebSockets would work, but Socket.io removes a lot of boilerplate.

## Flow editor

- `React Flow`
  Chosen because it already handles node editors, connections, zoom, minimap, and custom node rendering. Building this from scratch would waste time.

## Containerization

- `Docker` and `Docker Compose`
  Chosen because cross-distro Linux installs are messy, and containers give us a controlled runtime for Asterisk, Postgres, and Redis. Native package installs would be harder to support across distributions.

## Reporting

- SQL views or service-layer queries on PostgreSQL
  Chosen because the reporting needs are tabular and aggregations fit SQL well. We are not adding a separate analytics database in the early versions.


Current service networking is mixed by design:

- `asterisk`: host networking
- `stasis`: host networking
- `backend`, `postgres`, `redis`, `frontend`: verify per service before assuming; they may still use bridge networking


Current Redis access is split by network mode:

- `backend` now also uses `network_mode: host`
- This changed during Phase 13 extension management because the backend needs direct host-local access to AMI on `127.0.0.1:5038` while still regenerating `/etc/asterisk` config files; the older bridge-networked backend could not reliably reach host-networked Asterisk AMI from Docker bridge networking
- `backend` now reaches PostgreSQL through host-local `127.0.0.1:5432`
- `backend` now reaches Redis through host-local `127.0.0.1:6380`
- `stasis` reaches Redis through host-local `127.0.0.1:6380`

This split exists because `stasis` uses host networking while Redis still runs on bridge networking and host port `6379` was unavailable on this machine.


Current API pagination now implemented:

- `GET /audio` is paginated
- `GET /flows` is paginated
