# SIP Firewall

SIP Firewall protects the phone system from common SIP abuse patterns such as repeated failed registrations and INVITE floods. It watches live security activity, detects suspicious behavior, and can automatically block abusive IP addresses when configured thresholds are crossed.

The firewall is designed for day-to-day operations as well as incident response. You can review a live security feed, see where traffic is coming from, manage blocked addresses, and keep trusted networks on a whitelist so legitimate devices are not interrupted.

For teams that already use fail2ban, Callytics can operate in an opt-in mode that delegates enforcement to the existing fail2ban setup instead of managing blocks directly.

## Capabilities

- Automatic detection of registration abuse
- Automatic detection of INVITE flood patterns
- Threshold-based auto-blocking
- Network-level blocking enforcement
- Live security feed for recent firewall activity
- Radar-style view of suspicious SIP activity
- GeoIP country detection for remote addresses
- Blocked IP management with unblock support
- Whitelist support for trusted addresses and networks
- Daily security statistics
- Optional fail2ban enforcement mode
