import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatBar } from './StatBar';

describe('StatBar', () => {
  const metrics = {
    activeCalls: 5,
    registeredEndpoints: 10,
    flows: 3,
    uptimeSeconds: 3661,
  };

  it('renders without crashing and shows metrics', () => {
    render(<StatBar metrics={metrics} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE CALLS')).toBeInTheDocument();
    expect(screen.getByText('01:01:01')).toBeInTheDocument();
    expect(screen.getByText('UPTIME')).toBeInTheDocument();
  });
});
