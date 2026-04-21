import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HuntConfigPanel } from './HuntConfigPanel';

const audioOptions = [{ value: '1', label: 'Audio 1' }];
const audioItems = [{
  id: 1,
  name: 'Audio 1',
  sourceType: 'upload',
  originalFilename: 'audio-1.wav',
  mimeType: 'audio/wav',
  durationMs: 1000,
  conversionStatus: 'ready',
  ttsText: null,
  ttsVoice: null,
  speed: 1,
  originalUrl: '/audio/1.wav',
  previewUrl: '/audio/1.wav',
  convertedUrl: '/audio/1.ulaw.wav',
  createdAt: '',
  updatedAt: '',
}];
const nodeOptions = [{ value: 'n1', label: 'Node 1' }];
const extensionOptions = [
  { value: '101', label: '101 — Agent 101' },
  { value: '102', label: '102 — Agent 102' },
];
const contactOptions = [{ value: '+947****8762', label: 'Mobile — +947****8762' }];

const baseConfig = {
  strategy: 'sequential',
  destinations: [
    { target_type: 'extension' as const, target_value: '101' },
    { target_type: 'extension' as const, target_value: '102' },
  ],
  attempt_timeout_ms: 5000,
  total_timeout_ms: 30000,
  on_no_answer: 'n1',
};

describe('HuntConfigPanel coverage boost', () => {
  it('renders config and handles strategy change', () => {
    const onConfigReplace = vi.fn();
    render(
      <HuntConfigPanel
        nodeId="1"
        config={baseConfig}
        audioOptions={audioOptions}
        audioItems={audioItems}
        nodeOptions={nodeOptions}
        extensionOptions={extensionOptions}
        contactOptions={contactOptions}
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
      const [nextConfig, setNextConfig] = useState(baseConfig);
      const handleConfigReplace = (replacement: Record<string, unknown>) => {
        setNextConfig(replacement as typeof baseConfig);
      };

      return (
        <HuntConfigPanel
          nodeId="1"
          config={nextConfig}
          audioOptions={audioOptions}
          audioItems={audioItems}
          nodeOptions={nodeOptions}
          extensionOptions={extensionOptions}
          contactOptions={contactOptions}
          onConfigReplace={handleConfigReplace}
        />
      );
    }

    render(<Wrapper />);

    expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /add destination/i }));
    expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(3);
  });
});
