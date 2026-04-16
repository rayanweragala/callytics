import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { AudioPreviewPlayer } from './AudioPreviewPlayer';

describe('AudioPreviewPlayer', () => {
  it('renders without crashing', () => {
    render(<AudioPreviewPlayer src="test.mp3" />);
    expect(screen.getByText('play')).toBeInTheDocument();
  });

  it('toggles play/pause when button is clicked', async () => {
    render(<AudioPreviewPlayer src="test.mp3" />);
    const playButton = screen.getByText('play');
    
    await act(async () => {
      fireEvent.click(playButton);
    });
    expect(screen.getByText('pause')).toBeInTheDocument();
    
    await act(async () => {
      fireEvent.click(screen.getByText('pause'));
    });
    expect(screen.getByText('play')).toBeInTheDocument();
  });

  it('toggles mute when button is clicked', () => {
    render(<AudioPreviewPlayer src="test.mp3" />);
    const muteButton = screen.getByText('mute');
    
    fireEvent.click(muteButton);
    expect(screen.getByText('muted')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('muted'));
    expect(screen.getByText('mute')).toBeInTheDocument();
  });

  it('handles seek when progress bar changes', async () => {
    render(<AudioPreviewPlayer src="test.mp3" />);
    const range = screen.getByRole('slider');
    
    // Wait for duration to be set via MockAudio constructor's setTimeout
    await waitFor(() => {
      expect(range).toHaveAttribute('max', '100');
    });

    fireEvent.change(range, { target: { value: '10' } });
    expect(range).toHaveValue('10');
  });

  it('formats time correctly', () => {
    render(<AudioPreviewPlayer src="test.mp3" />);
    expect(screen.getByText('00:00 / 00:00')).toBeInTheDocument();
  });
});
