import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemHealthPanel } from './SystemHealthPanel';

describe('SystemHealthPanel', () => {
  it('renders status badges correctly', () => {
    render(
      <SystemHealthPanel
        health={{
          ari: { connected: true, latencyMs: 9 },
          ami: { connected: false },
          asterisk: { version: '20.0.0', uptimeSeconds: 3600 },
          activeChannels: 4,
          postgres: { reachable: true },
          redis: { reachable: false },
          checkedAt: new Date().toISOString(),
          items: [
            { label: 'ARI', state: 'healthy', detail: '9 ms' },
            { label: 'AMI', state: 'down', detail: 'Disconnected' },
          ],
        }}
        loading={false}
      />,
    );

    expect(screen.getByText('healthy')).toBeInTheDocument();
    expect(screen.getByText('down')).toBeInTheDocument();
  });
});
