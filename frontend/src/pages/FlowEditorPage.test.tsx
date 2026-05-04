import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FlowEditorPage } from './FlowEditorPage';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  getFlow: vi.fn(() => Promise.resolve({ data: { id: 1, name: 'Test Flow', nodes: [], edges: [] } })),
  getFlowBreadcrumb: vi.fn(() => Promise.resolve({ data: [] })),
  getFlowTree: vi.fn(() => Promise.resolve({ data: { id: 1, name: 'Test Flow', children: [] } })),
  listAudioVoices: vi.fn(() => Promise.resolve({ data: [], total: 0 })),
  listAudio: vi.fn(() => Promise.resolve({ data: [], total: 0 })),
  listQueues: vi.fn(() => Promise.resolve({ data: [] })),
  listExtensions: vi.fn(() => Promise.resolve({
    data: [{ id: 11, username: '2001', password: 'x', displayName: 'Alice', transportType: 'sip', createdAt: '2024-01-01' }],
    total: 1,
  })),
  listOperators: vi.fn(() => Promise.resolve({
    data: [{ id: 21, name: 'Main Operator', status: 'online', extension: undefined, contactNumber: { number: '+94770000000' }, hasPIN: true, createdAt: '2024-01-01' }],
    total: 1,
  })),
  getContactNumbers: vi.fn(() => Promise.resolve({ data: [] })),
  listTrunks: vi.fn(() => Promise.resolve({ data: [] })),
  listFlowVersions: vi.fn(() => Promise.resolve({ data: [] })),
}));

vi.mock('../lib/socket', () => ({
  diagnosticsSocket: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

describe('FlowEditorPage smoke test', () => {
  it('renders without crashing and loads conference node resources', async () => {
    const router = createMemoryRouter(
      [{ path: '/flows/:id', element: <FlowEditorPage /> }],
      { initialEntries: ['/flows/1'] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => expect(api.listExtensions).toHaveBeenCalled());
    await waitFor(() => expect(api.listOperators).toHaveBeenCalled());
    expect(screen.getByTestId('rf__wrapper')).toBeInTheDocument();
  });
});
