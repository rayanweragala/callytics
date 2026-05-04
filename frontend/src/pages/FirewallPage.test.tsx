import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FirewallPage } from './FirewallPage';
import type { FirewallConfig, FirewallFeedEvent, FirewallStats } from '../types';

const socketState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  socket: {
    connected: true,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      socketState.handlers.set(event, handler);
    }),
    off: vi.fn((event: string) => {
      socketState.handlers.delete(event);
    }),
    emit: vi.fn(),
  },
}));

vi.mock('../lib/socket', () => ({ diagnosticsSocket: socketState.socket }));

const apiMock = vi.hoisted(() => ({
  getFirewallConfig: vi.fn(),
  getFirewallStats: vi.fn(),
  listFirewallBlockedIps: vi.fn(),
  listFirewallEvents: vi.fn(),
  unblockFirewallIp: vi.fn(),
  updateFirewallConfig: vi.fn(),
  whitelistFirewallIp: vi.fn(),
}));

vi.mock('../lib/api', () => apiMock);

const config: FirewallConfig = {
  enforcementMode: 'iptables',
  threshold: 5,
  timeWindowSeconds: 300,
  blockDurationSeconds: 86400,
  trunkCeilings: { '1': 10 },
  fail2banInstalled: false,
};

const stats: FirewallStats = {
  totalBlockedToday: 3,
  totalAttemptsToday: 14,
  topIps: [{ ip: '198.51.100.8', countryCode: 'US', attemptCount: 9 }],
  topCountries: [{ countryCode: 'US', countryName: 'United States', count: 9 }],
  hourly: Array.from({ length: 24 }, (_value, hour) => ({ hour, count: hour === 10 ? 5 : 0 })),
  trunks: [{ id: 1, name: 'main trunk', activeCalls: 2, ceiling: 10 }],
};

const feed: FirewallFeedEvent = {
  ip: '198.51.100.8',
  countryCode: 'US',
  countryName: 'United States',
  eventType: 'blocked',
  reason: 'failed registration',
  detail: 'bad password',
  createdAt: '2026-04-27T10:00:00.000Z',
};

beforeEach(() => {
  socketState.handlers.clear();
  vi.clearAllMocks();
  apiMock.getFirewallConfig.mockResolvedValue(config);
  apiMock.getFirewallStats.mockResolvedValue(stats);
  apiMock.listFirewallBlockedIps.mockResolvedValue({ data: [{ id: 1, ip: '198.51.100.8', countryCode: 'US', countryName: 'United States', attemptCount: 9, reason: 'failed registration', enforcementMode: 'iptables', expiresAt: null, createdAt: '2026-04-27T10:00:00.000Z', isWhitelisted: false }], total: 1 });
  apiMock.listFirewallEvents.mockResolvedValue({ data: [feed], total: 1, page: 1, limit: 200, totalPages: 1 });
  apiMock.updateFirewallConfig.mockResolvedValue(config);
  apiMock.unblockFirewallIp.mockResolvedValue(undefined);
  apiMock.whitelistFirewallIp.mockResolvedValue({ id: 2, ip: '198.51.100.8' });
});

describe('FirewallPage', () => {
  it('renders without crashing', async () => {
    render(<FirewallPage />);

    expect(await screen.findByText('SIP Firewall')).toBeInTheDocument();
    expect(screen.getByText('blocked today')).toBeInTheDocument();
    expect(screen.getByText('main trunk')).toBeInTheDocument();
  });

  it('renders live feed events and accepts websocket feed updates', async () => {
    render(<FirewallPage />);

    expect(await screen.findByText(/198\.51\.100\.8 failed registration/)).toBeInTheDocument();
    const handler = socketState.handlers.get('firewall:feed');
    expect(handler).toBeDefined();
    handler?.({ ...feed, ip: '203.0.113.77', createdAt: '2026-04-27T10:01:00.000Z' });

    expect(await screen.findByText(/203\.0\.113\.77 failed registration/)).toBeInTheDocument();
  });

  it('renders blocked IP cards and fires unblock handler', async () => {
    render(<FirewallPage />);

    expect((await screen.findAllByText('198.51.100.8')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'unblock' }));

    await waitFor(() => expect(apiMock.unblockFirewallIp).toHaveBeenCalledWith('198.51.100.8'));
  });

  it('opens settings drawer and slider updates config', async () => {
    render(<FirewallPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'settings' }));
    const threshold = screen.getAllByDisplayValue('5')[0];
    fireEvent.change(threshold, { target: { value: '8' } });

    await waitFor(() => expect(apiMock.updateFirewallConfig).toHaveBeenCalledWith(expect.objectContaining({ threshold: 8 })));
  });
});
