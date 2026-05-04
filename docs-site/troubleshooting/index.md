# Troubleshooting

Common issues and how to fix them when running Callytics.

## 1. "ARI Connection Refused"
If the Stasis service logs show `Connection Refused` to `http://127.0.0.1:8088`:
- **Check Asterisk:** Run `docker compose logs asterisk` and look for `ari.conf` loading errors.
- **Check ARI Credentials:** Ensure `ARI_USER` and `ARI_PASS` in your `.env` match the entries in `asterisk/ari.conf`.
- **Host Networking:** Ensure `network_mode: host` is set for both `asterisk` and `stasis` in `docker-compose.yml`.

## 2. No Audio on Calls (One-way Audio)
Telephony audio (RTP) often fails due to NAT or firewall issues.
- **Port Ranges:** Ensure UDP ports `10000-10100` are open on your host firewall.
- **Local Address:** In `asterisk/pjsip.conf`, check that your `local_net` and `external_media_address` are correctly configured if you are behind a public IP.
- **SIP ALG:** Many routers have a feature called "SIP ALG" that corrupts packets. Disable it if possible.

## 3. UI Shows "Internal Server Error"
- **Database Status:** Ensure PostgreSQL is running and healthy: `docker compose ps`.
- **Migrations:** If you just upgraded, the database schema might be out of date. Check the `backend` logs for migration failures.
- **Redis Port Conflict:** Callytics uses `6380` for Redis. If another service is using that port, the backend will fail to start.

## 4. SIP Registration Fails
- **Wrong Port:** Ensure your softphone is connecting to port `5080`, not the standard `5060`.
- **Firewall Blocked:** If you failed login multiple times, the SIP Firewall might have blocked your IP. Check **SYSTEM -> Firewall -> Blocked IPs**.
- **PJSIP Reload:** After adding an extension, Asterisk needs a reload. In the UI, check **DIAGNOSTICS -> System Health** to ensure ARI/AMI are `connected`.
