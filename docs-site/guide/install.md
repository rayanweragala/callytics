# Installation

callytics is meant to run on a Linux host with Docker. The default stack starts six containers: Asterisk, Stasis, NestJS API, PostgreSQL, Redis, and the React frontend.

## Supported environments

- Ubuntu 22.04 and 24.04 are tested and supported.
- Linux only.
- Docker 24 or newer.

## Prerequisites

- Linux host.
- Docker Compose v2.
- Ports `80`, `443`, `5080` over UDP and TCP, `8088`, `3000`, and `3001` must be free.
- If you plan to use remote SIP phones through WireGuard, keep UDP port `51820` free as well.

## Run the install script

Clone the repository, create your environment file, then run the install script:

```bash
git clone https://github.com/rayanweragala/callytics.git
cd callytics
cp .env.example .env
bash scripts/install.sh
```

## Required configuration before first start

Before running `bash scripts/install.sh`, copy `.env.example` to `.env` and set these values:

- `HOST_IP` - set to your machine's LAN IP address, not `127.0.0.1`. Run `ip route get 1 | awk '{print $7; exit}'` to find it. Leaving it as `127.0.0.1` means softphones on other devices will fail to register and SIP QR codes will be wrong.
- `RECORDINGS_INTERNAL_TOKEN` - change from the default value. Used to authenticate internal recording requests between Stasis and backend.
- `SIP_PORT` - default `5080`. Only change if that port is already in use on your host.

For manual install flow internals and recovery/reference steps, see `docs/install-flow.md`.

The first boot is slower than later restarts. The Asterisk image builds from source inside the container and usually takes 3-5 minutes on a small VPS. PostgreSQL starts with the `callytics` database, backend migrations run automatically, and the frontend is served on `http://localhost:3000`.

## What's Running

| Service | Port | Purpose |
|---|---:|---|
| `postgres` | `5432` bound to `127.0.0.1` | Stores flows, extensions, trunks, inbound routes, call logs, firewall records, and backup metadata. |
| `redis` | `6380` on the host, `6379` in the container | Carries live call telemetry, queue state, operator state, SIP capture events, and short-lived runtime coordination. |
| `asterisk` | `5080` SIP, `8088` ARI, RTP from the Asterisk config | Handles SIP registration, trunks, media, ARI channels, bridges, recordings, and telephony config reloads. |
| `backend` | `3001` | NestJS API for the dashboard, configuration writes, uploads, recordings, diagnostics, firewall, VPN, and backup operations. |
| `frontend` | `3000` | React dashboard for IVR editing, operators, queues, campaigns, firewall, diagnostics, recordings, and configuration. |
| `stasis` | no public HTTP port | Node execution engine that receives ARI calls from Asterisk, loads the published flow, runs nodes, and emits Redis timeline events. |

## WebRTC softphone support

The browser softphone does not require a separate app. It connects through Asterisk's WebSocket transport on port `8088`, which is now regenerated automatically during backend startup.

The backend also writes WebRTC-specific Asterisk settings automatically:

- WebSocket transport binds on port `8088`
- ICE support is enabled for WebRTC media negotiation
- Docker bridge subnets are auto-discovered and written as `local_net` entries so RTP routing stays correct

## Audio and codec notes

- Asterisk is built with Opus codec support through Sangoma `codec_opus`.
- Audio files are stored as PCM WAV so Asterisk playback stays compatible across prompts and generated media.

## First Boot Timeline

1. Docker pulls the base images and service images needed by the stack.
2. The Asterisk container builds from source. This usually takes 3 to 5 minutes on a small VPS.
3. PostgreSQL initialises the `callytics` database.
4. NestJS starts and runs migrations automatically.
5. The frontend becomes available on port `3000`.
6. Stasis connects to Asterisk ARI on port `8088` and waits for calls.

## Optional VPN Profile

The WireGuard container is opt-in. Start it only when you need VPN peer provisioning for remote softphones:

```bash
docker compose --profile vpn up -d
```

Set `HOST_IP`, `VPN_PUBLIC_IP`, or `WIREGUARD_SERVERURL` in `.env` before generating peer configs if the server is behind NAT or has a public DNS name.

## Verifying the installation

After the stack is up, run through these checks to confirm everything is working:

1. **Dashboard loads** — open `http://localhost:3000`. The React dashboard should load without errors.

2. **All services healthy** — go to Diagnostics. The health panel should show `HEALTHY` for all six services: ARI, AMI, Asterisk, PostgreSQL, Redis, and uptime. If any service shows unhealthy, check its container logs:

   ```bash
   docker compose logs backend
   docker compose logs asterisk
   docker compose logs stasis
   ```

3. **Softphone registers** — configure a SIP client (Linphone, Zoiper, or any PJSIP-compatible softphone) with an extension credential. Set the server to `<host-ip>:5080`. After registration, go to Configure -> Extensions — the extension status should show as registered.

   The browser softphone is available inside the dashboard too. Open the phone bubble, select an operator, click `Connect`, and wait for `Registered`.

4. **Inbound call routes** — go to Configure -> Inbound, create an inbound route with a DID, assign a published flow, and dial the DID from the softphone. The call should execute the flow.

If Diagnostics shows any service as unhealthy, `docker compose logs <service-name>` will show the relevant error output.
