# WireGuard VPN

## Docker Engine API approach (not shelling out to `wg` directly)

`backend/src/vpn/vpn.service.ts` executes WireGuard commands through Docker Engine API over Unix socket (`/var/run/docker.sock`):

1. `POST /containers/callytics-wireguard-1/exec` (create exec)
2. `POST /exec/<id>/start` (run command)
3. Parse Docker multiplexed stdout/stderr stream frames
4. `GET /exec/<id>/json` (read exit code)

This is implemented in `execInWireguard()`. The backend does not run `wg` directly on host for peer lifecycle operations.

## Peer config generation

`buildPeerConfig()` creates a full client config string with:

- `[Interface]`
  - generated peer `PrivateKey`
  - peer `Address = <assignedIp>/24`
  - `DNS = 1.1.1.1`
- `[Peer]`
  - server `PublicKey` from `wg show wg0 public-key`
  - `Endpoint = <resolvedEndpointHost>:51820`
  - `AllowedIPs = 10.8.0.0/24`
  - `PersistentKeepalive = 25`

Peer allocation uses `10.8.0.2`..`10.8.0.254` from DB-tracked assignments.

## QR code generation

`getPeerQr()` generates PNG bytes from the config text using `qrcode` package:

- `QRCode.toBuffer(config, { type: 'png', width: 320, margin: 1 })`
- Exposed via `GET /vpn/peers/:id/qr`.

## `vpnOnly` extension flag and SIP enforcement

Enforcement lives in `backend/src/extensions/extensions.service.ts`:

- When `vpnOnly=true`, extension endpoint flags include:
  - `acl = <username>-vpn-acl`
  - `#include pjsip_callytics_vpn_<username>.conf`
- Generated ACL file content is fixed:
  - `deny = 0.0.0.0/0.0.0.0`
  - `permit = 10.8.0.0/24`

So registration/auth is restricted at PJSIP ACL level to VPN subnet traffic.

## VPN-related env vars and when to change them

These are the three variables used by current code/compose paths:

- `HOST_IP`
  - Used as fallback endpoint host (`VPN_PUBLIC_IP || HOST_IP || 127.0.0.1`) in VPN service and config APIs.
  - Change when the server LAN/publicly reachable host address changes.
- `VPN_PUBLIC_IP`
  - Explicit override for peer endpoint host in backend VPN service.
  - Set this when public endpoint differs from `HOST_IP` (NAT, reverse path, static public IP).
- `WIREGUARD_SERVERURL`
  - Used by `wireguard` container as `SERVERURL` (`docker-compose.yml`).
  - Set when linuxserver/wireguard auto-detection is wrong; keep `auto` if detection is valid.
