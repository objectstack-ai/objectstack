// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { isObjectAbsentError } from './object-absence.js';

/**
 * [#29503] `isObjectAbsentError` answers `true` only for an absence of the
 * object that was read. Everything else is an outage the caller must refuse on.
 */
describe('isObjectAbsentError', () => {
  it('a missing-table refusal naming the object read is absence', () => {
    expect(isObjectAbsentError(new Error('SQLITE_ERROR: no such table: sys_team_member'), 'sys_team_member')).toBe(true);
    expect(isObjectAbsentError(new Error('relation "sys_user_position" does not exist'), 'sys_user_position')).toBe(true);
  });

  it('the engine\'s OBJECT_NOT_FOUND for the object read is absence', () => {
    const refused = Object.assign(new Error("Object 'sys_member' is not registered"), { code: 'OBJECT_NOT_FOUND', object: 'sys_member' });
    expect(isObjectAbsentError(refused, 'sys_member')).toBe(true);
  });

  it('⛔ an absence attributed to another object is not evidence about this one', () => {
    expect(isObjectAbsentError(new Error('SQLITE_ERROR: no such table: sys_team'), 'sys_team_member')).toBe(false);
    const refused = Object.assign(new Error("Object 'sys_team' is not registered"), { code: 'OBJECT_NOT_FOUND', object: 'sys_team' });
    expect(isObjectAbsentError(refused, 'sys_team_member')).toBe(false);
  });

  it('⛔ an OBJECT_NOT_FOUND that names no object is not attributable', () => {
    expect(isObjectAbsentError(Object.assign(new Error('not found'), { code: 'OBJECT_NOT_FOUND' }), 'sys_member')).toBe(false);
  });

  it('⛔ an outage is not absence', () => {
    expect(isObjectAbsentError(Object.assign(new Error('SQLITE_IOERR: disk I/O error'), { code: 'SQLITE_IOERR' }), 'sys_member')).toBe(false);
    expect(isObjectAbsentError(new Error('connection terminated unexpectedly'), 'sys_member')).toBe(false);
    expect(isObjectAbsentError(undefined, 'sys_member')).toBe(false);
    expect(isObjectAbsentError(null, 'sys_member')).toBe(false);
  });
});
