import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CallLogsPage } from './CallLogsPage';
import { MemoryRouter } from 'react-router-dom';

describe('CallLogsPage coverage boost', () => {
  it('renders placeholder content', () => {
    render(
      <MemoryRouter>
        <CallLogsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Call Logs' })).toBeInTheDocument();
    expect(screen.getByText('This feature is coming soon.')).toBeInTheDocument();
  });
});
