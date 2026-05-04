# Risks

## Technical risks

### Asterisk complexity

Asterisk is the right base, but it is still Asterisk. Dialplan generation, module behavior, codec handling, and reload safety all have sharp edges. A visual builder can hide complexity from users, but it cannot remove the complexity from the product itself.

### ARI call state complexity

An ARI Stasis runtime gives the product the right control model, but it adds async state-management challenges. The Node.js app has to coordinate event ordering, recover cleanly if it crashes mid-call, clean up bridges and orphaned channels reliably, and make digit collection feel dependable even when callers press keys early or network timing is uneven.

### Cross-distro install pain

The pitch says one command on Linux. Real Linux systems vary a lot. Docker helps, but kernel settings, firewall defaults, audio device differences, SELinux, and missing system packages can still break installs.

### SIP and NAT issues

SIP works badly when network conditions are wrong. NAT, firewall rules, RTP port ranges, provider quirks, and DNS issues can make calls fail in ways that look random to users. This will create support load.

### Keeping up with Asterisk versions

Different Asterisk releases behave differently enough that generated config may break across versions. The project will likely need to support one tested Asterisk version at a time rather than claiming universal support.

### Realtime event accuracy

AMI events are noisy. Correlating channels, bridges, transfers, and queue actions into a clean live dashboard will be harder than it first looks. If the dashboard is wrong, users will stop trusting it.

### Audio conversion edge cases

Bad uploads, unsupported codecs, long files, clipping, and volume mismatch can make prompts sound broken. TTS voices can also sound unnatural enough that users reject them.

### tshark unavailable in CI/runtime

SIP capture depends on `tshark` availability and packet-capture permissions. Some CI environments and minimal hosts do not include `tshark`.

Mitigation:
- Guard capture startup behind `TSHARK_ENABLED === "true"`
- Keep CI default with `TSHARK_ENABLED=false` so backend can boot/test without packet-capture binaries

### Docker image size growth from tshark

Installing tshark in the Asterisk image increases container size and pull/build time.

Mitigation:
- Keep package install scoped to Asterisk image only
- Consider optional slim/non-capture image variants if distribution size becomes a blocker

### rtp.conf Dockerfile append pattern

**Risk:** The `RUN cat >> /etc/asterisk/rtp.conf` pattern in the Dockerfile
appends on every build. If the same setting is appended twice (e.g. rebuild
without cache invalidation on that layer), Asterisk will see duplicate entries.
Asterisk uses last-value-wins for duplicate keys — functionally harmless but
produces noisy config.

**Mitigation:** Acceptable for now. If config management becomes complex,
replace with explicit COPY of full config files into the image.

### RTCP data availability

**Risk:** Asterisk may not emit RTCPReceived / RTCPSent for very short calls
(< 5 seconds), calls that fail before media is established, or calls where
the remote party suppresses RTCP. In these cases no quality data is available.

**Mitigation:** Call Logs renders a grey dash (no badge) when quality is null.
The quality drawer shows "No quality data available for this call." This is
expected behaviour, not an error state.

---

### MOS score accuracy

**Risk:** The simplified E-model used for MOS calculation is an approximation.
It does not account for codec-specific quality (G.711 vs G.729 vs Opus),
background noise, or echo. The score is indicative, not a certified measurement.

**Mitigation:** Labels in the quality drawer are intentionally plain-English
and conservative. Raw metrics (jitter ms, packet loss %, RTT ms) are always
shown alongside MOS so users can assess for themselves.

## Product risks

### The install promise may be too ambitious

One command sounds great, but it creates a very high bar. Every extra manual step weakens the main pitch.

### Small businesses still need support

Even if the UI is simple, telephony is not simple. Users may still need help with trunks, routing, softphones, voicemail, and business-hour logic.

### Open core trust risk

If paid plans are introduced too early or too aggressively, the community may decide the open source version is just bait for a future upsell.

### Scope creep

Call center software can expand forever into CRM, ticketing, workforce management, AI agents, SMS, and analytics. If the product tries to do all of that too early, it may never ship a solid core.

## Market risks

### Competition is real

Hosted vendors already have polished products. FreePBX already has reach. `callytics` needs to win on install speed and usability, not by claiming to beat everyone at everything.

### The audience is split

Developers, agencies, and small business owners want different things. One product can serve them, but the UI, docs, and pricing will pull in different directions.

## Community risks

### Telephony bugs are high pain

If something breaks in a phone system, users treat it as urgent. That changes the support expectations compared with normal open source tools.

### Maintainer burden

If the project succeeds, issue volume may climb fast because installs, SIP providers, and Linux hosts vary widely. The team should expect support and docs work to matter as much as code.
