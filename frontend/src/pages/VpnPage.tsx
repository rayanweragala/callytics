import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { PageLayout } from '../components/common/PageLayout';
import { VpnPacketExplainer } from '../components/vpn/VpnPacketExplainer';
import {
  activateVpnRelayTunnel,
  createVpnPeer,
  createVpnRelayConfig,
  deactivateVpnRelayTunnel,
  getVpnRelayConfig,
  getVpnRelayStatus,
  getVpnPeerConfig,
  getVpnPeerQrUrl,
  getVpnRelayGuide,
  getVpnStatus,
  listVpnPeers,
  removeVpn,
  revokeVpnPeer,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { RelayGuideStep, RelayTunnelStatus, VpnPeer, VpnStatus } from '../types';
import styles from './VpnPage.module.css';

type VpnTab = 'peers' | 'relay';

const BUILT_IN_COMMAND = 'docker compose --profile vpn up -d wireguard';
const EMPTY_STATUS: VpnStatus = {
  installed: false,
  running: null,
  serverPublicKey: null,
  serverPublicKeyError: null,
  endpoint: null,
  subnet: null,
  peerCount: 0,
  subnetConflict: false,
  subnetConflictDetail: null,
};
const EMPTY_RELAY_STATUS: RelayTunnelStatus = { active: false, handshakeEstablished: false };

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

function truncateKey(value: string | null): string {
  if (!value) {
    return 'unavailable';
  }
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

export function VpnPage() {
  const [status, setStatus] = useState<VpnStatus>(EMPTY_STATUS);
  const [peers, setPeers] = useState<VpnPeer[]>([]);
  const [guide, setGuide] = useState<RelayGuideStep[]>([]);
  const [activeTab, setActiveTab] = useState<VpnTab>('peers');
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [peerName, setPeerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [peerLoading, setPeerLoading] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [qrPeer, setQrPeer] = useState<VpnPeer | null>(null);
  const [peerToRevoke, setPeerToRevoke] = useState<VpnPeer | null>(null);
  const [revokingPeerId, setRevokingPeerId] = useState<number | null>(null);
  const [relayPublicKey, setRelayPublicKey] = useState('');
  const [relayPublicIp, setRelayPublicIp] = useState('');
  const [relayConfig, setRelayConfig] = useState<string | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayTunnelStatus>(EMPTY_RELAY_STATUS);
  const [relayStatusLoading, setRelayStatusLoading] = useState(false);
  const [relayConfigLoading, setRelayConfigLoading] = useState(false);
  const [relayActivateLoading, setRelayActivateLoading] = useState(false);
  const [relayDeactivateLoading, setRelayDeactivateLoading] = useState(false);
  const [relayInlineError, setRelayInlineError] = useState<string | null>(null);
  const [confirmRemoveVpn, setConfirmRemoveVpn] = useState(false);
  const [removingVpn, setRemovingVpn] = useState(false);
  const [successText, setSuccessText] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccess = (msg: string) => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setSuccessText(msg);
    successTimerRef.current = setTimeout(() => setSuccessText(null), 3000);
  };

  const showCopied = (key: string) => {
    setCopiedKey(key);
    if (copyTimer.current) {
      clearTimeout(copyTimer.current);
    }
    copyTimer.current = setTimeout(() => setCopiedKey(null), 2000);
  };

  const copyText = async (key: string, value: string) => {
    setPageError(null);
    try {
      await navigator.clipboard.writeText(value);
      showCopied(key);
    } catch (error) {
      setPageError(getApiError(error, 'failed to copy text'));
    }
  };

  const loadStatus = async () => {
    setPageError(null);
    try {
      const nextStatus = await getVpnStatus();
      setStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      setPageError(getApiError(error, 'failed to load VPN status'));
      return EMPTY_STATUS;
    } finally {
      setLoading(false);
    }
  };

  const loadPeers = async () => {
    try {
      const nextPeers = await listVpnPeers();
      setPeers(nextPeers);
    } catch (error) {
      setPageError(getApiError(error, 'failed to load VPN peers'));
    }
  };

  const loadGuide = async () => {
    setGuideLoading(true);
    try {
      const response = await getVpnRelayGuide();
      setGuide(response.data);
    } catch (error) {
      setPageError(getApiError(error, 'failed to load relay guide'));
    } finally {
      setGuideLoading(false);
    }
  };

  const loadRelayStatus = async () => {
    setRelayStatusLoading(true);
    try {
      const next = await getVpnRelayStatus();
      setRelayStatus(next);
    } catch (error) {
      setPageError(getApiError(error, 'failed to load relay status'));
    } finally {
      setRelayStatusLoading(false);
    }
  };

  const loadRelayConfig = async () => {
    setRelayConfigLoading(true);
    try {
      const data = await getVpnRelayConfig();
      setRelayConfig(data.config);
      setRelayPublicKey(data.vpsPublicKey || '');
      setRelayPublicIp(data.vpsPublicIp || '');
    } catch (error) {
      setPageError(getApiError(error, 'failed to load relay config'));
    } finally {
      setRelayConfigLoading(false);
    }
  };

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const [nextStatus] = await Promise.all([loadStatus(), loadRelayStatus(), loadRelayConfig()]);
        if (nextStatus.installed) {
          await loadPeers();
        }
      } catch (error) {
        setPageError(getApiError(error, 'failed to load VPN page'));
      }
    };
    void loadInitial();
  }, []);

  useEffect(() => {
    if (!status.installed) {
      return undefined;
    }
    pollTimer.current = setInterval(() => {
      void loadPeers();
    }, 10_000);
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [status.installed]);

  useEffect(() => {
    if (activeTab !== 'relay' || guide.length > 0 || guideLoading) {
      return;
    }
    void loadGuide();
  }, [activeTab, guide.length, guideLoading]);

  useEffect(() => {
    if (activeTab !== 'relay') {
      return;
    }
    void Promise.all([loadRelayStatus(), loadRelayConfig()]);
  }, [activeTab]);

  useEffect(() => () => {
    if (copyTimer.current) {
      clearTimeout(copyTimer.current);
    }
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
    }
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
    }
  }, []);

  const handleRefresh = async () => {
    try {
      const nextStatus = await loadStatus();
      if (nextStatus.installed) {
        await loadPeers();
      }
    } catch (error) {
      setPageError(getApiError(error, 'failed to refresh VPN page'));
    }
  };

  const handleAddPeer = async () => {
    const name = peerName.trim();
    if (!name) {
      setPageError('Peer name is required');
      return;
    }
    setPeerLoading(true);
    setPageError(null);
    const optimisticId = -Date.now();
    const optimisticPeer: VpnPeer = {
      id: optimisticId,
      name,
      assignedIp: 'assigning...',
      publicKey: '',
      status: 'offline',
      lastHandshake: null,
      bytesReceived: 0,
      bytesSent: 0,
      createdAt: new Date().toISOString(),
    };
    setPeers((current) => [optimisticPeer, ...current]);
    try {
      const response = await createVpnPeer(name);
      setPeerName('');
      setPeers((current) => current.map((peer) => (peer.id === optimisticId ? response.data : peer)));
      setQrPeer(response.data);
    } catch (error) {
      setPeers((current) => current.filter((peer) => peer.id !== optimisticId));
      setPageError(getApiError(error, 'failed to add VPN peer'));
    } finally {
      setPeerLoading(false);
    }
  };

  const handleDownloadConfig = async (peer: VpnPeer) => {
    setPageError(null);
    try {
      const config = await getVpnPeerConfig(peer.id);
      const blob = new Blob([config], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${peer.name.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'peer'}.conf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setPageError(getApiError(error, 'failed to download peer config'));
    }
  };

  const handleRevoke = async (peer: VpnPeer) => {
    setPeerToRevoke(null);
    setRevokingPeerId(peer.id);
    setPeers((current) => current.filter((item) => item.id !== peer.id));
    try {
      await revokeVpnPeer(peer.id);
      showSuccess(`Revoked ${peer.name}`);
    } catch (error) {
      setPageError(getApiError(error, 'failed to revoke peer'));
      await loadPeers();
    } finally {
      setRevokingPeerId(null);
    }
  };

  const handleRelayConfig = async () => {
    setRelayInlineError(null);
    setPageError(null);
    try {
      const response = await createVpnRelayConfig({
        vpsPublicKey: relayPublicKey.trim(),
        vpsPublicIp: relayPublicIp.trim(),
      });
      setRelayConfig(response.config);
    } catch (error) {
      setPageError(getApiError(error, 'failed to create relay config'));
    }
  };

  const handleActivateRelayTunnel = async () => {
    if (!relayConfig) {
      return;
    }
    setRelayInlineError(null);
    setPageError(null);
    setRelayActivateLoading(true);
    try {
      await activateVpnRelayTunnel(relayConfig);
      await loadRelayStatus();
    } catch (error) {
      const message = getApiError(error, 'failed to activate relay tunnel');
      if (message.toLowerCase().includes('cannot activate relay')) {
        setRelayInlineError('Cannot activate relay — built-in VPN is currently active. Disable it first.');
      } else {
        setRelayInlineError(message);
      }
    } finally {
      setRelayActivateLoading(false);
    }
  };

  const handleDeactivateRelayTunnel = async () => {
    setRelayInlineError(null);
    setPageError(null);
    setRelayDeactivateLoading(true);
    try {
      await deactivateVpnRelayTunnel();
      await loadRelayStatus();
    } catch (error) {
      setRelayInlineError(getApiError(error, 'failed to deactivate relay tunnel'));
    } finally {
      setRelayDeactivateLoading(false);
    }
  };

  const handleRelayDownload = () => {
    if (!relayConfig) {
      return;
    }
    try {
      const blob = new Blob([relayConfig], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'callytics-relay.conf';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setPageError(getApiError(error, 'failed to download relay config'));
    }
  };

  const handleRemoveVpn = async () => {
    setPageError(null);
    setRemovingVpn(true);
    try {
      await removeVpn();
      setConfirmRemoveVpn(false);
      setPeers([]);
      await handleRefresh();
    } catch (error) {
      setPageError(getApiError(error, 'failed to remove VPN'));
    } finally {
      setRemovingVpn(false);
    }
  };

  const actions = (
    <button className={styles.refreshButton} type="button" onClick={() => void handleRefresh()}>
      refresh
    </button>
  );

  if (loading) {
    return (
      <PageLayout title="WireGuard VPN" subtitle="system" actions={actions}>
        <div className={styles.loadingCard}>Loading VPN status...</div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="WireGuard VPN" subtitle="system" actions={actions}>
      <div className={styles.page}>
        <ErrorMessage message={pageError} />
        {successText ? <div className={styles.successRibbon}>{successText}</div> : null}

        {!status.installed ? (
          <section className={styles.notInstalledCard}>
            <p>
              WireGuard lets remote softphones register through a private VPN instead of exposing SIP ports to the internet.
              It is optional, so local-only and LAN deployments can keep running without it.
            </p>
            <div className={styles.optionGrid}>
              <div className={styles.optionCard}>
                <div className={styles.optionTitle}>Built-in VPN</div>
                <div className={styles.optionText}>Run WireGuard on this server. Best for most setups.</div>
                <div className={styles.commandBlock}>
                  <pre>{BUILT_IN_COMMAND}</pre>
                  <button className={styles.copyButton} type="button" onClick={() => void copyText('builtin', BUILT_IN_COMMAND)}>
                    {copiedKey === 'builtin' ? '✓' : 'copy'}
                  </button>
                </div>
                <div className={styles.optionHint}>Run this on your server, then refresh this page.</div>
              </div>
              <div className={styles.optionCard}>
                <div className={styles.optionTitle}>External Relay</div>
                <div className={styles.optionText}>Run WireGuard on a separate VPS. Best if this server has no public IP.</div>
                {relayStatus.active ? (
                  <>
                    <div className={styles.relayCardStatus}>
                      <span className={`${styles.statusDot} ${styles.statusDotRunning}`} />
                      <span className={styles.relayCardStatusLabel}>Relay tunnel active</span>
                    </div>
                    <div className={styles.relayCardHandshake}>
                      {relayStatus.handshakeEstablished ? 'VPS connected' : 'Awaiting VPS handshake'}
                    </div>
                    <div className={styles.relaySoftphoneBlock}>
                      <div className={styles.relaySoftphoneTitle}>Softphone settings</div>
                      <div className={styles.relaySoftphoneRows}>
                        <div className={styles.relaySoftphoneRow}>
                          <span className={styles.relaySoftphoneLabel}>SIP Server</span>
                          <span className={styles.relaySoftphoneValue}>{relayPublicIp || 'unavailable'}</span>
                        </div>
                        <div className={styles.relaySoftphoneRow}>
                          <span className={styles.relaySoftphoneLabel}>Port</span>
                          <span className={styles.relaySoftphoneValue}>5080</span>
                        </div>
                        <div className={styles.relaySoftphoneRow}>
                          <span className={styles.relaySoftphoneLabel}>Transport</span>
                          <span className={styles.relaySoftphoneValue}>UDP</span>
                        </div>
                      </div>
                    </div>
                    <button className={styles.relayDeactivateButton} type="button" onClick={() => void handleDeactivateRelayTunnel()} disabled={relayDeactivateLoading}>
                      {relayDeactivateLoading ? 'deactivating...' : 'Deactivate relay'}
                    </button>
                    <button className={styles.relayGuideLink} type="button" onClick={() => setActiveTab('relay')}>
                      View setup guide
                    </button>
                  </>
                ) : (
                  <button className={styles.secondaryLargeButton} type="button" onClick={() => setActiveTab('relay')}>
                    View Setup Guide
                  </button>
                )}
              </div>
            </div>
            {activeTab === 'relay' ? renderRelayGuide() : null}
          </section>
        ) : (
          <>
            <div className={styles.tabBar}>
              <button className={`${styles.tab} ${activeTab === 'peers' ? styles.tabActive : ''}`} type="button" onClick={() => setActiveTab('peers')}>
                Peers
              </button>
              <button className={`${styles.tab} ${activeTab === 'relay' ? styles.tabActive : ''}`} type="button" onClick={() => setActiveTab('relay')}>
                Relay Setup Guide
              </button>
            </div>
            {activeTab === 'peers' ? renderPeersTab() : renderRelayGuide()}
          </>
        )}
      </div>
      {qrPeer ? (
        <div className={styles.modalShell}>
          <div className={styles.modal}>
            <button className={styles.modalClose} type="button" onClick={() => setQrPeer(null)}>×</button>
            <h2>Connect {qrPeer.name}</h2>
            <img alt={`WireGuard QR for ${qrPeer.name}`} className={styles.qrImage} src={getVpnPeerQrUrl(qrPeer.id)} />
            <div className={styles.modalHint}>Scan with WireGuard app on iOS or Android</div>
            <button className={`${styles.secondaryLargeButton} ${styles.modalDownloadButton}`} type="button" onClick={() => void handleDownloadConfig(qrPeer)}>
              .conf download
            </button>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={peerToRevoke !== null}
        title="Revoke VPN peer"
        message={peerToRevoke ? `Revoke "${peerToRevoke.name}"? This removes access immediately.` : 'Revoke this peer?'}
        cancelLabel="cancel"
        confirmLabel={peerToRevoke && revokingPeerId === peerToRevoke.id ? 'revoking…' : 'revoke'}
        onCancel={() => setPeerToRevoke(null)}
        onConfirm={() => {
          if (peerToRevoke) {
            void handleRevoke(peerToRevoke);
          }
        }}
      />
      <ConfirmDialog
        open={confirmRemoveVpn}
        title="Remove VPN"
        message="Stop and remove WireGuard container? This will disconnect all peers."
        cancelLabel="cancel"
        confirmLabel={removingVpn ? 'removing…' : 'remove'}
        onCancel={() => setConfirmRemoveVpn(false)}
        onConfirm={() => void handleRemoveVpn()}
      />
    </PageLayout>
  );

  function renderPeersTab() {
    return (
      <div className={styles.tabContent}>
        <section className={styles.statusBar}>
          <span className={`${styles.statusDot} ${status.running ? styles.statusDotRunning : styles.statusDotStopped}`} />
          <span className={styles.statusText}>{status.running ? 'WireGuard running' : 'WireGuard stopped'}</span>
          <span>Endpoint: <strong>{status.endpoint || 'unavailable'}</strong></span>
          <span>Subnet: <strong>{status.subnet || 'unavailable'}</strong></span>
          <span className={styles.keyInline}>
            Server public key: {truncateKey(status.serverPublicKey)}
            {status.serverPublicKey ? (
              <button className={styles.inlineCopy} type="button" onClick={() => void copyText('server-key', status.serverPublicKey || '')}>
                {copiedKey === 'server-key' ? '✓' : 'copy'}
              </button>
            ) : null}
          </span>
          {status.serverPublicKeyError ? (
            <span className={styles.serverKeyError}>Public key error: {status.serverPublicKeyError}</span>
          ) : null}
          {status.subnetConflict ? (
            <span className={styles.warningText}>Subnet conflict detected — {status.subnetConflictDetail}</span>
          ) : null}
          <span className={styles.statusActions} />
          <button className={`${styles.secondaryButton} ${styles.removeVpnButton}`} type="button" onClick={() => setConfirmRemoveVpn(true)}>
            Remove VPN
          </button>
        </section>

        <VpnPacketExplainer />

        <section className={styles.addPeerRow}>
          <input
            className={styles.input}
            onChange={(event) => {
              setPageError(null);
              setPeerName(event.target.value);
            }}
            placeholder="peer name"
            value={peerName}
          />
          <button className={styles.primaryButton} type="button" onClick={() => void handleAddPeer()} disabled={peerLoading}>
            {peerLoading ? 'adding...' : 'Add Peer'}
          </button>
        </section>

        <section className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>name</th>
                <th>assigned ip</th>
                <th>status</th>
                <th>last handshake</th>
                <th>data usage</th>
                <th className={styles.actionsHeader}>actions</th>
              </tr>
            </thead>
            <tbody>
              {peers.length === 0 ? (
                <tr>
                  <td className={styles.emptyState} colSpan={6}>No VPN peers yet.</td>
                </tr>
              ) : peers.map((peer) => (
                <tr key={peer.id}>
                  <td className={styles.nameCell}>{peer.name}</td>
                  <td className={styles.dataCell}>{peer.assignedIp}</td>
                  <td><span className={`${styles.statusBadge} ${styles[`status${peer.status}`]}`}>{peer.status}</span></td>
                  <td className={styles.dataCell}>{peer.lastHandshake ? formatDateTime(peer.lastHandshake) : '—'}</td>
                  <td className={styles.dataCell}>↓ {formatBytes(peer.bytesReceived)} ↑ {formatBytes(peer.bytesSent)}</td>
                  <td className={styles.actionsCell}>
                    <div className={styles.actions}>
                      <button className={styles.secondaryButton} type="button" onClick={() => setQrPeer(peer)}>QR</button>
                      <button className={styles.secondaryButton} type="button" onClick={() => void handleDownloadConfig(peer)}>.conf</button>
                      <button className={styles.revokeButton} type="button" onClick={() => setPeerToRevoke(peer)}>revoke</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    );
  }

  function renderRelayGuide() {
    return (
      <section className={styles.guide}>
        {status.installed && status.running ? (
          <div className={styles.relayInfoBar}>
            <span className={styles.relayInfoIcon}>ⓘ</span>
            <span>Built-in VPN is active. This guide is only needed for external relay setups.</span>
          </div>
        ) : null}
        {guideLoading ? <div className={styles.loadingCard}>Loading relay guide...</div> : null}
        {guide.map((step) => (
          <div
            className={`${styles.accordionItem} ${openStep === step.stepNumber ? styles.accordionItemOpen : ''}`}
            key={step.stepNumber}
          >
            <button
              className={styles.accordionHeader}
              type="button"
              onClick={() => setOpenStep((current) => (current === step.stepNumber ? null : step.stepNumber))}
            >
              <span>{step.stepNumber}</span>
              <strong>{step.title}</strong>
              <em>{openStep === step.stepNumber ? '⌄' : '›'}</em>
            </button>
            {openStep === step.stepNumber ? (
              <div className={styles.accordionBody}>
                <p>{step.explanation}</p>
                <div className={styles.commandList}>
                  {step.commands.map((command, index) => (
                    <div className={styles.commandGroup} key={`${step.stepNumber}-${index}`}>
                      <div className={styles.commandLabel}>RUN ON VPS</div>
                      <div className={styles.commandBlock}>
                        <pre>{command.command}</pre>
                        <button className={styles.copyButton} type="button" onClick={() => void copyText(`cmd-${step.stepNumber}-${index}`, command.command)}>
                          {copiedKey === `cmd-${step.stepNumber}-${index}` ? '✓' : 'copy'}
                        </button>
                      </div>
                      <div className={styles.commandExplanation}>{command.explanation}</div>
                      {command.verification ? (
                        <>
                          <div className={styles.verifyLabel}>VERIFY</div>
                          <div className={styles.commandBlock}>
                            <pre className={styles.verifyBlock}>{command.verification}</pre>
                            <button className={styles.copyButton} type="button" onClick={() => void copyText(`verify-${step.stepNumber}-${index}`, command.verification || '')}>
                              {copiedKey === `verify-${step.stepNumber}-${index}` ? '✓' : 'copy'}
                            </button>
                          </div>
                          <div className={styles.verificationExpected}>You should see {command.verificationExpected}</div>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
                {step.values?.length ? (
                  <div className={styles.relayValues}>
                    {step.values.map((item) => (
                      <div className={styles.relayValueRow} key={`${step.stepNumber}-${item.label}`}>
                        <span className={styles.relayValueLabel}>{item.label}:</span>
                        <span className={styles.relayValueText}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {step.stepNumber === 6 ? (
                  <div className={styles.relayForm}>
                    <input className={styles.input} placeholder="VPS Public Key" value={relayPublicKey} onChange={(event) => setRelayPublicKey(event.target.value)} />
                    <input className={styles.input} placeholder="VPS Public IP" value={relayPublicIp} onChange={(event) => setRelayPublicIp(event.target.value)} />
                    <button className={styles.primaryButton} type="button" onClick={() => void handleRelayConfig()}>generate config</button>
                    {relayConfig ? (
                      <div className={styles.relayConfigResult}>
                        <div className={styles.commandLabel}>CALLYTICS CONFIG</div>
                        <pre>{relayConfig}</pre>
                        <button className={styles.copyButton} type="button" onClick={() => void copyText('relay-config', relayConfig)}>
                          {copiedKey === 'relay-config' ? '✓' : 'copy'}
                        </button>
                        <div className={styles.relayActions}>
                          <button className={styles.primaryButton} type="button" onClick={() => void handleActivateRelayTunnel()} disabled={relayActivateLoading}>
                            {relayActivateLoading ? 'activating...' : 'Activate relay tunnel'}
                          </button>
                          <button className={styles.secondaryLargeButton} type="button" onClick={handleRelayDownload}>Download config</button>
                        </div>
                        <div className={styles.relayStatusRow}>
                          <span className={relayStatus.active ? styles.relayStatusActive : styles.relayStatusInactive}>
                            {relayStatusLoading || relayConfigLoading
                              ? 'Checking tunnel status...'
                              : relayStatus.active && relayStatus.handshakeEstablished
                                ? 'Tunnel active — connected to VPS'
                                : relayStatus.active
                                  ? 'Tunnel active — awaiting VPS handshake'
                                  : 'Tunnel inactive'}
                          </span>
                          {relayStatus.active ? (
                            <button className={styles.relayDeactivateButton} type="button" onClick={() => void handleDeactivateRelayTunnel()} disabled={relayDeactivateLoading}>
                              {relayDeactivateLoading ? 'deactivating...' : 'Deactivate'}
                            </button>
                          ) : null}
                        </div>
                        {relayInlineError ? <div className={styles.relayInlineError}>{relayInlineError}</div> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </section>
    );
  }
}
