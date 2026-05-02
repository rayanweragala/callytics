import { formatDialNumber } from './formatDialNumber';

describe('formatDialNumber', () => {
  it('strips non-digits and applies {number} format', () => {
    expect(formatDialNumber('+1 (555) 123-4567', '+{number}')).toBe('+15551234567');
  });

  it('works with 0{number} formats', () => {
    expect(formatDialNumber('077 123 4567', '0{number}')).toBe('00771234567');
  });

  it('works with raw {number} formats', () => {
    expect(formatDialNumber('94 77 123 4567', '{number}')).toBe('94771234567');
  });

  it('applies valid prefix formats that include {number}', () => {
    expect(formatDialNumber('123456789', 'prefix_{number}')).toBe('prefix_123456789');
  });

  it('returns null if fewer than 9 digits', () => {
    expect(formatDialNumber('123-456', '+{number}')).toBeNull();
  });

  it('returns null if empty string', () => {
    expect(formatDialNumber('', '{number}')).toBeNull();
  });
});
