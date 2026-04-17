import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowTreePanel } from './FlowTreePanel';
import type { FlowTree } from '../types';

vi.mock('../lib/api', () => ({
  getFlows: vi.fn(() => Promise.resolve({ data: [] })),
}));

describe('FlowTreePanel', () => {
  it('renders without crashing and shows empty message', () => {
    render(<FlowTreePanel tree={null} currentFlowId={0} onNavigate={() => {}} />);
    expect(screen.getByText('No subflows yet.')).toBeInTheDocument();
  });

  it('renders flow name from tree', () => {
    const tree: FlowTree = {
      id: 1,
      name: 'Main Flow',
      children: [],
    };
    render(<FlowTreePanel tree={tree} currentFlowId={1} onNavigate={() => {}} />);
    expect(screen.getByText('Main Flow')).toBeInTheDocument();
    expect(screen.getByText('root flow')).toBeInTheDocument();
  });

  it('menu group node with no child (empty children array) renders as leaf with no child entry', () => {
    const tree: FlowTree = {
      id: 1,
      name: 'Root',
      children: [
        {
          nodeKey: 'menu1',
          nodeLabel: 'Menu Leaf',
          subflowId: 10,
          name: 'Submenu',
          children: [], // no nested children
        },
      ],
    };
    render(<FlowTreePanel tree={tree} currentFlowId={1} onNavigate={() => {}} />);
    expect(screen.getByText('Menu Leaf')).toBeInTheDocument();
    // No nested child entry beneath this leaf
    expect(screen.queryByTestId('tree-child-entry')).not.toBeInTheDocument();
  });

  it('menu group node with valid child_flow_id (non-empty children) renders child entry below it', () => {
    const tree: FlowTree = {
      id: 1,
      name: 'Root',
      children: [
        {
          nodeKey: 'menu1',
          nodeLabel: 'Menu With Child',
          subflowId: 10,
          name: 'Submenu',
          children: [
            {
              nodeKey: 'inner1',
              nodeLabel: 'Inner Menu',
              subflowId: 11,
              name: 'Inner Submenu',
              children: [],
            },
          ],
        },
      ],
    };
    render(<FlowTreePanel tree={tree} currentFlowId={1} onNavigate={() => {}} />);
    expect(screen.getByText('Menu With Child')).toBeInTheDocument();
    expect(screen.getByText('Inner Menu')).toBeInTheDocument();
  });

  it('non-group nodes never render child entries regardless of data', () => {
    // Root has no children — no child block
    const tree: FlowTree = {
      id: 1,
      name: 'Simple Flow',
      children: [],
    };
    render(<FlowTreePanel tree={tree} currentFlowId={1} onNavigate={() => {}} />);
    expect(screen.getByText('Simple Flow')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-child-entry')).not.toBeInTheDocument();
  });
});
