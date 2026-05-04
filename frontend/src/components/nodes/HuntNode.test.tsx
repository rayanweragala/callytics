import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HuntNode } from './HuntNode';
import '../../test/mocks/reactflow';

describe('HuntNode', () => {
  const props: any = {
    id: '1',
    data: {
      label: 'Hunt Label',
      config: {
        destinations: ['101', '102'],
        strategy: 'random',
      },
    },
    selected: false,
  };

  it('renders without crashing', () => {
    render(<HuntNode {...props} />);
    expect(screen.getByText('hunt')).toBeInTheDocument();
    expect(screen.getByText('Hunt Label')).toBeInTheDocument();
    expect(screen.getByText('2 destinations')).toBeInTheDocument();
    expect(screen.getByText('random')).toBeInTheDocument();
  });
});
