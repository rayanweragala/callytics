import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowCanvasNode } from './FlowCanvasNode';
import '../../test/mocks/reactflow';

describe('FlowCanvasNode', () => {
  const props: any = {
    id: '1',
    data: {
      nodeKey: '1',
      type: 'start',
      label: 'Start Node',
      config: {},
    },
    selected: false,
    zIndex: 0,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    dragging: false,
    dragHandle: '',
    type: 'custom',
  };

  it('renders without crashing', () => {
    render(<FlowCanvasNode {...props} />);
    expect(screen.getByText('start')).toBeInTheDocument();
    expect(screen.getByText('Start Node')).toBeInTheDocument();
  });

  it('shows delete button when selected', () => {
    const selectedProps = { ...props, selected: true, data: { ...props.data, type: 'play_audio', onDelete: vi.fn() } };
    render(<FlowCanvasNode {...selectedProps} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
