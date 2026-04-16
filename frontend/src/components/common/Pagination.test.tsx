import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  it('renders navigation controls and page indicator', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Newer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Older/i })).toBeInTheDocument();
  });

  it('calls onPageChange with previous page on click', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Newer/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('calls onPageChange with next page on click', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Older/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('disables newer button on page 1', () => {
    render(<Pagination page={1} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Newer/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Older/i })).not.toBeDisabled();
  });

  it('disables older button on last page', () => {
    render(<Pagination page={5} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Older/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Newer/i })).not.toBeDisabled();
  });

  it('handles 0 total pages', () => {
    render(<Pagination page={1} totalPages={0} onPageChange={() => {}} />);
    expect(screen.getByText('1 / 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Newer/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Older/i })).toBeDisabled();
  });
});
