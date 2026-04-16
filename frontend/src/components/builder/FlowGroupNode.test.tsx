import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowGroupNode } from './FlowGroupNode';
import '../../test/mocks/reactflow';

describe('FlowGroupNode', () => {
  const props: any = {
    id: '1',
    data: {
      label: 'Group Label',
      config: {},
    },
    selected: false,
  };

  it('renders without crashing', () => {
    render(<FlowGroupNode {...props} />);
    expect(screen.getByText('Group Label')).toBeInTheDocument();
  });

  it('shows input when editing', () => {
    const editingProps = { ...props, data: { ...props.data, isEditing: true } };
    render(<FlowGroupNode {...editingProps} />);
    expect(screen.getByPlaceholderText('group label')).toBeInTheDocument();
  });
});
