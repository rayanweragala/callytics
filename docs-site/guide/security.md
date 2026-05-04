# Security

## Network exposure and ports

Open only the ports you actually need:

- `5080` UDP/TCP for SIP signaling.
- `10000-20000` UDP for RTP media.
- `3000` and `3001` only if you intentionally expose the web UI/API outside localhost.

Keep all other service ports private unless you have a clear operational requirement.

## Data stored locally

Callytics is designed to keep runtime data on the host:

- Call logs and execution traces
- Call recordings and audio assets
- Extension and telephony configuration

No application data is sent to an external hosted control plane by default. Data remains on your infrastructure unless you explicitly integrate external services.

## ENCRYPTION_KEY

`ENCRYPTION_KEY` controls encryption at rest for the WireGuard relay private key:

- Optional in development.
- Recommended in production.
- When set, it should be a 64-character hex key.

If unset or invalid, Callytics falls back to derived-key behavior. For production systems, set a strong explicit key and manage it as a secret.
