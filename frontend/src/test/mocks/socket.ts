import { vi } from 'vitest';

export const diagnosticsSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('../../lib/socket', () => ({
  diagnosticsSocket,
}));
