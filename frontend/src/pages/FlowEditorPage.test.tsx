import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowEditorPage } from './FlowEditorPage';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

vi.mock('../lib/api', () => ({
  getFlow: vi.fn(() => Promise.resolve({ data: { id: 1, name: 'Test Flow', nodes: [], edges: [] } })),
  getFlowBreadcrumb: vi.fn(() => Promise.resolve({ data: [] })),
  getFlowTree: vi.fn(() => Promise.resolve({ data: { id: 1, name: 'Test Flow', children: [] } })),
  listAudioVoices: vi.fn(() => Promise.resolve({ data: [], total: 0 })),
  listAudio: vi.fn(() => Promise.resolve({ data: [], total: 0 })),
  listQueues: vi.fn(() => Promise.resolve({ data: [] })),
  listExtensions: vi.fn(() => Promise.resolve({ data: [] })),
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
  it('renders without crashing', () => {
    const router = createMemoryRouter(
      [{ path: '/flows/:id', element: <FlowEditorPage /> }],
      { initialEntries: ['/flows/1'] },
    );

    render(
      <RouterProvider router={router} />
    );
    expect(screen.getByTestId('rf__wrapper')).toBeInTheDocument();
  });
});
