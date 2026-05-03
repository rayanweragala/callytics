# SIP Extensions

SIP Extensions are the user and device registrations used by softphones, desk phones, and operator workflows. Callytics provisions extensions from the database so you can manage users and endpoint settings from the browser.

For quick softphone setup, extensions can provide a QR code compatible with Linphone-style onboarding. Teams that want stronger remote-access controls can mark selected extensions as VPN-only, requiring those devices to register through the private WireGuard network.

Extension status is visible in diagnostics, making it easier to confirm whether a phone is registered and reachable. The same extensions can also be used by operators when logging into queues from their softphones.

## Capabilities

- Database-backed PJSIP extension provisioning
- QR code for Linphone-compatible auto-provisioning
- VPN-only restriction toggle
- Extension registration status in diagnostics
- Softphone support
- Operator login flow support
