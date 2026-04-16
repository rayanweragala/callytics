import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageLayout } from './PageLayout';

describe('PageLayout', () => {
  it('renders title and children', () => {
    render(
      <PageLayout title="Dashboard">
        <p>Main content</p>
      </PageLayout>
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Main content')).toBeInTheDocument();
  });

  it('renders subtitle if provided', () => {
    render(
      <PageLayout title="Dashboard" subtitle="Overview">
        <p>Main content</p>
      </PageLayout>
    );
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });

  it('renders actions if provided', () => {
    render(
      <PageLayout title="Dashboard" actions={<button>Add</button>}>
        <p>Main content</p>
      </PageLayout>
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
});
