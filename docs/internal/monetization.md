# Monetization

`callytics` should make money without making the free product useless.

## What stays free forever

The open source core should include:

- Local install and self-hosted runtime
- Visual flow builder
- Audio upload and offline TTS
- Local SIP endpoint support
- Optional SIP trunk setup
- Live dashboard
- Basic reports
- Single instance administration

If these basics get moved behind a paywall later, the project will lose trust fast.

## What paid tiers can include

Paid features should be about scale, convenience, and enterprise controls.

Possible paid features:

- Hosted cloud version managed by the project team
- Multi-user team collaboration
- Role-based permissions beyond basic admin
- Audit logs
- SSO and SAML
- Advanced analytics and longer retention
- White-label branding for agencies
- Backup automation
- HA deployment support
- Managed updates and support plans

## Hosted version

The hosted version would remove the Docker and local ops burden. The product team would run the telephony stack, database, storage, and monitoring. The customer would still use the same kind of flow builder and dashboard, but through a hosted control panel.

This should not arrive before the self-hosted core is stable. Otherwise the open source version will feel like a funnel instead of a real product.

## SIP trunk marketplace idea

Longer term, there could be a managed SIP marketplace:

- User picks a provider from inside the UI
- The system can pre-fill templates for auth and routing
- The project earns referral or margin revenue
- Support is better because known providers are pre-tested

This can work, but it needs care. If the project starts steering users into one provider too aggressively, people will see it as lock-in.

## Pricing ideas

These are rough and should be tested later:

- Free: self-hosted core
- Pro self-hosted: `$29` to `$99` per month depending on seat count or feature pack
- Hosted starter: `$99` to `$299` per month for small teams
- Agency plan: higher tier with client workspaces and white-label options
- Enterprise: custom pricing for SSO, audit, support, and deployment help

## How open source and paid can coexist

Rules that help keep the balance:

- Keep the local core actually useful
- Be clear about which features are open and which are paid
- Do not cripple exports or backups in the free product
- Accept community contributions in the open core
- Keep the hosted value in operations and managed services, not in removing basics from self-hosted users

Open core can work, but only if the split feels fair.
