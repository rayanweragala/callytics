import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVpnPeer,
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
  getVpnPeerConfig: vi.fn(),
  getVpnPeerQrUrl: vi.fn((id: number) => `http://localhost:3001/vpn/peers/${id}/qr`),
  getVpnRelayGuide: vi.fn(),
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
    vi.mocked(removeVpn).mockResolvedValue({ success: true });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
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
});
