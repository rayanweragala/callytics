import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowEditorPage } from './FlowEditorPage';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../lib/api', () => ({
  getFlow: vi.fn(() => Promise.resolve({ data: { id: 1, name: 'Test Flow', nodes: [], edges: [] } })),
  getFlowBreadcrumb: vi.fn(() => Promise.resolve({ data: [] })),
  getFlowTree: vi.fn(() => Promise.resolve({ data: { id: 1, name: 'Test Flow', children: [] } })),
  listAudioVoices: vi.fn(() => Promise.resolve({ data: [], total: 0 })),
  listAudio: vi.fn(() => Promise.resolve({ data: [], total: 0 })),
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
    render(
      <MemoryRouter initialEntries={['/flows/1']}>
        <Routes>
          <Route path="/flows/:id" element={<FlowEditorPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('rf__wrapper')).toBeInTheDocument();
  });
});
