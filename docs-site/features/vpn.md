# WireGuard VPN

WireGuard VPN gives remote softphone users a secure private path into Callytics without exposing SIP registration to the public internet. Instead of opening SIP directly to every network, you can require selected extensions to register only through the VPN.

You can create VPN peers for users, hand them a QR code for quick mobile setup, or provide a downloadable configuration file for desktop clients. The peer list also lets you see who is active and how much traffic each peer has used.

WireGuard clients are available for iOS, Android, macOS, Windows, and Linux, so the same onboarding flow works for phones, laptops, and desktop softphone setups.

## Capabilities

- Secure remote softphone access without publicly exposing SIP registration
- Create VPN peers for individual users or devices
- QR-code onboarding for mobile WireGuard clients
- Downloadable configuration files for desktop clients
- VPN-only restriction for selected SIP extensions
- Peer status monitoring for active and inactive connections
- Data usage visibility per peer
- Client support across iOS, Android, macOS, Windows, and Linux

## External Relay Mode

External relay mode is for teams where the Callytics server is behind NAT or has no public IP address. Instead of running WireGuard on the Callytics host, a small public VPS acts as the WireGuard relay server. Remote softphones connect to the VPS, which tunnels traffic back to Callytics over a private WireGuard link.

This means softphones on mobile data or remote networks can register and make calls without any port forwarding on the Callytics host.

### When to use relay mode

- Your Callytics server is on a LAN with no public IP
- You cannot or do not want to open SIP ports on your router
- You want a dedicated public endpoint for softphone registration separate from your Callytics host

### How it works

1. Spin up a small VPS (1 CPU, 512MB RAM is enough)
2. Open the VPN page in Callytics and click **View Setup Guide** under External Relay
3. Follow the nine-step guide — Callytics generates all configuration automatically
4. Click **Activate relay tunnel** — no terminal commands needed on the Callytics host
5. Configure your softphone to register to the VPS public IP on port 5080

Once active, the VPN page shows the relay status and softphone connection settings directly on the main card.

### Requirements

- A public VPS running Ubuntu or Debian with WireGuard installed
- UDP port 51820 open on the VPS for WireGuard
- UDP port 5080 open on the VPS for SIP

### Limitations

- Relay mode and built-in VPN mode cannot run simultaneously
- The relay tunnel does not survive a Callytics restart automatically — reactivate via the UI after restart

## How relay mode works technically

### Network path

When relay is active, SIP and RTP traffic follow this path:

```
Phone (mobile data)
        │
        │ SIP + RTP
        ▼
VPS public IP :5080
        │
        │ WireGuard tunnel
        ▼
callytics-relay container
(Docker bridge 172.20.x.x)
        │
        │ DNAT/SNAT
        ▼
host Asterisk :5080
(host network)
```

### What Callytics generates automatically

When you activate relay mode, Callytics generates two PJSIP configuration files and reloads them into Asterisk via AMI:

**`pjsip_relay.conf`** — sets the transport-level NAT overrides so Asterisk advertises the correct address in SIP headers:

- `external_signaling_address = <VPS public IP>` — used in the `Contact` and `Via` headers of outgoing SIP messages
- `external_media_address = <VPS public IP>` — used in the `c=` line of SDP, telling the remote party where to send RTP

**`pjsip_extensions_relay.conf`** — adds per-endpoint RTP overrides to every SIP extension endpoint:

- `media_address = <VPS public IP>` — forces RTP to advertise the VPS IP for this endpoint
- `rtp_symmetric = yes` — sends RTP to wherever packets arrive from, handling any NAT port remapping mid-call

### Why `10.8.0.0/24` must NOT be in `local_net`

Asterisk's `local_net` setting tells it which addresses to treat as local (and therefore not requiring NAT rewriting). The WireGuard subnet `10.8.0.0/24` must not be in `local_net`.

If it is, Asterisk sees the WireGuard tunnel peer `10.8.0.1` as a local address. It then uses the Docker bridge IP in the `Contact` header instead of the VPS public IP, which breaks call setup — the remote party receives an unreachable address for SIP signaling.

### Why `mixing,dtmf_events` bridge type is required

When Stasis creates a bridge to connect two call parties, it always uses bridge type `mixing,dtmf_events`. This is required for NAT relay scenarios.

If a plain `mixing` bridge is used, Asterisk can upgrade it to a native RTP bridge after call answer. In a native RTP bridge, Asterisk steps out of the RTP path entirely — the two endpoints exchange RTP directly. Through a NAT relay, this breaks audio after approximately 30 seconds when NAT bindings expire or change.

Using `mixing,dtmf_events` prevents the native bridge upgrade and keeps Asterisk in the media path throughout the call.

### `strictrtp=no` in `rtp.conf`

Callytics always sets `strictrtp=no` in Asterisk's `rtp.conf`. This prevents RTP packet drops when the source address of incoming RTP changes mid-call — a common occurrence when calls are routed through NAT. Without this setting, Asterisk may reject RTP packets from a new source port after a NAT binding changes.