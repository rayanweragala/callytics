import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExtensionsPage } from './ExtensionsPage';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  listExtensions: vi.fn(),
  getHostConfig: vi.fn(),
  createExtension: vi.fn(),
  updateExtension: vi.fn(),
  deleteExtension: vi.fn(),
}));

describe('ExtensionsPage coverage boost', () => {
  const mockExtensions = {
    data: [
      { id: 1, username: '101', displayName: 'User 101', createdAt: new Date().toISOString() },
    ],
    total: 1,
  };

  const mockHostConfig = { hostIp: '127.0.0.1', sipPort: 5060 };

  it('renders extensions and opens create form', async () => {
    (api.listExtensions as any).mockResolvedValue(mockExtensions);
    (api.getHostConfig as any).mockResolvedValue(mockHostConfig);

    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('101')).toBeInTheDocument());
    
    fireEvent.click(screen.getByRole('button', { name: /add extension/i }));
    expect(screen.getByText('new extension')).toBeInTheDocument();
  });
});
