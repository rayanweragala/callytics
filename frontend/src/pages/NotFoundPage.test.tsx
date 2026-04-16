import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotFoundPage } from './NotFoundPage';
import { MemoryRouter } from 'react-router-dom';

describe('NotFoundPage smoke test', () => {
  it('renders without crashing', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/404/i)).toBeInTheDocument();
  });
});
