// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * sanitizeRowError() — driver/query-builder errors embed the whole failing SQL
 * statement in `err.message`; it must never reach the importer verbatim
 * (framework#3566). Common constraint failures map to human wording.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeRowError } from './import-runner';

describe('sanitizeRowError', () => {
  it('maps a sqlite UNIQUE violation to a friendly, SQL-free message', () => {
    const raw =
      "insert into `sys_user` (`email`, `name`, `phone_number`) values " +
      "('a@b.com', 'zhoujunyi', '13800000000') - UNIQUE constraint failed: sys_user.phone_number";
    const out = sanitizeRowError(raw);
    expect(out).toBe('A record with this phone_number already exists.');
    expect(out).not.toMatch(/insert into/i);
  });

  it('maps a mysql duplicate entry', () => {
    const raw =
      "insert into `sys_user` ... - ER_DUP_ENTRY: Duplicate entry 'a@b.com' for key 'sys_user.email'";
    expect(sanitizeRowError(raw)).toBe('A record with this email already exists.');
  });

  it('maps a postgres unique violation', () => {
    const raw =
      'insert into "sys_user" ... - duplicate key value violates unique constraint "sys_user_email_key" ' +
      'Detail: Key (email)=(a@b.com) already exists.';
    expect(sanitizeRowError(raw)).toBe('A record with this email already exists.');
  });

  it('maps a NOT NULL violation', () => {
    const raw = 'insert into `sys_user` (...) values (...) - NOT NULL constraint failed: sys_user.name';
    expect(sanitizeRowError(raw)).toBe('name is required.');
  });

  it('never leaks a raw SQL statement even for an unrecognized reason', () => {
    const raw = 'insert into `sys_user` (`email`) values (?) - some cryptic driver failure';
    const out = sanitizeRowError(raw);
    expect(out).not.toMatch(/insert into/i);
    // salvages the trailing non-SQL reason
    expect(out).toBe('some cryptic driver failure');
  });

  it('falls back to a generic message when only SQL is present', () => {
    const raw = 'insert into `sys_user` (`email`) values (?)';
    expect(sanitizeRowError(raw)).toBe(
      'The database rejected this row (a value may be invalid or already in use).',
    );
  });

  it('passes already-friendly messages through unchanged', () => {
    expect(sanitizeRowError('User already exists. Use another email.')).toBe(
      'User already exists. Use another email.',
    );
  });

  it('handles empty / non-string input', () => {
    expect(sanitizeRowError('')).toBe('Row failed');
    expect(sanitizeRowError(undefined)).toBe('Row failed');
    expect(sanitizeRowError(null)).toBe('Row failed');
  });
});
