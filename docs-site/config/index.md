# Config Reference

Environment variables below are taken from repository `.env.example` exactly.

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `DB_HOST` | `localhost` | Yes | PostgreSQL host used by backend and stasis. Change when DB is not local host network. |
| `DB_PORT` | `5432` | Yes | PostgreSQL TCP port. Wrong value blocks DB connections/migrations. |
| `DB_NAME` | `callytics` | Yes | Database name used for all application tables. |
| `DB_USER` | `callytics` | Yes | Database login user. Must match DB role permissions. |
| `DB_PASS` | `callytics` | Yes | Database password for `DB_USER`. Wrong value breaks startup and backup/restore DB commands. |
| `REDIS_HOST` | `localhost` | Yes | Redis host for pub/sub, queue state, campaign/callback signaling, streams. |
| `REDIS_PORT` | `6379` | Yes | Redis TCP port. Wrong value disables runtime event flow and queue state operations. |
| `ARI_URL` | `http://127.0.0.1:8088` | Yes | Asterisk ARI base URL used by stasis. |
| `ARI_USER` | `callytics` | Yes | ARI username for API auth. |
| `ARI_PASS` | `callytics` | Yes | ARI password for API auth. |
| `ARI_APP` | `callytics` | Yes | Stasis application name Asterisk routes calls into. |
| `AMI_HOST` | `127.0.0.1` | Yes | Asterisk AMI host used by backend config/diagnostics tooling. |
| `AMI_PORT` | `5038` | Yes | Asterisk AMI port. |
| `AMI_USER` | `callytics` | Yes | AMI login username. |
| `AMI_PASS` | `callytics` | Yes | AMI login password. |
| `BACKEND_PORT` | `3001` | Yes | HTTP port for NestJS backend service. |
| `NODE_ENV` | `development` | No | Node runtime environment mode. |
| `RECORDINGS_INTERNAL_TOKEN` | `change-me-in-production` | Yes | Shared token for internal recording persistence endpoint (`/recordings/internal`). |
| `HOST_IP` | `127.0.0.1` | Yes | Host machine IP used in config/provisioning responses and VPN endpoint fallback logic. |
| `SIP_PORT` | `5080` | Yes | SIP listening port advertised by backend host config endpoint. |
| `PUID` | `1000` | No | WireGuard container runtime UID (linuxserver image setting). |
| `PGID` | `1000` | No | WireGuard container runtime GID (linuxserver image setting). |
| `TZ` | `UTC` | No | Container timezone (used by WireGuard container and schedule context). |

## Notes

- Variables `VPN_PUBLIC_IP` and `WIREGUARD_SERVERURL` are used in VPN runtime/compose logic, but they are not present in `.env.example` at repository root.
