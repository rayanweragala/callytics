import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AudioPage } from './AudioPage';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  listAudio: vi.fn(),
  listAudioVoices: vi.fn(),
  uploadAudio: vi.fn(),
  createTts: vi.fn(),
  deleteAudio: vi.fn(),
}));

describe('AudioPage coverage boost', () => {
  const mockAudioList = {
    data: [
      { id: 1, name: 'Welcome', sourceType: 'upload', conversionStatus: 'completed', createdAt: new Date().toISOString() },
      { id: 2, name: 'Intro', sourceType: 'tts', conversionStatus: 'completed', createdAt: new Date().toISOString() },
    ],
    total: 2,
    page: 1,
    limit: 10,
    totalPages: 1,
  };

  const mockVoices = {
    data: [{ id: 'v1', name: 'Voice 1', language: 'en-US' }],
    total: 1,
  };

  it('renders audio items and handles delete click', async () => {
    (api.listAudio as any).mockResolvedValue(mockAudioList);
    (api.listAudioVoices as any).mockResolvedValue(mockVoices);

    render(
      <MemoryRouter>
        <AudioPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Welcome')).toBeInTheDocument());
    expect(screen.getByText('Intro')).toBeInTheDocument();

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByText('Delete this audio? This cannot be undone.')).toBeInTheDocument();
  });
});
