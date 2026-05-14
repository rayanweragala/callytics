import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { OperatorsPage } from './OperatorsPage';
import * as api from '../lib/api';
import { renderWithRouter } from '../test/renderWithRouter';

vi.mock('../lib/api', () => ({
  listOperators: vi.fn(),
  listExtensions: vi.fn(),
  getContactNumbers: vi.fn(),
  listTrunks: vi.fn(),
  createOperator: vi.fn(),
  deleteOperator: vi.fn(),
  updateOperator: vi.fn(),
}));

describe('OperatorsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listOperators as any).mockResolvedValue({ data: [], total: 0 });
    (api.listExtensions as any).mockResolvedValue({
      data: [{ id: 101, username: '2001', password: 'x', displayName: 'Alice', transportType: 'sip', createdAt: new Date().toISOString() }],
      total: 1,
    });
    (api.getContactNumbers as any).mockResolvedValue({
      data: [{ id: 201, label: 'Owner Mobile', number: '+94770000000', trunkId: null, notes: null, createdAt: new Date().toISOString() }],
      total: 1,
    });
    (api.listTrunks as any).mockResolvedValue({
      data: [{ id: 1, name: 'Main Trunk', providerPreset: 'generic', host: '', port: 5060, username: null, password: null, fromDomain: null, fromUser: null, dialFormat: '{number}', enabled: true, createdAt: new Date().toISOString() }],
      total: 1,
    });
    (api.createOperator as any).mockResolvedValue({
      data: {
        id: 1,
        name: 'New Operator',
        status: 'offline',
        extension: undefined,
        contactNumber: undefined,
        hasPIN: true,
        createdAt: new Date().toISOString(),
      },
    });
  });

  async function openCreateForm() {
    renderWithRouter(<OperatorsPage />);

    await waitFor(() => expect(screen.getByText('No operators yet.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add operator/i }));
    expect(screen.getByText('new operator')).toBeInTheDocument();
  }

  it('form renders optional extension SearchableSelect', async () => {
    await openCreateForm();
    expect(screen.getByText('SIP extension (optional)')).toBeInTheDocument();
    expect(screen.getByText('No extension assigned')).toBeInTheDocument();
  });

  it('form renders optional PSTN fallback SearchableSelect', async () => {
    await openCreateForm();
    expect(screen.getByText('PSTN fallback (optional)')).toBeInTheDocument();
    expect(screen.getByText('No PSTN contact')).toBeInTheDocument();
  });

  it('submitting with neither extension nor contact selected shows validation error', async () => {
    await openCreateForm();

    fireEvent.change(screen.getByPlaceholderText('e.g. Alice'), { target: { value: 'No Link Operator' } });
    fireEvent.click(screen.getByRole('button', { name: /^add operator$/i }));

    await waitFor(() => {
      expect(screen.getByText('An operator must have at least an extension or a PSTN contact assigned.')).toBeInTheDocument();
    });
    expect(api.createOperator).not.toHaveBeenCalled();
  });

  it('submitting with extension only sends extension_id and no contact_number_id', async () => {
    await openCreateForm();

    fireEvent.change(screen.getByPlaceholderText('e.g. Alice'), { target: { value: 'Extension Only' } });
    fireEvent.click(screen.getByText('No extension assigned'));
    fireEvent.click(screen.getByText('2001 — Alice'));

    fireEvent.click(screen.getByRole('button', { name: /^add operator$/i }));

    await waitFor(() => {
      expect(api.createOperator).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Extension Only',
        extension_id: 101,
        contact_number_id: undefined,
      }));
    });
  });

  it('submitting with contact only sends contact_number_id and no extension_id', async () => {
    await openCreateForm();

    fireEvent.change(screen.getByPlaceholderText('e.g. Alice'), { target: { value: 'Contact Only' } });
    fireEvent.click(screen.getByText('No PSTN contact'));
    fireEvent.click(screen.getByText('Owner Mobile — +94770000000'));

    fireEvent.click(screen.getByRole('button', { name: /^add operator$/i }));

    await waitFor(() => {
      expect(api.createOperator).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Contact Only',
        extension_id: undefined,
        contact_number_id: 201,
      }));
    });
  });
});
