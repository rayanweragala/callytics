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

Current important infrastructure state:

- `asterisk`: `network_mode: host`
- `stasis`: `network_mode: host`
- `stasis` uses `ARI_URL=http://127.0.0.1:8088`
- `stasis` uses `DB_HOST=127.0.0.1`
- `backend` uses bridge networking and talks to Postgres/Redis by service name
- `stasis` uses host-local Redis at `127.0.0.1:6380`
