// @vitest-environment jsdom
import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/api', () => {
  return {
    listAudio: vi.fn(() => Promise.resolve({
      data: [
        { id: 1, name: 'Welcome', sourceType: 'upload', conversionStatus: 'completed', createdAt: new Date().toISOString() },
        { id: 2, name: 'Intro', sourceType: 'tts', conversionStatus: 'completed', createdAt: new Date().toISOString() },
      ],
      total: 2,
      page: 1,
      limit: 5,
      totalPages: 1,
    })),
    listAudioVoices: vi.fn(() => Promise.resolve({
      data: [{ value: 'v1', label: 'Voice 1' }],
      total: 1,
    })),
    uploadAudio: vi.fn(),
    createTts: vi.fn(),
    deleteAudio: vi.fn(),
    previewTts: vi.fn(),
    updateAudio: vi.fn(),
  };
});

import { AudioPage } from './AudioPage';

describe('AudioPage coverage boost', () => {
  it('renders audio items and handles delete click', async () => {
    render(
      <MemoryRouter>
        <AudioPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Welcome')).toBeInTheDocument();
    expect(await screen.findByText('Intro')).toBeInTheDocument();

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);
    
    expect(await screen.findByText(/Delete this audio\?/i)).toBeInTheDocument();
  });
});
