import { describe, expect, it } from 'vitest';
import { countryOptions, requiredDocuments, validateDocument } from './registration';

describe('registration document routing and input limits', () => {
  it('requires both Egyptian ID sides, substitutes one passport page for other nationalities, and leaves the practice licence optional', () => {
    expect(requiredDocuments('EG')).toEqual(['graduation', 'id_front', 'id_back', 'syndicate']);
    expect(requiredDocuments('GB')).toEqual(['graduation', 'passport', 'syndicate']);
  });
  it('accepts supported images through the exact 10 MiB boundary and rejects empty, oversized and non-image inputs', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(validateDocument({ type, size: 10 * 1024 * 1024 })).toBeNull();
    expect(validateDocument({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 })).toBe('imageSize');
    expect(validateDocument({ type: 'image/jpeg', size: 0 })).toBe('imageSize');
    for (const type of ['application/pdf', 'image/svg+xml', 'image/gif']) expect(validateDocument({ type, size: 1024 })).toBe('imageType');
  });
  it('retains country identifiers across language changes without translating recorded institution text', () => {
    const english = countryOptions('en'), arabic = countryOptions('ar');
    expect(english).toHaveLength(249);
    expect(new Set(english.map(country => country.code))).toEqual(new Set(arabic.map(country => country.code)));
    expect(english.find(country => country.code === 'EG')?.label).toBe('Egypt');
    expect(arabic.find(country => country.code === 'EG')?.label).toBe('مصر');
  });
});
