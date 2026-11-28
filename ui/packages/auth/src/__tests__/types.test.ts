/**
 * Tests for auth types utility functions
 */

import { describe, it, expect } from 'vitest';
import { getUserInitials } from '../types';

describe('getUserInitials', () => {
  it('returns initials from full name', () => {
    expect(getUserInitials({ name: 'John Doe', email: 'j@test.com' })).toBe('JD');
  });

  it('returns the first two letters of a single-word name (the shared getPersonInitials rule)', () => {
    expect(getUserInitials({ name: 'Admin', email: 'a@test.com' })).toBe('AD');
  });

  it('returns the first and last words\' initials for long names', () => {
    expect(getUserInitials({ name: 'John Michael Doe', email: 'j@test.com' })).toBe('JD');
  });

  it('returns first letter of email when name is empty', () => {
    expect(getUserInitials({ name: '', email: 'alice@example.com' })).toBe('A');
  });

  it('returns "?" for null user', () => {
    expect(getUserInitials(null)).toBe('?');
  });

  it('returns "?" for undefined user', () => {
    expect(getUserInitials(undefined)).toBe('?');
  });

  it('uppercases initials', () => {
    expect(getUserInitials({ name: 'jane smith', email: 'j@test.com' })).toBe('JS');
  });
});
