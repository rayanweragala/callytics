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

## Audio handling

- `ffmpeg`
  Chosen because users will upload mixed formats and Asterisk wants predictable output. We are not relying on users to pre-convert files themselves.

## Text to speech

- `Piper`
  Chosen because it runs offline, is good enough for product prompts, and avoids tying core functionality to a paid cloud API. Cloud TTS can be an optional addon later.

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
