/**
 * Formats a raw PSTN number according to a trunk dial format pattern.
 *
 * Strips all non-digit characters from `raw`, then substitutes them into
 * `dialFormat` wherever `{number}` appears. Returns `null` if the resulting
 * digit string has fewer than 9 digits (not a plausible phone number).
 *
 * @param raw       The raw phone number (may include +, -, spaces, parens, etc.)
 * @param dialFormat The per-trunk format template, e.g. '+{number}', '0{number}', '{number}'
 * @returns The formatted dial string, or null if the digits are too short.
 */
export function formatDialNumber(raw: string, dialFormat: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 9) {
    return null;
  }
  return dialFormat.replace('{number}', digits);
}
