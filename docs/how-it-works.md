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
- The Stasis app starts in Docker, connects to PostgreSQL, runs migrations, and seeds a published test flow if none exists
- Incoming calls enter Asterisk through the static dialplan and are handed to the `callytics` Stasis app
- The Stasis app loads the published flow from PostgreSQL, creates an in-memory call session, and executes the flow node by node
- The first implemented node executors are `start`, `play_audio`, `get_digits`, `branch`, `transfer`, `voicemail`, `hangup`, and `set_variable`
- The current seed flow is a simple test path using built-in Asterisk sounds: `start -> greet -> menu -> bye`

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
