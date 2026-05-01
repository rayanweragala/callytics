# WireGuard VPN

WireGuard VPN gives remote softphone users a secure private path into Callytics without exposing SIP registration to the public internet. Instead of opening SIP directly to every network, teams can require selected extensions to register only through the VPN.

Admins can create VPN peers for users, hand them a QR code for quick mobile setup, or provide a downloadable configuration file for desktop clients. The peer list also helps operators see who is active and how much traffic each peer has used.

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

External relay mode is for teams where the Callytics server is behind NAT or 
has no public IP address. Instead of running WireGuard on the Callytics host, 
a small public VPS acts as the WireGuard relay server. Remote softphones 
connect to the VPS, which tunnels traffic back to Callytics over a private 
WireGuard link.

This means softphones on mobile data or remote networks can register and make 
calls without any port forwarding on the Callytics host.

### When to use relay mode

- Your Callytics server is on a LAN with no public IP
- You cannot or do not want to open SIP ports on your router
- You want a dedicated public endpoint for softphone registration separate 
  from your Callytics host

### How it works

1. Spin up a small VPS (1 CPU, 512MB RAM is enough)
2. Open the VPN page in Callytics and click **View Setup Guide** under 
   External Relay
3. Follow the nine-step guide — Callytics generates all configuration 
   automatically
4. Click **Activate relay tunnel** — no terminal commands needed on the 
   Callytics host
5. Configure your softphone to register to the VPS public IP on port 5080

Once active, the VPN page shows the relay status and softphone connection 
settings directly on the main card.

### Requirements

- A public VPS running Ubuntu or Debian with WireGuard installed
- UDP port 51820 open on the VPS for WireGuard
- UDP port 5080 open on the VPS for SIP

### Limitations

- Relay mode and built-in VPN mode cannot run simultaneously
- The relay tunnel does not survive a Callytics restart automatically — 
  reactivate via the UI after restart