import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RecordingsPage } from './RecordingsPage';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  listRecordings: vi.fn(),
  listFlows: vi.fn(),
  deleteRecording: vi.fn(),
}));

describe('RecordingsPage coverage boost', () => {
  const mockRecordings = {
    data: [
      { id: 1, callId: 'call-1', fileName: 'rec1.wav', durationSeconds: 60, createdAt: new Date().toISOString() },
    ],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  };

  it('renders recordings list', async () => {
    (api.listRecordings as any).mockResolvedValue(mockRecordings);
    (api.listFlows as any).mockResolvedValue({ data: [] });

    render(
      <MemoryRouter>
        <RecordingsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('call-1')).toBeInTheDocument());
  });
});
