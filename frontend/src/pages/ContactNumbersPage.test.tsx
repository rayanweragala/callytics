import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContactNumbersPage } from './ContactNumbersPage';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  getContactNumbers: vi.fn(),
  listTrunks: vi.fn(),
  createContactNumber: vi.fn(),
  updateContactNumber: vi.fn(),
  deleteContactNumber: vi.fn(),
}));

describe('ContactNumbersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listTrunks as any).mockResolvedValue({ data: [], total: 0 });
  });

  it('renders empty state when no contacts are returned', async () => {
    (api.getContactNumbers as any).mockResolvedValue({ data: [], total: 0 });

    render(
      <MemoryRouter>
        <ContactNumbersPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('No contacts yet.')).toBeInTheDocument());
  });

  it('renders contact rows with label, number, and trunk name when present', async () => {
    (api.getContactNumbers as any).mockResolvedValue({
      data: [
        {
          id: 1,
          label: 'Sales Mobile',
          number: '+94714008762',
          trunkId: 7,
          notes: null,
          createdAt: new Date().toISOString(),
        },
      ],
      total: 1,
    });
    (api.listTrunks as any).mockResolvedValue({
      data: [{ id: 7, name: 'Main Trunk', host: 'sip.example.com', enabled: true, createdAt: new Date().toISOString() }],
      total: 1,
    });

    render(
      <MemoryRouter>
        <ContactNumbersPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Sales Mobile')).toBeInTheDocument());
    expect(screen.getByText('+94714008762')).toBeInTheDocument();
    expect(screen.getByText('Main Trunk')).toBeInTheDocument();
  });

  it('submitting create form with label and number calls POST /contact-numbers', async () => {
    (api.getContactNumbers as any).mockResolvedValue({ data: [], total: 0 });
    (api.createContactNumber as any).mockResolvedValue({
      data: {
        id: 10,
        label: 'Owner Mobile',
        number: '+94770000000',
        trunkId: null,
        notes: null,
        createdAt: new Date().toISOString(),
      },
    });

    render(
      <MemoryRouter>
        <ContactNumbersPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('No contacts yet.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add contact/i }));

    const createButton = screen.getByRole('button', { name: /create contact/i });
    const form = createButton.closest('form');
    expect(form).toBeTruthy();

    const textboxes = within(form as HTMLFormElement).getAllByRole('textbox');
    fireEvent.change(textboxes[0], { target: { value: 'Owner Mobile' } });
    fireEvent.change(textboxes[1], { target: { value: '+94770000000' } });

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(api.createContactNumber).toHaveBeenCalledWith({
        label: 'Owner Mobile',
        number: '+94770000000',
        trunk_id: undefined,
        notes: undefined,
      });
    });
  });

  it('delete opens inline confirm and confirming calls DELETE', async () => {
    (api.getContactNumbers as any).mockResolvedValue({
      data: [
        {
          id: 22,
          label: 'Night Escalation',
          number: '+94771112233',
          trunkId: null,
          notes: null,
          createdAt: new Date().toISOString(),
        },
      ],
      total: 1,
    });
    (api.deleteContactNumber as any).mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <ContactNumbersPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Night Escalation')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByText('Delete this contact? This cannot be undone.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(api.deleteContactNumber).toHaveBeenCalledWith(22));
  });

  it('shows error message when create API fails', async () => {
    (api.getContactNumbers as any).mockResolvedValue({ data: [], total: 0 });
    (api.createContactNumber as any).mockRejectedValue(new Error('boom'));

    render(
      <MemoryRouter>
        <ContactNumbersPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('No contacts yet.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add contact/i }));
    const createButton = screen.getByRole('button', { name: /create contact/i });
    const form = createButton.closest('form');
    const textboxes = within(form as HTMLFormElement).getAllByRole('textbox');

    fireEvent.change(textboxes[0], { target: { value: 'Escalation' } });
    fireEvent.change(textboxes[1], { target: { value: '+94774445566' } });
    fireEvent.click(createButton);

    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });
});
