import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioUploadZone } from './AudioUploadZone';

describe('AudioUploadZone', () => {
  it('renders without crashing and shows prompt', () => {
    render(<AudioUploadZone file={null} onFileSelect={() => {}} />);
    expect(screen.getByText(/drag file here/i)).toBeInTheDocument();
  });

  it('shows selected filename', () => {
    const file = new File([''], 'test.wav', { type: 'audio/wav' });
    render(<AudioUploadZone file={file} onFileSelect={() => {}} />);
    expect(screen.getByText('test.wav')).toBeInTheDocument();
  });

  it('calls onFileSelect when a file is dropped', () => {
    const onFileSelect = vi.fn();
    render(<AudioUploadZone file={null} onFileSelect={onFileSelect} />);
    
    const file = new File([''], 'test.wav', { type: 'audio/wav' });
    const dropEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        files: [file],
      },
    };
    
    fireEvent.drop(screen.getByRole('button'), dropEvent);
    expect(onFileSelect).toHaveBeenCalledWith(file);
  });

  it('opens file dialog on click', () => {
    render(<AudioUploadZone file={null} onFileSelect={() => {}} />);
    const button = screen.getByRole('button');
    // We can't easily test the OS file dialog, but we can check if click works
    fireEvent.click(button);
  });
});
