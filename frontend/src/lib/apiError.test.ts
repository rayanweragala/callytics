import { describe, it, expect } from 'vitest';
import { getApiError } from './apiError';
import axios from 'axios';

describe('getApiError', () => {
  it('returns error.response.data.message when present as string', () => {
    const error = {
      isAxiosError: true,
      response: {
        data: {
          message: 'Server error message',
        },
      },
    };
    // Need to mock axios.isAxiosError or use a real axios error object
    const isAxiosErrorSpy = vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    expect(getApiError(error, 'Fallback')).toBe('Server error message');
    isAxiosErrorSpy.mockRestore();
  });

  it('returns first element of error.response.data.message when it is an array', () => {
    const error = {
      isAxiosError: true,
      response: {
        data: {
          message: ['First error', 'Second error'],
        },
      },
    };
    const isAxiosErrorSpy = vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    expect(getApiError(error, 'Fallback')).toBe('First error');
    isAxiosErrorSpy.mockRestore();
  });

  it('falls back to error.message when no response body', () => {
    const error = new Error('Base error message');
    expect(getApiError(error, 'Fallback')).toBe('Base error message');
  });

  it('falls back to hardcoded fallback string when both absent', () => {
    expect(getApiError({}, 'Fallback')).toBe('Fallback');
  });

  it('handles null input without throwing', () => {
    expect(getApiError(null, 'Fallback')).toBe('Fallback');
  });

  it('handles undefined input without throwing', () => {
    expect(getApiError(undefined, 'Fallback')).toBe('Fallback');
  });
});
