import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotFoundPage } from './NotFoundPage';
import { renderWithRouter } from '../test/renderWithRouter';

describe('NotFoundPage smoke test', () => {
  it('renders without crashing', () => {
    renderWithRouter(<NotFoundPage />);
    expect(screen.getByText(/404/i)).toBeInTheDocument();
  });
});
