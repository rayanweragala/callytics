import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowTreePanel } from './FlowTreePanel';

vi.mock('../lib/api', () => ({
  getFlows: vi.fn(() => Promise.resolve({ data: [] })),
}));

describe('FlowTreePanel', () => {
  it('renders without crashing and shows empty message', () => {
    render(<FlowTreePanel tree={null} currentFlowId={0} onNavigate={() => {}} />);
    expect(screen.getByText('No subflows yet.')).toBeInTheDocument();
  });

  it('renders flow name from tree', () => {
    const tree = {
      id: 1,
      name: 'Main Flow',
      children: [],
    };
    render(<FlowTreePanel tree={tree} currentFlowId={1} onNavigate={() => {}} />);
    expect(screen.getByText('Main Flow')).toBeInTheDocument();
    expect(screen.getByText('root flow')).toBeInTheDocument();
  });
});
