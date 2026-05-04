import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import styles from './FlowCanvasNode.module.css';
import type { FlowNodeData } from '../../types';

vi.mock('reactflow', () => ({
  Handle: (props: Record<string, unknown>) => (
    <div
      data-testid={`handle-${String(props.type)}-${String(props.id || 'default')}`}
      data-connectable-start={String(props.isConnectableStart ?? '')}
      data-connectable-end={String(props.isConnectableEnd ?? '')}
    />
  ),
  Position: {
    Left: 'left',
    Right: 'right',
    Top: 'top',
  },
}));

import { FlowCanvasNode } from './FlowCanvasNode';

function createProps(config: Record<string, unknown> = {}) {
  return {
    id: 'test-node',
    type: 'flowNode',
    zIndex: 1,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    data: {
      type: 'conference',
      label: 'Conference Room',
      config,
    } as FlowNodeData,
    selected: false,
  } as any;
}

describe('FlowCanvasNode conference rendering', () => {
  it('renders the conference accent bar styling', () => {
    const { container } = render(<FlowCanvasNode {...createProps({ roomName: 'SalesRoom1' })} />);

    expect(container.firstChild).toHaveClass(styles.conference);
    expect(container.querySelector('span')).toBeInTheDocument();
  });

  it('renders the room name as the subtitle when configured', () => {
    render(<FlowCanvasNode {...createProps({ roomName: 'SalesRoom1' })} />);

    expect(screen.getByText('SalesRoom1')).toBeInTheDocument();
  });

  it('prevents starting connections from target handles', () => {
    render(<FlowCanvasNode {...createProps({ roomName: 'SalesRoom1' })} />);

    expect(screen.getByTestId('handle-target-default')).toHaveAttribute('data-connectable-start', 'false');
  });

  it('does not render a source handle for terminal nodes', () => {
    render(
      <FlowCanvasNode
        {...createProps()}
        data={{
          type: 'hangup',
          label: 'hangup',
          config: {},
        } as FlowNodeData}
      />,
    );

    expect(screen.getByTestId('handle-target-default')).toBeInTheDocument();
    expect(screen.queryByTestId('handle-source-default')).not.toBeInTheDocument();
  });
});
