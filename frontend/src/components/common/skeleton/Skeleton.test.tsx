import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkeletonTable } from './SkeletonTable';
import { SkeletonRow } from './SkeletonRow';
import { SkeletonCard } from './SkeletonCard';
import { SkeletonText } from './SkeletonText';

const threeColumns = [{ width: '33%' }, { width: '33%' }, { width: '34%' }];

describe('SkeletonTable', () => {
  it('renders 3 rows by default', () => {
    render(<SkeletonTable columns={threeColumns} />);
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(3);
  });

  it('renders correct number of rows when rows prop is 5', () => {
    render(<SkeletonTable columns={threeColumns} rows={5} />);
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(5);
  });

  it('renders with data-testid="skeleton-table"', () => {
    render(<SkeletonTable columns={threeColumns} />);
    expect(screen.getByTestId('skeleton-table')).toBeInTheDocument();
  });
});

describe('SkeletonRow', () => {
  it('renders correct number of cells matching columns array length', () => {
    const columns = [{ width: '25%' }, { width: '25%' }, { width: '25%' }, { width: '25%' }];
    render(<SkeletonRow columns={columns} />);
    // Each cell is a div inside the row; count the direct children
    const row = screen.getByTestId('skeleton-row');
    expect(row.children).toHaveLength(4);
  });
});

describe('SkeletonCard', () => {
  it('renders with data-testid="skeleton-card"', () => {
    render(<SkeletonCard />);
    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument();
  });
});

describe('SkeletonText', () => {
  it('renders with data-testid="skeleton-text"', () => {
    render(<SkeletonText />);
    expect(screen.getByTestId('skeleton-text')).toBeInTheDocument();
  });
});
