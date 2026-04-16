import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HuntConfigPanel } from './HuntConfigPanel';

describe('HuntConfigPanel coverage boost', () => {
  const audioOptions = [{ value: 'a1', label: 'Audio 1' }];
  const nodeOptions = [{ value: 'n1', label: 'Node 1' }];
  const config = {
    strategy: 'sequential',
    destinations: ['101', '102'],
    timeout: 30,
    on_failure: 'n1',
  };

  it('renders config and handles strategy change', () => {
    const onConfigReplace = vi.fn();
    render(
      <HuntConfigPanel
        nodeId="1"
        config={config}
        audioOptions={audioOptions}
        nodeOptions={nodeOptions}
        onConfigReplace={onConfigReplace}
      />
    );

    expect(screen.getByText(/Sequential/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Sequential/i));
    fireEvent.click(screen.getByText(/Random/i));
    
    expect(onConfigReplace).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'random' }));
  });

  it('handles adding destination', () => {
    function Wrapper() {
      const [nextConfig, setNextConfig] = useState(config);
      return (
        <HuntConfigPanel
          nodeId="1"
          config={nextConfig}
          audioOptions={audioOptions}
          nodeOptions={nodeOptions}
          onConfigReplace={setNextConfig}
        />
      );
    }

    render(
      <Wrapper />
    );

    expect(screen.getAllByPlaceholderText('SIP/101')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /add destination/i }));
    expect(screen.getAllByPlaceholderText('SIP/101')).toHaveLength(3);
  });
});
