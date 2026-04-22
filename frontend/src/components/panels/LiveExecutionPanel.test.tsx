import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CallTimelineEvent } from '../../types';
import { LiveExecutionPanel } from './LiveExecutionPanel';
import styles from './LiveExecutionPanel.module.css';

const baseCallId = 'call-1';

function renderPanel(
  liveEvents: CallTimelineEvent[],
  timelineEvents?: Record<string, CallTimelineEvent[]>,
) {
  return render(
    <LiveExecutionPanel
      liveCalls={[{ callId: baseCallId, events: liveEvents }]}
      liveTotal={1}
      page={0}
      setPage={vi.fn()}
      expandedCalls={{ [baseCallId]: true }}
      toggleCall={vi.fn()}
      timelineEvents={timelineEvents}
    />,
  );
}

describe('LiveExecutionPanel', () => {
  it('renders node step rows from timelineEvents when available', () => {
    const timelineEvent: CallTimelineEvent = {
      callId: baseCallId,
      flowId: 1,
      nodeId: 'menu-1776264496563-1',
      nodeType: 'menu',
      status: 'started',
      ts: 1000,
      meta: { result: '1', callerNumber: '1001' },
    };

    renderPanel([], { [baseCallId]: [timelineEvent] });

    expect(screen.getByText('[menu]')).toBeInTheDocument();
    expect(screen.getByText('menu-1776264496563-1')).toBeInTheDocument();
    expect(screen.getByText('→ 1')).toBeInTheDocument();
    expect(screen.getByText('+0s')).toBeInTheDocument();
  });

  it('shows [menu] label for menu nodeType', () => {
    const liveEvent: CallTimelineEvent = {
      callId: baseCallId,
      flowId: 1,
      nodeId: 'menu-node',
      nodeType: 'menu',
      status: 'completed',
      ts: 2000,
      meta: {},
    };

    renderPanel([liveEvent]);

    expect(screen.getByText('[menu]')).toBeInTheDocument();
  });

  it('applies executing class for started node without a later completed/error event', () => {
    const startedOnly: CallTimelineEvent = {
      callId: baseCallId,
      flowId: 1,
      nodeId: 'queue-1',
      nodeType: 'queue',
      status: 'started',
      ts: 3000,
      meta: {},
    };

    const { container } = renderPanel([], { [baseCallId]: [startedOnly] });
    const executingRow = container.querySelector(`.${styles.executing}`);

    expect(executingRow).not.toBeNull();
    expect(executingRow?.textContent).toContain('[queue]');
  });

  it('falls back to lifecycle events when timelineEvents for call does not exist', () => {
    const fallbackEvent: CallTimelineEvent = {
      callId: baseCallId,
      flowId: 1,
      nodeId: 'started',
      nodeType: 'start',
      status: 'started',
      ts: 4000,
      meta: { callerNumber: '1002', result: 'default' },
    };

    renderPanel([fallbackEvent], {});

    expect(screen.getByText('[start]')).toBeInTheDocument();
    expect(screen.getByText('started')).toBeInTheDocument();
  });
});
