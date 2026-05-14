import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowBreadcrumb } from './FlowBreadcrumb';
import { renderWithRouter } from '../test/renderWithRouter';

describe('FlowBreadcrumb', () => {
  const items = [
    { flowId: 1, flowName: 'Root', parentNodeKey: null, parentNodeLabel: null, parentBranchKey: null },
    { flowId: 2, flowName: 'Child', parentNodeKey: 'menu-1', parentNodeLabel: 'Sales Menu', parentBranchKey: '1' },
  ];

  it('renders without crashing', () => {
    renderWithRouter(<FlowBreadcrumb items={items} onNavigate={() => {}} />);
    expect(screen.getByText('Root')).toBeInTheDocument();
    expect(screen.getByText('Child')).toBeInTheDocument();
    expect(screen.getByText(/Sales Menu \/ 1/)).toBeInTheDocument();
  });

  it('renders nothing if only one item', () => {
    const { container } = renderWithRouter(<FlowBreadcrumb items={[{ flowId: 1, flowName: 'Root', parentNodeKey: null, parentNodeLabel: null, parentBranchKey: null }]} onNavigate={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
