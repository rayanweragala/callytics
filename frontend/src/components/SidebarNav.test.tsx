import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarNav } from './SidebarNav';
import { MemoryRouter } from 'react-router-dom';

describe('SidebarNav', () => {
  it('renders without crashing and contains links', () => {
    render(
      <MemoryRouter>
        <SidebarNav />
      </MemoryRouter>
    );
    expect(screen.getByText('diagnostics')).toBeInTheDocument();
    expect(screen.getByText('flow builder')).toBeInTheDocument();
    expect(screen.getByText('extensions')).toBeInTheDocument();
  });
});
