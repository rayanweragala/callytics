import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EndpointStatusRow } from './EndpointStatusRow';
import type { SipEndpointStatus } from '../types';

describe('EndpointStatusRow', () => {
  const endpoint: SipEndpointStatus = {
    endpoint: '101',
    aor: 'sip:101@127.0.0.1',
    state: 'registered',
    contacts: ['sip:101@127.0.0.1'],
    updatedAt: Date.now(),
  };

  it('renders without crashing', () => {
    render(<EndpointStatusRow endpoint={endpoint} />);
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getByText('sip:101@127.0.0.1')).toBeInTheDocument();
    expect(screen.getByText('registered')).toBeInTheDocument();
  });
});
