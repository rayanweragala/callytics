import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExtensionsPage } from './ExtensionsPage';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../lib/api';
import QRCode from 'qrcode';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(() => Promise.resolve('data:image/png;base64,qr')),
  },
}));

vi.mock('../lib/api', () => ({
  listExtensions: vi.fn(),
  getHostConfig: vi.fn(),
  getVpnRelayConfig: vi.fn(),
  getVpnRelayStatus: vi.fn(),
  getVpnStatus: vi.fn(),
  createExtension: vi.fn(),
  updateExtension: vi.fn(),
  deleteExtension: vi.fn(),
  getExtensionQrContent: vi.fn(),
}));

describe('ExtensionsPage coverage boost', () => {
  const mockExtensions = {
    data: [
      { id: 1, username: '101', password: 'secret', displayName: 'User 101', transportType: 'sip' as const, vpnOnly: true, createdAt: new Date().toISOString() },
    ],
    total: 1,
  };

  const mockHostConfig = { hostIp: '127.0.0.1', sipPort: 5060 };
  const mockVpnStatus = { installed: false };

  const mockRelayInactive = { active: false, handshakeEstablished: false, vpsPublicIp: null };

  it('renders extensions and opens create form', async () => {
    vi.mocked(api.listExtensions).mockResolvedValue(mockExtensions);
    vi.mocked(api.getHostConfig).mockResolvedValue(mockHostConfig);
    vi.mocked(api.getVpnRelayStatus).mockResolvedValue(mockRelayInactive);
    vi.mocked(api.getVpnStatus).mockResolvedValue(mockVpnStatus as Awaited<ReturnType<typeof api.getVpnStatus>>);

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('101')).toBeInTheDocument());
    
    fireEvent.click(screen.getByRole('button', { name: /add extension/i }));
    expect(screen.getByText('new extension')).toBeInTheDocument();
  });

  it('shows VPN badge when vpnOnly is true', async () => {
    vi.mocked(api.listExtensions).mockResolvedValue(mockExtensions);
    vi.mocked(api.getHostConfig).mockResolvedValue(mockHostConfig);
    vi.mocked(api.getVpnRelayStatus).mockResolvedValue(mockRelayInactive);
    vi.mocked(api.getVpnStatus).mockResolvedValue(mockVpnStatus as Awaited<ReturnType<typeof api.getVpnStatus>>);

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('VPN Only')).toBeInTheDocument());
  });

  it('disables Require VPN toggle when VPN is not installed', async () => {
    vi.mocked(api.listExtensions).mockResolvedValue(mockExtensions);
    vi.mocked(api.getHostConfig).mockResolvedValue(mockHostConfig);
    vi.mocked(api.getVpnRelayStatus).mockResolvedValue(mockRelayInactive);
    vi.mocked(api.getVpnStatus).mockResolvedValue(mockVpnStatus as Awaited<ReturnType<typeof api.getVpnStatus>>);

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('101')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));

    expect(screen.getByRole('switch', { name: 'Require VPN' })).toBeDisabled();
    expect(screen.getByText('Requires VPN to be installed')).toBeInTheDocument();
  });

  it('create form sends vpnOnly=true when toggle is enabled', async () => {
    vi.mocked(api.listExtensions).mockResolvedValue({ data: [], total: 0 });
    vi.mocked(api.getHostConfig).mockResolvedValue(mockHostConfig);
    vi.mocked(api.getVpnRelayStatus).mockResolvedValue(mockRelayInactive);
    vi.mocked(api.getVpnStatus).mockResolvedValue({ installed: true } as Awaited<ReturnType<typeof api.getVpnStatus>>);
    vi.mocked(api.createExtension).mockResolvedValue({
      data: {
        id: 2,
        username: '102',
        password: 'secret',
        displayName: 'User 102',
        transportType: 'sip',
        vpnOnly: true,
        createdAt: new Date().toISOString(),
      },
    });

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /add extension/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add extension/i }));

    fireEvent.change(screen.getByLabelText('username'), { target: { value: '102' } });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Require VPN' }));
    fireEvent.click(screen.getByRole('button', { name: 'save extension' }));

    await waitFor(() => {
      expect(api.createExtension).toHaveBeenCalledWith(expect.objectContaining({ vpnOnly: true }));
    });
    const payload = vi.mocked(api.createExtension).mock.calls[0]?.[0];
    expect(payload).toMatchObject({ transportType: 'sip', vpnOnly: true });
    expect(payload).not.toHaveProperty('transport_type');
  });

  it('edit form save sends vpnOnly in update payload', async () => {
    vi.mocked(api.listExtensions).mockResolvedValue(mockExtensions);
    vi.mocked(api.getHostConfig).mockResolvedValue(mockHostConfig);
    vi.mocked(api.getVpnRelayStatus).mockResolvedValue(mockRelayInactive);
    vi.mocked(api.getVpnStatus).mockResolvedValue({ installed: true } as Awaited<ReturnType<typeof api.getVpnStatus>>);
    vi.mocked(api.updateExtension).mockResolvedValue({
      data: {
        ...mockExtensions.data[0],
        vpnOnly: false,
      },
    });

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('101')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Require VPN' }));
    fireEvent.click(screen.getByRole('button', { name: 'save changes' }));

    await waitFor(() => {
      expect(api.updateExtension).toHaveBeenCalledWith(1, expect.objectContaining({ vpnOnly: false }));
    });
  });

  it('passes raw newline QR content to generator and displays each line', async () => {
    const qrContent = 'sip:101@10.20.115.95:5080\npassword:secret\ntransport:udp';
    vi.mocked(api.listExtensions).mockResolvedValue(mockExtensions);
    vi.mocked(api.getHostConfig).mockResolvedValue(mockHostConfig);
    vi.mocked(api.getVpnRelayStatus).mockResolvedValue(mockRelayInactive);
    vi.mocked(api.getVpnStatus).mockResolvedValue(mockVpnStatus as Awaited<ReturnType<typeof api.getVpnStatus>>);
    vi.mocked(api.getExtensionQrContent).mockResolvedValue({ data: { content: qrContent } });

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('101')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'qr' }));

    await waitFor(() => {
    expect(QRCode.toDataURL).toHaveBeenCalledWith(qrContent, { width: 220, margin: 1 });
    });
    expect(screen.getByText((_content, element) => element?.textContent === qrContent)).toBeInTheDocument();
  });

  it('shows inline username conflict on create when backend reports inbound DID collision', async () => {
    vi.mocked(api.listExtensions).mockResolvedValue({ data: [], total: 0 });
    vi.mocked(api.getHostConfig).mockResolvedValue(mockHostConfig);
    vi.mocked(api.getVpnRelayStatus).mockResolvedValue(mockRelayInactive);
    vi.mocked(api.getVpnStatus).mockResolvedValue(mockVpnStatus as Awaited<ReturnType<typeof api.getVpnStatus>>);
    vi.mocked(api.createExtension).mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          message: 'This number is already in use as an inbound DID. Choose a different extension number.',
        },
      },
    });

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /add extension/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add extension/i }));
    fireEvent.change(screen.getByLabelText('username'), { target: { value: '2001' } });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'save extension' }));

    expect(await screen.findByText('This number is already in use as an inbound DID. Choose a different extension number.')).toBeInTheDocument();
    expect(screen.queryByText('failed to create extension')).not.toBeInTheDocument();
  });

  it('renders relay SIP URI and badge when relay is active', async () => {
    vi.mocked(api.listExtensions).mockResolvedValue(mockExtensions);
    vi.mocked(api.getHostConfig).mockResolvedValue(mockHostConfig);
    vi.mocked(api.getVpnStatus).mockResolvedValue(mockVpnStatus as Awaited<ReturnType<typeof api.getVpnStatus>>);
    vi.mocked(api.getVpnRelayStatus).mockResolvedValue({ active: true, handshakeEstablished: true, vpsPublicIp: '203.0.113.20' });
    vi.mocked(api.getVpnRelayConfig).mockResolvedValue({
      config: '[Interface]',
      vpsPublicKey: 'vps-key',
      vpsPublicIp: '203.0.113.20',
    });

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('sip:101@203.0.113.20:5080;transport=udp')).toBeInTheDocument();
    expect(screen.getByText('relay')).toBeInTheDocument();
  });

  it('shows LAN IP and no relay badge when relay is inactive', async () => {
    vi.mocked(api.listExtensions).mockResolvedValue(mockExtensions);
    vi.mocked(api.getHostConfig).mockResolvedValue(mockHostConfig);
    vi.mocked(api.getVpnStatus).mockResolvedValue(mockVpnStatus as Awaited<ReturnType<typeof api.getVpnStatus>>);
    vi.mocked(api.getVpnRelayStatus).mockResolvedValue({ active: false, handshakeEstablished: false, vpsPublicIp: null });
    vi.mocked(api.getVpnRelayConfig).mockResolvedValue({ config: null, vpsPublicKey: null, vpsPublicIp: null });

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    // Should show the LAN IP from hostConfig, not a VPS IP
    expect(await screen.findByText(/sip:101@127\.0\.0\.1/)).toBeInTheDocument();
    // The relay badge must not appear
    expect(screen.queryByText('relay')).not.toBeInTheDocument();
  });
});
