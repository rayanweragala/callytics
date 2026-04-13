# Install flow

## Install command

The install entry point is:

```bash
npm install -g callytics
```

That installs the CLI package globally. The package should include a postinstall path that prepares the local runtime or guides the user into first run.

## What happens during install

1. npm installs the CLI package and its Node dependencies.
2. The postinstall script checks that the host is Linux.
3. It checks that Docker is installed and the daemon is reachable.
4. It checks for Docker Compose support through `docker compose`.
5. It creates the local app directories for persistent storage.
6. It pulls the required images for Asterisk, Postgres, Redis, backend, and frontend.
7. It writes a local runtime manifest so future runs know the installed version and data path.
8. It asks one optional question: configure a SIP trunk now?

## SIP prompt behavior

If the user chooses SIP setup now:

1. Ask for provider host
2. Ask for username
3. Ask for password or secret
4. Ask for auth ID if different from username
5. Ask for outbound caller ID
6. Ask for allowed codecs
7. Save the settings and mark the trunk as enabled

If the user skips SIP:

- Save an empty or disabled trunk configuration
- Start Asterisk with local endpoint support only
- Keep the app usable through softphones and local extensions
- Show a clear banner in the UI that external calling is not enabled

## Services and ports

Suggested default ports:

- `3000` for the frontend web UI
- `3001` for the backend API
- `5432` for PostgreSQL, bound locally only
- `6380` for Redis on the host, mapped to container port `6379`
- `8088` for Asterisk HTTP and ARI, bound locally only
- `5038` for AMI, bound internally and not exposed publicly by default
- `5080/udp` for SIP
- `10000-10100/udp` for RTP media in local development

Real port values may need to change if conflicts are found, but the installer should prefer stable defaults and only prompt when a conflict exists.

The current working telephony runtime uses host networking for both `asterisk` and `stasis`.

- `asterisk` uses `network_mode: host`
- `stasis` uses `network_mode: host`
- `stasis` reaches ARI at `http://127.0.0.1:8088`
- `stasis` reaches PostgreSQL at `127.0.0.1:5432`

This replaced the older design where Stasis stayed on bridge networking while Asterisk moved to host networking. That older layout broke ARI connectivity during first-call debugging.

The current backend runtime also includes local audio tooling:

- backend container base `node:20-bookworm-slim`
- `python3`, `python3-pip`, `ffmpeg`, and `piper-tts` installed in the backend image
- bundled `en_US-lessac-medium` voice available from first boot
- no network access required for TTS generation after install

Current audio mount expectations:

- backend mounts `./storage` at `/app/storage`, including `./storage/audio/`
- Asterisk mounts `./storage/audio/converted` at `/var/lib/asterisk/sounds/callytics`

## What the user sees when it works

At the end, the CLI should print:

- Web UI URL
- Default admin login or first-run password setup link
- Whether SIP is enabled or skipped
- Container status summary
- A short test checklist such as `open the UI`, `register a softphone`, `place a test call`

The CLI should also provide a health command such as `callytics status` that verifies the containers and prints the local URLs again.

## Reinstall behavior

On reinstall of the same version:

- Reuse existing storage and database volumes
- Pull images only if missing
- Do not wipe audio, flows, or call logs
- Re-run health checks
- Offer to re-run the SIP setup only if the config is empty or invalid

On upgrade to a new version:

- Pull newer images
- Run database migrations if needed
- Regenerate managed Asterisk config if the schema changed
- Keep user data mounted in place

## If Docker is missing

If Docker is not installed or the daemon is not running:

- Stop the install flow early
- Print the exact requirement that failed
- Give distro-agnostic install guidance for Docker
- Exit with a non-zero status

The installer should not try to half-install the product in a broken state.

## Uninstall

Uninstall should have two levels:

- `npm uninstall -g callytics`
  Removes the CLI package only
- `callytics uninstall`
  Stops containers and removes app-managed containers, networks, and optional volumes

The uninstall command should ask whether the user wants to keep:

- Database data
- Audio files
- Voicemail files
- Logs and reports

Default behavior should be safe: remove runtime containers, keep data unless the user explicitly asks to delete it.
