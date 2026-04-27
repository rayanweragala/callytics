import { useEffect, useRef, useState } from 'react';
import styles from './VpnPacketExplainer.module.css';

const comparisonRows = [
  {
    layer: 'Transport',
    withoutVpn: 'UDP unencrypted',
    withVpn: 'WireGuard encrypted tunnel',
  },
  {
    layer: 'SIP Contact IP',
    withoutVpn: 'Private LAN IP — unreachable',
    withVpn: 'VPN IP 10.8.0.x — reachable',
  },
  {
    layer: 'RTP path',
    withoutVpn: 'Blocked by NAT',
    withVpn: 'Flows through tunnel',
  },
  {
    layer: 'SIP ALG risk',
    withoutVpn: 'High — may corrupt headers',
    withVpn: 'None — tunnel is opaque',
  },
  {
    layer: 'Credentials',
    withoutVpn: 'Plaintext',
    withVpn: 'Encrypted',
  },
  {
    layer: 'Ports to forward',
    withoutVpn: '5080 + 10000–20000',
    withVpn: 'UDP 51820 only',
  },
];

export function VpnPacketExplainer() {
  const [expanded, setExpanded] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const withoutPanelRef = useRef<HTMLDivElement | null>(null);
  const withoutDotRef = useRef<HTMLDivElement | null>(null);
  const withoutSoftphoneRef = useRef<HTMLSpanElement | null>(null);
  const withoutNatRef = useRef<HTMLSpanElement | null>(null);
  const withoutInternetRef = useRef<HTMLSpanElement | null>(null);
  const withoutAsteriskRef = useRef<HTMLSpanElement | null>(null);
  const withoutHoveredRef = useRef(false);
  const withPanelRef = useRef<HTMLDivElement | null>(null);
  const withDotRef = useRef<HTMLDivElement | null>(null);
  const withSoftphoneRef = useRef<HTMLSpanElement | null>(null);
  const withNatRef = useRef<HTMLSpanElement | null>(null);
  const withAsteriskRef = useRef<HTMLSpanElement | null>(null);
  const withHoveredRef = useRef(false);

  useEffect(() => {
    let frameId = 0;
    let currentIndex = 0;
    let phase: 'pause' | 'move' = 'pause';
    let phaseElapsed = 0;
    let lastFrameTime = 0;

    const draw = (timestamp: number) => {
      const panel = withoutPanelRef.current;
      const dot = withoutDotRef.current;
      const softphone = withoutSoftphoneRef.current;
      const nat = withoutNatRef.current;
      const internet = withoutInternetRef.current;
      const asterisk = withoutAsteriskRef.current;
      if (!panel || !dot || !softphone || !nat || !internet || !asterisk) {
        frameId = window.requestAnimationFrame(draw);
        return;
      }

      const panelRect = panel.getBoundingClientRect();
      const waypoints = [softphone, nat, internet, asterisk].map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.left - panelRect.left + (rect.width / 2),
          y: rect.top - panelRect.top,
        };
      });

      if (waypoints.length < 2) {
        frameId = window.requestAnimationFrame(draw);
        return;
      }

      if (lastFrameTime === 0) {
        lastFrameTime = timestamp;
      }
      const delta = timestamp - lastFrameTime;
      lastFrameTime = timestamp;

      if (!withoutHoveredRef.current) {
        phaseElapsed += delta;
      }

      let x = waypoints[currentIndex].x;
      let y = waypoints[currentIndex].y;
      const nextIndex = (currentIndex + 1) % waypoints.length;

      if (phase === 'pause') {
        const pauseMs = currentIndex === 0 || currentIndex === 3 ? 600 : 400;
        if (phaseElapsed >= pauseMs) {
          phase = 'move';
          phaseElapsed = 0;
        }
      }

      if (phase === 'move') {
        const t = Math.min(phaseElapsed / 500, 1);
        const from = waypoints[currentIndex];
        const to = waypoints[nextIndex];
        x = from.x + ((to.x - from.x) * t);
        y = from.y + ((to.y - from.y) * t);
        if (phaseElapsed >= 500) {
          currentIndex = nextIndex;
          phase = 'pause';
          phaseElapsed = 0;
          x = waypoints[currentIndex].x;
          y = waypoints[currentIndex].y;
        }
      }

      dot.style.transform = `translateX(${x - 4}px) translateY(${y - 4}px)`;
      frameId = window.requestAnimationFrame(draw);
    };

    frameId = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    let currentIndex = 0;
    let phase: 'pause' | 'move' = 'pause';
    let phaseElapsed = 0;
    let lastFrameTime = 0;

    const draw = (timestamp: number) => {
      const panel = withPanelRef.current;
      const dot = withDotRef.current;
      const softphone = withSoftphoneRef.current;
      const asterisk = withAsteriskRef.current;
      if (!panel || !dot || !softphone || !asterisk) {
        frameId = window.requestAnimationFrame(draw);
        return;
      }

      const panelRect = panel.getBoundingClientRect();
      const waypoints = [softphone, asterisk].map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.left - panelRect.left + (rect.width / 2),
          y: rect.top - panelRect.top,
        };
      });

      if (waypoints.length < 2) {
        frameId = window.requestAnimationFrame(draw);
        return;
      }

      if (lastFrameTime === 0) {
        lastFrameTime = timestamp;
      }
      const delta = timestamp - lastFrameTime;
      lastFrameTime = timestamp;

      if (!withHoveredRef.current) {
        phaseElapsed += delta;
      }

      let x = waypoints[currentIndex].x;
      let y = waypoints[currentIndex].y;
      const nextIndex = (currentIndex + 1) % waypoints.length;

      if (phase === 'pause') {
        if (phaseElapsed >= 600) {
          phase = 'move';
          phaseElapsed = 0;
        }
      }

      if (phase === 'move') {
        const t = Math.min(phaseElapsed / 350, 1);
        const from = waypoints[currentIndex];
        const to = waypoints[nextIndex];
        x = from.x + ((to.x - from.x) * t);
        y = from.y + ((to.y - from.y) * t);
        if (phaseElapsed >= 350) {
          currentIndex = nextIndex;
          phase = 'pause';
          phaseElapsed = 0;
          x = waypoints[currentIndex].x;
          y = waypoints[currentIndex].y;
        }
      }

      dot.style.transform = `translateX(${x - 4}px) translateY(${y - 4}px)`;
      frameId = window.requestAnimationFrame(draw);
    };

    frameId = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <section className={styles.explainerCard}>
      <button className={styles.toggle} onClick={() => setExpanded((current) => !current)} type="button">
        <span>How does VPN help with SIP? ↓</span>
        <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}>›</span>
      </button>

      {expanded ? (
        <div className={styles.body}>
          <div className={styles.panelGrid}>
            <article className={`${styles.panel} ${styles.panelBad}`}>
              <div className={styles.panelLabelBad}>WITHOUT VPN</div>

              <div
                className={styles.flowBad}
                onMouseEnter={() => {
                  withoutHoveredRef.current = true;
                }}
                onMouseLeave={() => {
                  withoutHoveredRef.current = false;
                }}
                ref={withoutPanelRef}
              >
                <div className={styles.packetDotBad} ref={withoutDotRef} />
                <div className={styles.flowRow}>
                  <span className={styles.flowBox} ref={withoutSoftphoneRef}>Softphone</span>
                  <span className={styles.flowArrow}>→</span>
                  <span className={styles.flowBox} ref={withoutNatRef}>NAT Router</span>
                  <span className={styles.flowArrow}>→</span>
                  <span className={styles.flowBox} ref={withoutInternetRef}>Internet</span>
                  <span className={styles.flowArrow}>→</span>
                  <span className={styles.flowBox} ref={withoutAsteriskRef}>Asterisk</span>
                </div>
              </div>

              <div className={styles.annotationList}>
                <div className={styles.annotationBad}><span>✕</span><span>SIP Contact header exposes private IP — Asterisk can't reach it</span></div>
                <div className={styles.annotationBad}><span>✕</span><span>Router may rewrite SIP headers (SIP ALG)</span></div>
                <div className={styles.annotationBad}><span>✕</span><span>RTP ports 10000–20000 must be forwarded</span></div>
              </div>

              <div className={styles.snippetLabel}>WHAT ASTERISK SEES</div>
              <pre className={styles.snippet}>
                Contact: sip:user@<span className={styles.ipBad}>192.168.1.45</span>:5060
              </pre>
            </article>

            <article className={`${styles.panel} ${styles.panelGood}`}>
              <div className={styles.panelLabelGood}>WITH WIREGUARD VPN</div>

              <div
                className={styles.flowGood}
                onMouseEnter={() => {
                  withHoveredRef.current = true;
                }}
                onMouseLeave={() => {
                  withHoveredRef.current = false;
                }}
                ref={withPanelRef}
              >
                <div className={styles.packetDotGood} ref={withDotRef} />
                <div className={styles.flowRow}>
                  <span className={styles.flowBox} ref={withSoftphoneRef}>Softphone</span>
                  <span className={styles.arrowGroup}>
                    <span className={styles.tunnelBadge}>encrypted tunnel</span>
                    <span className={styles.flowArrow}>→</span>
                  </span>
                  <span className={styles.natStack}>
                    <span className={`${styles.flowBox} ${styles.natBypassed}`} ref={withNatRef}>NAT Router</span>
                    <span className={styles.bypassedLabel}>bypassed</span>
                  </span>
                  <span className={styles.flowArrow}>→</span>
                  <span className={styles.flowBox} ref={withAsteriskRef}>Asterisk</span>
                </div>
              </div>

              <div className={styles.annotationList}>
                <div className={styles.annotationGood}><span>✓</span><span>VPN IP in Contact header — Asterisk reaches it directly</span></div>
                <div className={styles.annotationGood}><span>✓</span><span>No SIP ALG — WireGuard tunnel is opaque to router</span></div>
                <div className={styles.annotationGood}><span>✓</span><span>No port forwarding needed — UDP 51820 only</span></div>
              </div>

              <div className={styles.snippetLabel}>WHAT ASTERISK SEES</div>
              <pre className={styles.snippet}>
                Contact: sip:user@<span className={styles.ipGood}>10.8.0.2</span>:5060
              </pre>
            </article>
          </div>

          <button className={styles.toggle} onClick={() => setDetailExpanded((current) => !current)} type="button">
            <span>Show packet-level detail ↓</span>
            <span className={`${styles.chevron} ${detailExpanded ? styles.chevronOpen : ''}`}>›</span>
          </button>

          {detailExpanded ? (
            <div className={styles.tableCard}>
              <table className={styles.comparisonTable}>
                <thead>
                  <tr>
                    <th>LAYER</th>
                    <th>WITHOUT VPN</th>
                    <th>WITH VPN</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => (
                    <tr key={row.layer}>
                      <td className={styles.layerCell}>{row.layer}</td>
                      <td className={styles.badCell}>{row.withoutVpn}</td>
                      <td className={styles.goodCell}>{row.withVpn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
