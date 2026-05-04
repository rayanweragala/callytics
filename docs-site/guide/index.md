# Getting Started

`callytics` is a self-hosted open source call center platform for Linux teams that need programmable IVR, SIP routing, and live monitoring without managed telephony platform lock-in.

## Quick start

```bash
git clone https://github.com/rayanweragala/callytics.git
cd callytics
cp .env.example .env
bash scripts/install.sh
```

Then open `http://localhost:3000`.

## What you get

- Visual IVR flow builder with publishable flow versions
- SIP extensions, trunks, and inbound DID routing
- Outbound campaigns with CSV upload and scheduling
- Live dashboard, call logs, SIP capture, and diagnostics
- WireGuard VPN, SIP firewall, and backup/restore tooling

## Who this is for

- Developers building and testing programmable call flows locally
- Small businesses running self-hosted inbound and outbound call operations
- Teams that want Asterisk power without manual PBX-heavy workflows

## More guides

- [Installation](./install.md)
- [Troubleshooting](./troubleshooting.md)
- [Security](./security.md)

## Credits

- [Sniffnet](https://github.com/GyulyVGC/sniffnet) — design inspiration for the UI theme and color system.
