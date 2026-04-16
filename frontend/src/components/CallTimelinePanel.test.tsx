import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CallTimelinePanel } from './CallTimelinePanel';

describe('CallTimelinePanel coverage boost', () => {
  it('renders without crashing', () => {
    const timeline = {
      'call-1': [
        {
          callId: 'call-1',
          nodeId: 'start',
          nodeType: 'start',
          status: 'started',
          ts: Date.now(),
          meta: { callerNumber: '123' },
        },
        {
          callId: 'call-1',
          nodeId: 'play1',
          nodeType: 'play_audio',
          status: 'completed',
          ts: Date.now(),
          meta: {},
        }
      ],
    };
    const { container } = render(<CallTimelinePanel timeline={timeline} />);
    expect(container).toBeInTheDocument();
  });
});
