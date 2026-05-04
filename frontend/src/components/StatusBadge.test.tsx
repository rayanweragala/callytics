import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders status text', () => {
    render(<StatusBadge state="registered" />);
    expect(screen.getByText('registered')).toBeInTheDocument();
  });

  it('renders unregistered state', () => {
    render(<StatusBadge state="unregistered" />);
    expect(screen.getByText('unregistered')).toBeInTheDocument();
  });
});
