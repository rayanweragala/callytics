import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueuesPage } from './QueuesPage';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  listQueues: vi.fn(),
  listOperators: vi.fn(),
  listAllAudio: vi.fn(),
  createQueue: vi.fn(),
  updateQueue: vi.fn(),
  deleteQueue: vi.fn(),
}));

describe('QueuesPage', () => {
  const mockQueues = {
    data: [{ 
      id: 1, 
      name: 'Support Queue', 
      slug: 'support-queue', 
      waitAudioFileId: null, 
      maxWaitSeconds: 300, 
      pinRetryAttempts: 3, 
      operatorCount: 0, 
      operatorIds: [], 
      operators: [], 
      createdAt: new Date().toISOString() 
    }],
    total: 1,
  };

  it('renders queues table and shows queue name', async () => {
    (api.listQueues as any).mockResolvedValue(mockQueues);
    (api.listOperators as any).mockResolvedValue({ data: [], total: 0 });
    (api.listAllAudio as any).mockResolvedValue({ data: [], total: 0 });

    render(
      <MemoryRouter>
        <QueuesPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Support Queue')).toBeInTheDocument());
  });

  it('opens create form when add queue button is clicked', async () => {
    (api.listQueues as any).mockResolvedValue(mockQueues);
    (api.listOperators as any).mockResolvedValue({ data: [], total: 0 });
    (api.listAllAudio as any).mockResolvedValue({ data: [], total: 0 });

    render(
      <MemoryRouter>
        <QueuesPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Support Queue')).toBeInTheDocument());
    
    fireEvent.click(screen.getByText(/\+ add queue/i));
    expect(screen.getByText('new queue')).toBeInTheDocument();
  });
});
