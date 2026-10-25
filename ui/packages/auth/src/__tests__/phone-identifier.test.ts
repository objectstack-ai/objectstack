import { describe, it, expect } from 'vitest';
import { normalizePhoneIdentifier, looksLikePhoneIdentifier } from '../phone-identifier';

describe('normalizePhoneIdentifier', () => {
  it('strips formatting and keeps a leading +', () => {
    expect(normalizePhoneIdentifier('+1 (555) 000-0000')).toBe('+15550000000');
    expect(normalizePhoneIdentifier('138 0013 8000')).toBe('13800138000');
    expect(normalizePhoneIdentifier('  +86-138-0013-8000  ')).toBe('+8613800138000');
  });

  it('does NOT inject a country code or force E.164 (must match backend storage)', () => {
    // A bare national number stays bare — the backend stores it as-is.
    expect(normalizePhoneIdentifier('5550000')).toBe('5550000');
  });

  it('rejects non-phone input', () => {
    expect(normalizePhoneIdentifier('name@example.com')).toBeNull();
    expect(normalizePhoneIdentifier('12345')).toBeNull(); // too short (<6)
    expect(normalizePhoneIdentifier('1234567890123456')).toBeNull(); // too long (>15)
    expect(normalizePhoneIdentifier('+1-abc-def')).toBeNull();
    expect(normalizePhoneIdentifier('')).toBeNull();
  });
});

describe('looksLikePhoneIdentifier', () => {
  it('treats anything with @ as email', () => {
    expect(looksLikePhoneIdentifier('user@example.com')).toBe(false);
    expect(looksLikePhoneIdentifier('+1555000@weird')).toBe(false);
  });

  it('detects phone-shaped identifiers', () => {
    expect(looksLikePhoneIdentifier('+8613800138000')).toBe(true);
    expect(looksLikePhoneIdentifier('(555) 000-0000')).toBe(true);
    expect(looksLikePhoneIdentifier('13800138000')).toBe(true);
  });

  it('rejects plain emails and garbage', () => {
    expect(looksLikePhoneIdentifier('name@example.com')).toBe(false);
    expect(looksLikePhoneIdentifier('notaphone')).toBe(false);
    expect(looksLikePhoneIdentifier('12345')).toBe(false);
  });
});
