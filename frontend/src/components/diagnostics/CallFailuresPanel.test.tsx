import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CallFailuresPanel } from './CallFailuresPanel';

describe('CallFailuresPanel', () => {
  it('clicking a row does nothing and does not throw', () => {
    const onPageChange = vi.fn();

    render(
      <CallFailuresPanel
        items={[
          {
            id: 1,
            callId: 'call-1',
            time: '2026-04-17T10:11:12.345Z',
            callerId: '1001',
            flowName: 'Main',
            failedNodeType: 'transfer',
            errorMessage: 'Busy',
            durationSeconds: 4,
          },
        ]}
        onPageChange={onPageChange}
        page={1}
        totalPages={1}
      />,
    );

    expect(() => fireEvent.click(screen.getByText('1001'))).not.toThrow();
    expect(onPageChange).not.toHaveBeenCalled();
  });
});
