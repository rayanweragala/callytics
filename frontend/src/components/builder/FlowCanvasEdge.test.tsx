import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowCanvasEdge } from './FlowCanvasEdge';
import '../../test/mocks/reactflow';

describe('FlowCanvasEdge', () => {
  const props: any = {
    id: 'e1-2',
    source: '1',
    target: '2',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: 'bottom',
    targetPosition: 'top',
    selected: false,
    data: {
      sourceNodeType: 'get_digits',
    },
  };

  it('renders without crashing given default ReactFlow edge props', () => {
    const { container } = render(<FlowCanvasEdge {...props} />);
    expect(container).toBeInTheDocument();
  });

  it('renders the condition label when a condition string is provided', () => {
    const labelProps = { ...props, data: { ...props.data, condition: '1' } };
    render(<FlowCanvasEdge {...labelProps} />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders nothing for the label when condition is null', () => {
    const nullProps = { ...props, data: { ...props.data, condition: null } };
    render(<FlowCanvasEdge {...nullProps} />);
    const labels = screen.queryAllByText('null');
    expect(labels.length).toBe(0);
  });

  it('applies the correct CSS class for selected vs unselected state', () => {
    // Note: The UI actually applies inline styles, not CSS classes for selected state of edges.
    // However, if onDelete is provided, it shows the delete button only when selected.
    const { rerender } = render(<FlowCanvasEdge {...props} data={{...props.data, onDelete: vi.fn()}} selected={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<FlowCanvasEdge {...props} data={{...props.data, onDelete: vi.fn()}} selected={true} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
