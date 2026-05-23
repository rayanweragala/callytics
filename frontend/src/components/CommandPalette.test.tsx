import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { SidebarNav } from './SidebarNav';
import { renderWithRouter } from '../test/renderWithRouter';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  listFlows: vi.fn(),
  listExtensions: vi.fn(),
  listTrunks: vi.fn(),
  listInboundRoutes: vi.fn(),
  listAllAudio: vi.fn(),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-path">{location.pathname}</div>;
}

function TestShell() {
  return (
    <>
      <SidebarNav />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
      <CommandPalette />
    </>
  );
}

function setNavigatorPlatform(platform: string) {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    setNavigatorPlatform('Win32');
    vi.clearAllMocks();

    vi.mocked(api.listFlows).mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 1000,
      totalPages: 0,
    });
    vi.mocked(api.listExtensions).mockResolvedValue({
      data: [],
      total: 0,
    });
    vi.mocked(api.listTrunks).mockResolvedValue({
      data: [],
      total: 0,
    });
    vi.mocked(api.listInboundRoutes).mockResolvedValue({
      data: [],
      total: 0,
    });
    vi.mocked(api.listAllAudio).mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 1000,
      totalPages: 0,
    });
  });

  it('opens on Ctrl+K and shows the empty recent state', async () => {
    renderWithRouter(<TestShell />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Recent')).toBeInTheDocument();
    expect(within(dialog).getByText('No recent items yet.')).toBeInTheDocument();
  });

  it('opens on Cmd+K on mac platforms', async () => {
    setNavigatorPlatform('MacIntel');
    renderWithRouter(<TestShell />);

    expect(screen.getByRole('button', { name: /command palette/i })).toHaveTextContent('⌘K');

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('does not open while typing in an input', () => {
    renderWithRouter(
      <>
        <input aria-label="Inline editor" />
        <TestShell />
      </>,
    );

    fireEvent.keyDown(screen.getByLabelText('Inline editor'), { key: 'k', ctrlKey: true });

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('orders fuzzy matches by exact, starts-with, contains, then fuzzy and highlights matched text', async () => {
    vi.mocked(api.listFlows).mockResolvedValue({
      data: [
        { id: 1, name: 'alp', description: null, createdAt: '2026-05-20T00:00:00.000Z' },
        { id: 2, name: 'alpha route', description: null, createdAt: '2026-05-20T00:00:00.000Z' },
        { id: 3, name: 'zzalpzz', description: null, createdAt: '2026-05-20T00:00:00.000Z' },
        { id: 4, name: 'a-long-path', description: null, createdAt: '2026-05-20T00:00:00.000Z' },
      ],
      total: 4,
      page: 1,
      limit: 1000,
      totalPages: 1,
    });

    renderWithRouter(<TestShell />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('Search commands');
    fireEvent.change(input, { target: { value: 'alp' } });

    await waitFor(() => {
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(4);
      expect(options[0]).toHaveTextContent('alp');
      expect(options[1]).toHaveTextContent('alpha route');
      expect(options[2]).toHaveTextContent('zzalpzz');
      expect(options[3]).toHaveTextContent('a-long-path');
    });

    const exactMatch = screen.getAllByRole('option')[0];
    expect(within(exactMatch).getByText('alp', { selector: 'mark' })).toBeInTheDocument();
  });

  it('wraps keyboard selection and navigates on Enter', async () => {
    renderWithRouter(<TestShell />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('Search commands');
    fireEvent.change(input, { target: { value: 'log' } });

    await waitFor(() => {
      expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(3);
    });

    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    fireEvent.keyDown(dialog, { key: 'ArrowUp' });

    const selected = screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveTextContent('webhook logs');

    fireEvent.keyDown(dialog, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/webhook-logs');
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    });
  });

  it('shows recent items recorded from sidebar navigation', async () => {
    renderWithRouter(<TestShell />);

    fireEvent.click(screen.getByRole('link', { name: 'settings' }));
    expect(screen.getByTestId('location-path')).toHaveTextContent('/settings');

    fireEvent.click(screen.getByRole('button', { name: /command palette/i }));

    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(within(dialog).getByText('Recent')).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: /settings/i })).toBeInTheDocument();
  });
});
