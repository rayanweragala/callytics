import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SipEndpointsPanel } from './SipEndpointsPanel';

describe('SipEndpointsPanel coverage boost', () => {
  const sipStatuses: any[] = [
    {
      endpoint: '101',
      state: 'registered',
      contacts: ['sip:101@127.0.0.1'],
      updatedAt: Date.now(),
    },
    {
      endpoint: '102',
      state: 'unregistered',
      contacts: [],
      updatedAt: Date.now(),
    }
  ];

  it('renders endpoint list and handles pagination', () => {
    const onPageChange = vi.fn();
    render(
      <SipEndpointsPanel
        sipStatuses={sipStatuses}
        page={0}
        totalPages={2}
        onPageChange={onPageChange}
      />
    );

    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getByText('102')).toBeInTheDocument();
    
    fireEvent.click(screen.getByRole('button', { name: /go to next page/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
