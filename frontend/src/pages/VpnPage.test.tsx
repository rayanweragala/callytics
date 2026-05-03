import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateVpnRelayTunnel,
  createVpnPeer,
  createVpnRelayConfig,
  deactivateVpnRelayTunnel,
  getVpnRelayConfig,
  getVpnRelayStatus,
  getVpnRelayGuide,
  getVpnStatus,
  listVpnPeers,
  removeVpn,
  revokeVpnPeer,
} from '../lib/api';
import { VpnPage } from './VpnPage';

vi.mock('../lib/api', () => ({
  createVpnPeer: vi.fn(),
  createVpnRelayConfig: vi.fn(),
  activateVpnRelayTunnel: vi.fn(),
  deactivateVpnRelayTunnel: vi.fn(),
  getVpnPeerConfig: vi.fn(),
  getVpnPeerQrUrl: vi.fn((id: number) => `http://localhost:3001/vpn/peers/${id}/qr`),
  getVpnRelayConfig: vi.fn(),
  getVpnRelayGuide: vi.fn(),
  getVpnRelayStatus: vi.fn(),
  getVpnStatus: vi.fn(),
  listVpnPeers: vi.fn(),
  removeVpn: vi.fn(),
  revokeVpnPeer: vi.fn(),
}));

const installedStatus = {
  installed: true,
  running: true,
  serverPublicKey: 'server-public-key-long-value',
  serverPublicKeyError: null,
  endpoint: '203.0.113.10:51820',
  subnet: '10.8.0.0/24',
  peerCount: 1,
  subnetConflict: false,
  subnetConflictDetail: null,
};

const peers = [
  {
    id: 1,
    name: 'Alice Phone',
    assignedIp: '10.8.0.2',
    publicKey: 'alice-public',
    status: 'active' as const,
    lastHandshake: '2026-04-27T10:00:00.000Z',
    bytesReceived: 24_300_000,
    bytesSent: 8_100_000,
    createdAt: '2026-04-27T09:00:00.000Z',
  },
  {
    id: 2,
    name: 'Bob Laptop',
    assignedIp: '10.8.0.3',
    publicKey: 'bob-public',
    status: 'idle' as const,
    lastHandshake: null,
    bytesReceived: 0,
    bytesSent: 0,
    createdAt: '2026-04-27T09:00:00.000Z',
  },
];

describe('VpnPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVpnRelayGuide).mockResolvedValue({ data: [] });
    vi.mocked(getVpnRelayConfig).mockResolvedValue({ config: null, vpsPublicKey: null, vpsPublicIp: null });
    vi.mocked(getVpnRelayStatus).mockResolvedValue({ active: false, handshakeEstablished: false, vpsPublicIp: null, transitioning: false, error: null });
    vi.mocked(activateVpnRelayTunnel).mockResolvedValue({ accepted: true });
    vi.mocked(deactivateVpnRelayTunnel).mockResolvedValue({ accepted: true });
    vi.mocked(removeVpn).mockResolvedValue({ success: true });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders not-installed option cards', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue({
      installed: false,
      running: null,
      serverPublicKey: null,
      serverPublicKeyError: null,
      endpoint: null,
      subnet: null,
      peerCount: 0,
      subnetConflict: false,
      subnetConflictDetail: null,
    });

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    expect(await screen.findByText('Built-in VPN')).toBeInTheDocument();
    expect(screen.getByText('External Relay')).toBeInTheDocument();
  });

  it('copy button on command block shows checkmark', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue({
      installed: false,
      running: null,
      serverPublicKey: null,
      serverPublicKeyError: null,
      endpoint: null,
      subnet: null,
      peerCount: 0,
      subnetConflict: false,
      subnetConflictDetail: null,
    });

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    await screen.findByText('Built-in VPN');
    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '✓' })).toBeInTheDocument());
  });

  it('renders peers table with status badges', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue(installedStatus);
    vi.mocked(listVpnPeers).mockResolvedValue(peers);

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    expect(await screen.findByText('Alice Phone')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('opens QR modal from QR action', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue(installedStatus);
    vi.mocked(listVpnPeers).mockResolvedValue(peers);

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    await screen.findByText('Alice Phone');
    fireEvent.click(screen.getAllByRole('button', { name: 'QR' })[0]);

    expect(screen.getByText('Connect Alice Phone')).toBeInTheDocument();
    expect(screen.getByAltText('WireGuard QR for Alice Phone')).toHaveAttribute('src', 'http://localhost:3001/vpn/peers/1/qr');
  });

  it('revoke confirm dialog appears and removes row on confirm', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue(installedStatus);
    vi.mocked(listVpnPeers).mockResolvedValue(peers);
    vi.mocked(revokeVpnPeer).mockResolvedValue(undefined);

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    await screen.findByText('Alice Phone');
    fireEvent.click(screen.getAllByRole('button', { name: 'revoke' })[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Revoke VPN peer')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'revoke' }));

    await waitFor(() => expect(screen.queryByText('Alice Phone')).not.toBeInTheDocument());
  });

  it('opens QR modal after adding a peer', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue(installedStatus);
    vi.mocked(listVpnPeers).mockResolvedValue([]);
    vi.mocked(createVpnPeer).mockResolvedValue({
      data: {
        id: 9,
        name: 'New Phone',
        assignedIp: '10.8.0.9',
        publicKey: 'new-public',
        privateKey: 'new-private',
        config: '[Interface]',
        status: 'offline',
        lastHandshake: null,
        bytesReceived: 0,
        bytesSent: 0,
        createdAt: '2026-04-27T09:00:00.000Z',
      },
    });

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    await screen.findByPlaceholderText('peer name');
    fireEvent.change(screen.getByPlaceholderText('peer name'), { target: { value: 'New Phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Peer' }));

    expect(await screen.findByText('Connect New Phone')).toBeInTheDocument();
  });

  it('shows relay tunnel status and activate button after config generation', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue(installedStatus);
    vi.mocked(listVpnPeers).mockResolvedValue([]);
    vi.mocked(createVpnRelayConfig).mockResolvedValue({ config: '[Interface]\nPrivateKey = relay-key' });
    vi.mocked(getVpnRelayGuide).mockResolvedValue({
      data: [
        {
          stepNumber: 6,
          title: 'Generate the Callytics-side peer config',
          explanation: 'step',
          commands: [],
        },
        {
          stepNumber: 9,
          title: 'Connect your softphone',
          explanation: 'step',
          commands: [],
          values: [
            { label: 'SIP server', value: '203.0.113.20' },
            { label: 'Port', value: '5080' },
            { label: 'Transport', value: 'UDP' },
          ],
        },
      ],
    });

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Relay Setup Guide' }));
    fireEvent.click(await screen.findByRole('button', { name: /Generate the Callytics-side peer config/i }));
    fireEvent.change(screen.getByPlaceholderText('VPS Public Key'), { target: { value: 'vps-key' } });
    fireEvent.change(screen.getByPlaceholderText('VPS Public IP'), { target: { value: '203.0.113.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'generate config' }));

    expect(await screen.findByText('Tunnel inactive')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activate relay tunnel' }));
    await waitFor(() => expect(activateVpnRelayTunnel).toHaveBeenCalled());
  });

  it('restores relay config and input values from backend on relay tab load', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue(installedStatus);
    vi.mocked(listVpnPeers).mockResolvedValue([]);
    vi.mocked(getVpnRelayGuide).mockResolvedValue({
      data: [
        {
          stepNumber: 6,
          title: 'Generate the Callytics-side peer config',
          explanation: 'step',
          commands: [],
        },
        {
          stepNumber: 9,
          title: 'Connect your softphone',
          explanation: 'step',
          commands: [],
          values: [
            { label: 'SIP server', value: '203.0.113.20' },
            { label: 'Port', value: '5080' },
            { label: 'Transport', value: 'UDP' },
          ],
        },
      ],
    });
    vi.mocked(getVpnRelayConfig).mockResolvedValue({
      config: '[Interface]\nPrivateKey = relay-key\n[Peer]\nPublicKey = vps-key\nEndpoint = 203.0.113.20:51820\n',
      vpsPublicKey: 'vps-key',
      vpsPublicIp: '203.0.113.20',
    });
    vi.mocked(getVpnRelayStatus).mockResolvedValue({ active: true, handshakeEstablished: true, vpsPublicIp: '203.0.113.20', transitioning: false, error: null });

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Relay Setup Guide' }));
    fireEvent.click(await screen.findByRole('button', { name: /Generate the Callytics-side peer config/i }));

    expect(await screen.findByDisplayValue('vps-key')).toBeInTheDocument();
    expect(screen.getByDisplayValue('203.0.113.20')).toBeInTheDocument();
    expect(screen.getByText('Tunnel active — connected to VPS')).toBeInTheDocument();
    expect(screen.getByText((value) => value.includes('PrivateKey = relay-key') && value.includes('Endpoint = 203.0.113.20:51820'))).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /Connect your softphone/i }));
    expect(screen.getByText('SIP server:')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.20')).toBeInTheDocument();
  });

  it('shows relay active awaiting handshake state in step 6 when the relay is up but the VPS is not connected yet', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue(installedStatus);
    vi.mocked(listVpnPeers).mockResolvedValue([]);
    vi.mocked(getVpnRelayGuide).mockResolvedValue({
      data: [
        {
          stepNumber: 6,
          title: 'Generate the Callytics-side peer config',
          explanation: 'step',
          commands: [],
        },
      ],
    });
    vi.mocked(getVpnRelayConfig).mockResolvedValue({
      config: '[Interface]\nPrivateKey = relay-key\n[Peer]\nPublicKey = vps-key\nEndpoint = 203.0.113.20:51820\n',
      vpsPublicKey: 'vps-key',
      vpsPublicIp: '203.0.113.20',
    });
    vi.mocked(getVpnRelayStatus).mockResolvedValue({ active: true, handshakeEstablished: false, vpsPublicIp: '203.0.113.20', transitioning: false, error: null });

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Relay Setup Guide' }));
    fireEvent.click(await screen.findByRole('button', { name: /Generate the Callytics-side peer config/i }));

    expect(await screen.findByText('Tunnel active — awaiting VPS handshake')).toBeInTheDocument();
    expect(screen.queryByText('Tunnel inactive')).not.toBeInTheDocument();
  });

  it('shows relay active state on external relay card and deactivates without opening guide', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue({
      installed: false,
      running: null,
      serverPublicKey: null,
      serverPublicKeyError: null,
      endpoint: null,
      subnet: null,
      peerCount: 0,
      subnetConflict: false,
      subnetConflictDetail: null,
    });
    vi.mocked(getVpnRelayStatus).mockResolvedValue({
      active: true, handshakeEstablished: false, vpsPublicIp: '203.0.113.55', transitioning: false, error: null,
    });
    vi.mocked(getVpnRelayConfig).mockResolvedValue({
      config: '[Interface]',
      vpsPublicKey: 'vps-key',
      vpsPublicIp: '203.0.113.55',
    });

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    expect(await screen.findByText('Relay tunnel active')).toBeInTheDocument();
    expect(screen.getByText('Awaiting VPS handshake')).toBeInTheDocument();
    expect(screen.getByText('Softphone settings')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.55')).toBeInTheDocument();
    expect(screen.getByText('5080')).toBeInTheDocument();
    expect(screen.getByText('UDP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate relay' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View setup guide' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate relay' }));
    await waitFor(() => expect(deactivateVpnRelayTunnel).toHaveBeenCalled());
    // After 202, the UI enters transitioning state immediately — both relay-card
    // buttons should show the transitioning label and be disabled.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Disconnecting...' }).length).toBeGreaterThan(0));
  });

  it('does not show softphone settings block when relay is inactive', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue({
      installed: false,
      running: null,
      serverPublicKey: null,
      serverPublicKeyError: null,
      endpoint: null,
      subnet: null,
      peerCount: 0,
      subnetConflict: false,
      subnetConflictDetail: null,
    });
    vi.mocked(getVpnRelayStatus).mockResolvedValue({ active: false, handshakeEstablished: false, vpsPublicIp: null, transitioning: false, error: null });
    vi.mocked(getVpnRelayConfig).mockResolvedValue({ config: null, vpsPublicKey: null, vpsPublicIp: null });

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    // Wait for the page to settle
    expect(await screen.findByText('External Relay')).toBeInTheDocument();
    expect(screen.queryByText('Softphone settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Relay tunnel active')).not.toBeInTheDocument();
  });

  it('renders steps 7-9 and copies full multiline config for step 7', async () => {
    vi.mocked(getVpnStatus).mockResolvedValue({
      installed: false,
      running: null,
      serverPublicKey: null,
      serverPublicKeyError: null,
      endpoint: null,
      subnet: null,
      peerCount: 0,
      subnetConflict: false,
      subnetConflictDetail: null,
    });
    const step7Config = '[Interface]\nPrivateKey = <YOUR_VPS_PRIVATE_KEY>\nAddress = 10.8.0.2/24\nListenPort = 51820\n\n[Peer]\nPublicKey = real-key\nEndpoint = 192.168.1.10:51820\nAllowedIPs = 10.8.0.0/24\nPersistentKeepalive = 25';
    vi.mocked(getVpnRelayGuide).mockResolvedValue({
      data: [
        { stepNumber: 7, title: 'Configure WireGuard on the VPS', explanation: 'step7', commands: [{ command: step7Config, explanation: 'exp', verification: null, verificationExpected: null }, { command: 'sudo wg-quick up wg0', explanation: 'exp', verification: 'sudo wg show', verificationExpected: 'peer listed' }] },
        { stepNumber: 8, title: 'Verify the tunnel is up', explanation: 'step8', commands: [{ command: 'ping -c 4 10.8.0.1', explanation: 'exp', verification: null, verificationExpected: 'replies' }] },
        { stepNumber: 9, title: 'Connect your softphone', explanation: 'step9', commands: [], values: [{ label: 'SIP server', value: '203.0.113.20' }, { label: 'Port', value: '5080' }, { label: 'Transport', value: 'UDP' }] },
      ],
    });

    render(<MemoryRouter><VpnPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'View Setup Guide' }));
    fireEvent.click(await screen.findByRole('button', { name: /Configure WireGuard on the VPS/i }));
    const step7Body = screen.getByText('step7').parentElement;
    if (!step7Body) {
      throw new Error('step 7 body not found');
    }
    fireEvent.click(within(step7Body).getAllByRole('button', { name: 'copy' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Verify the tunnel is up/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Connect your softphone/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(step7Config);
    expect(screen.getByText('SIP server:')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.20')).toBeInTheDocument();
  });
});
