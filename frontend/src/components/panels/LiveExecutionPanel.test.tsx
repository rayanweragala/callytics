import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LiveExecutionPanel } from './LiveExecutionPanel';
import type { CallTimelineEvent } from '../../types';

type LiveCallFixture = {
  callId: string;
  events: CallTimelineEvent[];
};

describe('LiveExecutionPanel', () => {
  it('renders without crashing and shows empty message', () => {
    render(
      <LiveExecutionPanel
        liveCalls={[]}
        liveTotal={0}
        page={0}
        setPage={() => {}}
        expandedCalls={{}}
        toggleCall={() => {}}
      />
    );
    expect(screen.getByText('Waiting for calls...')).toBeInTheDocument();
  });

  it('renders call list and handles expansion', () => {
    const liveCalls: LiveCallFixture[] = [{
      callId: 'call-1',
      events: [{
        callId: 'call-1',
        flowId: 1,
        nodeId: 'start',
        nodeType: 'start',
        status: 'started',
        ts: Date.now(),
        meta: { callerNumber: '123' },
      }],
    }];
    const toggleCall = vi.fn();
    render(
      <LiveExecutionPanel
        liveCalls={liveCalls}
        liveTotal={1}
        page={0}
        setPage={() => {}}
        expandedCalls={{ 'call-1': true }}
        toggleCall={toggleCall}
      />
    );
    expect(screen.getByText('call-1')).toBeInTheDocument();
    expect(screen.getByText('from 123')).toBeInTheDocument();
    expect(screen.getByText('started')).toBeInTheDocument();
    
    fireEvent.click(screen.getByRole('button', { name: /toggle details/i }));
    expect(toggleCall).toHaveBeenCalledWith('call-1');
  });

  it('shows live status for active calls', () => {
    const liveCalls: LiveCallFixture[] = [{
      callId: 'call-1',
      events: [{
        callId: 'call-1',
        flowId: 1,
        nodeId: 'start',
        nodeType: 'start',
        status: 'started',
        ts: Date.now(),
        meta: {},
      }],
    }];
    render(
      <LiveExecutionPanel
        liveCalls={liveCalls}
        liveTotal={1}
        page={0}
        setPage={() => {}}
        expandedCalls={{}}
        toggleCall={() => {}}
      />
    );
    // Find the one that is likely the status label (using a partial match for hashed class)
    const statusLabel = screen.getByText('live', { selector: '[class*="finalStatus"]' });
    expect(statusLabel).toBeInTheDocument();
  });

  it('shows completed status for ended calls', () => {
    const liveCalls: LiveCallFixture[] = [{
      callId: 'call-1',
      events: [{
        callId: 'call-1',
        flowId: 1,
        nodeId: 'h1',
        nodeType: 'hangup',
        status: 'completed',
        ts: Date.now(),
        meta: { result: 'hangup' },
      }],
    }];
    render(
      <LiveExecutionPanel
        liveCalls={liveCalls}
        liveTotal={1}
        page={0}
        setPage={() => {}}
        expandedCalls={{}}
        toggleCall={() => {}}
      />
    );
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('shows failed status for error calls', () => {
    const liveCalls: LiveCallFixture[] = [{
      callId: 'call-1',
      events: [{
        callId: 'call-1',
        flowId: 1,
        nodeId: 'p1',
        nodeType: 'play_audio',
        status: 'error',
        ts: Date.now(),
        meta: {},
      }],
    }];
    render(
      <LiveExecutionPanel
        liveCalls={liveCalls}
        liveTotal={1}
        page={0}
        setPage={() => {}}
        expandedCalls={{}}
        toggleCall={() => {}}
      />
    );
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('handles loading state', () => {
    render(
      <LiveExecutionPanel
        liveCalls={[]}
        liveTotal={0}
        page={0}
        setPage={() => {}}
        expandedCalls={{}}
        toggleCall={() => {}}
        loading={true}
      />
    );
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
