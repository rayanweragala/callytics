<script setup>
import { ref } from 'vue'

const copied = ref(false)
let resetTimer

const copyCommand = async () => {
  await navigator.clipboard.writeText('docker compose up -d')
  copied.value = true
  window.clearTimeout(resetTimer)
  resetTimer = window.setTimeout(() => {
    copied.value = false
  }, 2000)
}
</script>

<template>
  <div class="home">
    <header class="hero home-section section-navy-950">
      <div class="home-shell hero-inner">
        <span class="hero-pill">OPEN SOURCE · SELF-HOSTED</span>
        <h1>Self-hosted programmable call center</h1>
        <p>
          docker compose up and you have a full call center with IVR builder, SIP trunks,
          live dashboard, and recordings — no Twilio account needed.
        </p>

        <div class="hero-code">
          <code>docker compose up -d</code>
          <button type="button" @click="copyCommand">{{ copied ? 'COPIED ✓' : 'COPY' }}</button>
        </div>

        <div class="hero-actions">
          <a href="/callytics/guide/" class="button button-primary">Get Started</a>
          <a href="https://github.com/rayanweragala/callytics" target="_blank" rel="noreferrer" class="button button-secondary">View on GitHub</a>
        </div>

        <div class="stat-pills" aria-label="Stack highlights">
          <span>Asterisk 20 · ARI</span>
          <span>PostgreSQL 15</span>
          <span>Redis Pub/Sub</span>
          <span>MIT License</span>
        </div>
      </div>
    </header>

    <section id="why" class="home-section section-navy-900">
      <div class="home-shell">
        <div class="section-heading">
          <span class="section-label">POSITIONING</span>
          <h2>Built different from FreePBX</h2>
          <p>FreePBX is a PBX admin tool. callytics is a programmable telephony platform for developers.</p>
        </div>

        <div class="comparison-wrap">
          <table class="comparison-table">
            <thead>
              <tr>
                <th>FreePBX</th>
                <th>callytics</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Install method:</strong> ISO on bare metal</td>
                <td><strong>Install method:</strong> docker compose up -d</td>
              </tr>
              <tr>
                <td><strong>Call logic:</strong> Static dialplan files</td>
                <td><strong>Call logic:</strong> ARI + Stasis, database-driven</td>
              </tr>
              <tr>
                <td><strong>Live changes:</strong> Reload required</td>
                <td><strong>Live changes:</strong> Instant — no restart</td>
              </tr>
              <tr>
                <td><strong>Developer API:</strong> None</td>
                <td><strong>Developer API:</strong> REST API + WebSocket events</td>
              </tr>
              <tr>
                <td><strong>Outbound dialer:</strong> Paid module</td>
                <td><strong>Outbound dialer:</strong> Included free</td>
              </tr>
              <tr>
                <td><strong>Remote workers:</strong> Port forwarding</td>
                <td><strong>Remote workers:</strong> WireGuard VPN, QR code provisioning</td>
              </tr>
              <tr>
                <td><strong>SIP firewall:</strong> None</td>
                <td><strong>SIP firewall:</strong> Built-in, GeoIP blocking</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="home-section section-navy-950">
      <div class="home-shell pillars-grid">
        <article class="pillar-card">
          <h3>No Twilio</h3>
          <p>callytics runs a full SIP stack on your own server. No API keys, no per-minute charges, no vendor dependency. Your calls never leave your infrastructure.</p>
        </article>
        <article class="pillar-card">
          <h3>Visual IVR Builder</h3>
          <p>Build call flows on a React Flow canvas. Each node — play audio, collect digits, route to queue, transfer, run a webhook — is wired visually. Flows are stored in PostgreSQL and apply to live calls the moment you publish.</p>
        </article>
        <article class="pillar-card">
          <h3>One Command Install</h3>
          <p>A single <code>docker compose up -d</code> starts Asterisk, the Stasis execution engine, NestJS API, PostgreSQL, Redis, and the React frontend. No ISO installs, no bare metal provisioning.</p>
        </article>
      </div>
    </section>

    <section class="home-section section-navy-900">
      <div class="home-shell">
        <div class="section-heading">
          <span class="section-label">FEATURES</span>
          <h2>Everything a call center needs</h2>
        </div>

        <div class="feature-grid">
          <article class="feature-card accent-cyan">
            <span class="feature-accent"></span>
            <h3>IVR Flow Builder</h3>
            <p>Drag and drop nodes onto a canvas to design your call flow. Connect a menu node to business hours logic, fallback to voicemail, or escalate to a live queue. Publish and the change takes effect on the next incoming call.</p>
          </article>
          <article class="feature-card accent-purple">
            <span class="feature-accent"></span>
            <h3>Queues & Operators</h3>
            <p>Route inbound calls into named queues. Operators log in and out of queues from the dashboard. The queue engine tracks wait time, abandonment, and live agent state in Redis — no database polling on the hot path.</p>
          </article>
          <article class="feature-card accent-orange">
            <span class="feature-accent"></span>
            <h3>Outbound Campaigns</h3>
            <p>Upload a CSV of numbers and launch a campaign. The sliding window dialer controls concurrency — you set how many simultaneous calls to run. Failed calls are retried automatically based on your retry policy.</p>
          </article>
          <article class="feature-card accent-teal">
            <span class="feature-accent"></span>
            <h3>WireGuard VPN</h3>
            <p>Remote agents connect their SIP softphone through a WireGuard tunnel. You generate a peer config and QR code from the dashboard. Once connected the softphone registers as if it were on the local network — no port forwarding, no NAT problems.</p>
          </article>
          <article class="feature-card accent-red">
            <span class="feature-accent"></span>
            <h3>SIP Firewall</h3>
            <p>callytics watches SIP REGISTER attempts and blocks IPs that exceed your threshold. Country-based blocking is built in using MaxMind GeoIP. Blocked IPs appear in the dashboard with options to whitelist or permanently ban.</p>
          </article>
          <article class="feature-card accent-green-muted">
            <span class="feature-accent"></span>
            <h3>Backup & Restore</h3>
            <p>Create a snapshot of your PostgreSQL database and recordings volume from the dashboard. Download the archive, store it offsite, and restore it with one click. Useful before upgrades or migrations.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="home-section section-navy-950">
      <div class="home-shell">
        <div class="section-heading">
          <span class="section-label">ARCHITECTURE</span>
          <h2>How a call flows through callytics</h2>
          <p>Every inbound call passes through two planes. The control plane handles configuration, API requests, and database writes. The voice plane handles the real-time call — Asterisk bridges the SIP session, Stasis executes your published flow node by node, and Redis carries live telemetry back to NestJS.</p>
        </div>

        <div class="diagram-wrap">
          <svg class="arch-svg" viewBox="0 0 920 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="callytics control plane and voice plane architecture">
            <defs>
              <marker id="arrowhead-cyan" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#5bb8f5" />
              </marker>
            </defs>

            <rect x="20" y="24" width="880" height="112" rx="6" class="lane" />
            <rect x="20" y="184" width="880" height="112" rx="6" class="lane" />
            <text x="48" y="52" class="lane-label">CONTROL PLANE</text>
            <text x="48" y="212" class="lane-label">VOICE PLANE</text>

            <rect x="54" y="72" width="132" height="44" rx="4" class="arch-box" />
            <text x="120" y="99" text-anchor="middle" class="arch-box-text">Browser</text>
            <rect x="276" y="72" width="132" height="44" rx="4" class="arch-box" />
            <text x="342" y="99" text-anchor="middle" class="arch-box-text">NestJS API</text>
            <rect x="498" y="72" width="132" height="44" rx="4" class="arch-box" />
            <text x="564" y="99" text-anchor="middle" class="arch-box-text">PostgreSQL</text>

            <rect x="54" y="232" width="112" height="44" rx="4" class="arch-box" />
            <text x="110" y="259" text-anchor="middle" class="arch-box-text">SIP Call</text>
            <rect x="210" y="232" width="112" height="44" rx="4" class="arch-box" />
            <text x="266" y="259" text-anchor="middle" class="arch-box-text">Asterisk</text>
            <rect x="366" y="232" width="112" height="44" rx="4" class="arch-box" />
            <text x="422" y="259" text-anchor="middle" class="arch-box-text">Stasis</text>
            <rect x="522" y="232" width="112" height="44" rx="4" class="arch-box" />
            <text x="578" y="259" text-anchor="middle" class="arch-box-text">Redis</text>
            <rect x="708" y="232" width="112" height="44" rx="4" class="arch-box" />
            <text x="764" y="259" text-anchor="middle" class="arch-box-text">NestJS</text>

            <path d="M 186 94 L 266 94" class="arrow" marker-end="url(#arrowhead-cyan)" />
            <path d="M 408 94 L 488 94" class="arrow" marker-end="url(#arrowhead-cyan)" />
            <path d="M 166 254 L 200 254" class="arrow" marker-end="url(#arrowhead-cyan)" />
            <path d="M 322 254 L 356 254" class="arrow" marker-end="url(#arrowhead-cyan)" />
            <path d="M 478 254 L 512 254" class="arrow" marker-end="url(#arrowhead-cyan)" />
            <path d="M 634 254 L 698 254" class="arrow" marker-end="url(#arrowhead-cyan)" />

            <path d="M 422 232 L 422 150 L 342 150 L 342 116" class="arrow arrow-dashed" marker-end="url(#arrowhead-cyan)" />
            <text x="434" y="166" class="cross-label">flow events</text>
            <path d="M 578 232 L 578 150 L 342 150 L 342 116" class="arrow arrow-dashed" marker-end="url(#arrowhead-cyan)" />
            <text x="590" y="166" class="cross-label">live state</text>
          </svg>
        </div>
      </div>
    </section>

    <footer class="home-footer">
      <p><span>callytics</span> — open source call center platform</p>
      <p><a href="https://github.com/rayanweragala/callytics" target="_blank" rel="noreferrer">GitHub</a> · <span>MIT License</span></p>
      <p>Built with Asterisk 20, NestJS, React, PostgreSQL, Redis</p>
    </footer>
  </div>
</template>
