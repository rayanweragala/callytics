# callytics overview

`callytics` is a self-hosted call center platform for Linux that installs with one npm command and runs on `localhost`.

It exists because the current choices are rough. Hosted tools like Twilio, Genesys, and similar products are expensive fast. FreePBX and raw Asterisk are powerful, but they ask users to learn PBX concepts, edit config files, and debug telephony issues by hand.

The goal is not to replace everything Asterisk can do. The goal is to wrap the common small-business call center setup in a product that is easier to install, easier to understand, and easier to change.

The main users are:

- Small businesses that need IVR, routing, voicemail, and basic reporting without enterprise pricing
- Developers who want a local phone system they can test and automate
- Agencies setting up phone systems for clients
- Startups that need a working call flow before they can pay for a hosted stack

What makes it different:

- One command install instead of a manual PBX setup
- A visual call flow builder instead of hand-written dialplan files
- Works locally even without a SIP trunk
- Keeps Asterisk underneath, but hides most of the painful parts

This project is open core. The local self-hosted core stays free and open source. Paid features come later and should add convenience, not take the basics away.


Current implementation note:

- The core runtime path is now proven end to end through Asterisk 20, ARI, PostgreSQL-backed flow loading, and the Node.js Stasis execution engine.
- During first-call debugging both `asterisk` and `stasis` were moved to `network_mode: host`. This replaced the older bridge-networked Stasis setup because ARI connectivity broke after Asterisk moved to host networking.
- Asterisk log storage is now bind-mounted from host `./asterisk/logs` into both runtime services that need it:
  - New state: `asterisk` mounts `./asterisk/logs:/var/log/asterisk` and `backend` mounts `./asterisk/logs:/var/log/asterisk:ro`.
  - Old state: neither service mounted `/var/log/asterisk` from the host, so log files were only container-local.
  - Why changed: Phase 24 adds a UI log viewer backed by `GET /asterisk/logs`, so backend must read the same persisted `messages` file that Asterisk writes.
- Phase 8 adds a working audio management slice: a frontend audio library page, upload and offline TTS generation, browser preview playback, and backend-managed conversion/storage.
- Offline TTS is now bundled and functional inside the backend container rather than remaining a future plan.
- NestJS now serves generated and uploaded media from `/media/audio/...` so the browser can preview the same assets that back the telephony runtime.
