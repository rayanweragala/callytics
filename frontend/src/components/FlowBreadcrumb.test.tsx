import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowBreadcrumb } from './FlowBreadcrumb';
import { MemoryRouter } from 'react-router-dom';

describe('FlowBreadcrumb', () => {
  const items = [
    { flowId: 1, flowName: 'Root' },
    { flowId: 2, flowName: 'Child' },
  ];

  it('renders without crashing', () => {
    render(
      <MemoryRouter>
        <FlowBreadcrumb items={items} onNavigate={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByText('Root')).toBeInTheDocument();
    expect(screen.getByText('Child')).toBeInTheDocument();
  });

  it('renders nothing if only one item', () => {
    const { container } = render(
      <MemoryRouter>
        <FlowBreadcrumb items={[{ flowId: 1, flowName: 'Root' }]} onNavigate={() => {}} />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
