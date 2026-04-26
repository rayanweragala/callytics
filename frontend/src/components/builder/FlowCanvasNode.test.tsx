import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowCanvasNode } from './FlowCanvasNode';
import styles from './FlowCanvasNode.module.css';
import type { FlowNodeData } from '../../types';

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
});
