# SIP Firewall

## Detection mechanism

From `backend/src/firewall/firewall.service.ts`:

- Log parser (`parseSecurityLog`) classifies lines into:
  - `failed_registration`
  - `auth_failure`
  - `invite_flood`
  - `allowed_registration`
- Signals are extracted from patterns such as failed registration/authentication and invite flood strings.
- Per-IP attempts are kept in-memory inside a rolling window:
  - `timeWindowSeconds`
  - `threshold`
- When attempts in window reach threshold, the IP is blocked and persisted.

## iptables command structure

Default enforcement mode is `iptables`.

When a block fires, rule args are built by `buildIptablesDropArgs(ip)`:

- `iptables -I INPUT -s <ip>/32 -j DROP` (IPv4)

Unblock path removes it with:

- `iptables -D INPUT -s <ip>/32 -j DROP`

## GeoIP library and lookup flow

- Library: `@maxmind/geoip2-node`
- DB path: `${GEOIP_DIR}/GeoLite2-Country.mmdb` (default `GEOIP_DIR=/app/geoip`)
- Init flow:
  - if DB missing, optional download attempt when `MAXMIND_LICENSE_KEY` is set
  - open reader via `Reader.open(...)`
- Lookup returns:
  - `countryCode` (ISO)
  - `countryName` (English)
  - fallback: `unknown` / `Unknown`

## Hardcoded protected ranges

Hardcoded non-blockable ranges are:

- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `10.8.0.0/24`
- `127.0.0.1`
- `::1`

If an IP falls in these ranges, block actions are skipped.

## WebSocket channel and payload

Gateway events (`backend/src/firewall/firewall.gateway.ts`):

- client room control: `firewall:subscribe`, `firewall:unsubscribe`
- server emits:
  - `firewall:ready`
  - `firewall:blocked`
  - `firewall:allowed`
  - `firewall:feed`
  - `firewall:stats`

`firewall:feed` payload fields (from `FirewallFeedEvent`):

- `ip`, `countryCode`, `countryName`, `eventType`, `reason`, `detail`, `createdAt`

## What fail2ban opt-in means

Enforcement mode is configurable per firewall config:

- `iptables` mode: direct iptables insert/delete rules from backend.
- `fail2ban` mode: backend delegates ban/unban to fail2ban jail commands:
  - `fail2ban-client set asterisk banip <ip>`
  - `fail2ban-client set asterisk unbanip <ip>`

`fail2banInstalled` is exposed by preflight/config APIs so UI can gate this mode.
