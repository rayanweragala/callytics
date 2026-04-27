import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExtensionsPage } from './ExtensionsPage';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  listExtensions: vi.fn(),
  getHostConfig: vi.fn(),
  getVpnStatus: vi.fn(),
  createExtension: vi.fn(),
  updateExtension: vi.fn(),
  deleteExtension: vi.fn(),
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

  it('renders extensions and opens create form', async () => {
    vi.mocked(api.listExtensions).mockResolvedValue(mockExtensions);
    vi.mocked(api.getHostConfig).mockResolvedValue(mockHostConfig);
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
    vi.mocked(api.getVpnStatus).mockResolvedValue(mockVpnStatus as Awaited<ReturnType<typeof api.getVpnStatus>>);

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('VPN only')).toBeInTheDocument());
  });

  it('disables Require VPN toggle when VPN is not installed', async () => {
    vi.mocked(api.listExtensions).mockResolvedValue(mockExtensions);
    vi.mocked(api.getHostConfig).mockResolvedValue(mockHostConfig);
    vi.mocked(api.getVpnStatus).mockResolvedValue(mockVpnStatus as Awaited<ReturnType<typeof api.getVpnStatus>>);

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('101')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));

    expect(screen.getByRole('switch', { name: 'Require VPN' })).toBeDisabled();
    expect(screen.getByText('Enable WireGuard VPN first')).toBeInTheDocument();
  });
});
