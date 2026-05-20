import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarNav } from './SidebarNav';
import { renderWithRouter } from '../test/renderWithRouter';

describe('SidebarNav', () => {
  it('renders without crashing and contains links', () => {
    renderWithRouter(<SidebarNav />);
    expect(screen.getByText('diagnostics')).toBeInTheDocument();
    expect(screen.getByText('logs')).toBeInTheDocument();
    expect(screen.getByText('webhook logs')).toBeInTheDocument();
    expect(screen.getByText('flow builder')).toBeInTheDocument();
    expect(screen.getByText('extensions')).toBeInTheDocument();
    expect(screen.getByText('settings')).toBeInTheDocument();
  });
});
