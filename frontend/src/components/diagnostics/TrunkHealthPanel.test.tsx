import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrunkHealthPanel } from './TrunkHealthPanel';

describe('TrunkHealthPanel', () => {
  it('renders rows and fires the test callback', () => {
    const onTest = vi.fn();

    render(
      <TrunkHealthPanel
        busyIds={[]}
        onTest={onTest}
        onTestAll={() => {}}
        results={{}}
        testingAll={false}
        trunks={[
          {
            id: 1,
            name: 'Main trunk',
            providerPreset: 'generic',
            host: 'sip.example.com',
            port: 5060,
            username: null,
            password: null,
            fromDomain: null,
            fromUser: null,
            enabled: true,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    expect(screen.getByText('Main trunk')).toBeInTheDocument();
    expect(screen.queryByText('Protocol')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test Now' }));
    expect(onTest).toHaveBeenCalledWith(1);
  });
});
