import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MenuGroupNode } from './MenuGroupNode';
import '../../test/mocks/reactflow';

describe('MenuGroupNode', () => {
  const props: any = {
    id: '1',
    data: {
      label: 'Menu Label',
      config: {
        branches: ['1', '2', '3'],
      },
    },
    selected: false,
  };

  it('renders without crashing', () => {
    render(<MenuGroupNode {...props} />);
    expect(screen.getByText('menu')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Menu Label')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
