import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { renderWithRouter } from '../test/renderWithRouter';

describe('SettingsPage coverage boost', () => {
  it('renders placeholder content', () => {
    renderWithRouter(<SettingsPage />);

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('This feature is coming soon.')).toBeInTheDocument();
  });
});
