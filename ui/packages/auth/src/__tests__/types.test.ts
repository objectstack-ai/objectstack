/**
 * Tests for auth types utility functions
 */

import { describe, it, expect } from 'vitest';
import { getUserInitials } from '../types';

describe('getUserInitials', () => {
  it('returns initials from full name', () => {
    expect(getUserInitials({ name: 'John Doe', email: 'j@test.com' })).toBe('JD');
  });

  it('returns single initial for single-word name', () => {
    expect(getUserInitials({ name: 'Admin', email: 'a@test.com' })).toBe('A');
  });

  it('returns at most 2 characters for long names', () => {
    expect(getUserInitials({ name: 'John Michael Doe', email: 'j@test.com' })).toBe('JM');
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
