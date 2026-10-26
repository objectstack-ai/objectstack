/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `withoutDeniedFields` — the field-read rule for one record (objectui#10594).
 *
 * The four pins the ruling names: a denied field is dropped; `id` / `_id` and
 * the extra identity keys are kept; the same object comes back when nothing is
 * withheld; the record passes through before a policy loads. The call sites'
 * own pins (lookup label, record picker, record title, search-hit label, user
 * cell) are the regression net for the callers.
 */

import { describe, it, expect } from 'vitest';
import { withoutDeniedFields } from '../without-denied-fields';
import * as corePublicEntry from '../../index.js';

/** A loaded policy that denies exactly `denied` on `object`, and records every ask. */
function policyDenying(object: string, denied: readonly string[]) {
  const asked: Array<[string, string, string]> = [];
  return {
    asked,
    isLoaded: true,
    checkField(o: string, field: string, action: 'read') {
      asked.push([o, field, action]);
      return !(o === object && denied.includes(field));
    },
  };
}

describe('withoutDeniedFields (objectui#10594)', () => {
  it('is exported from the package entry', () => {
    expect(corePublicEntry.withoutDeniedFields).toBe(withoutDeniedFields);
  });

  it('drops a field the loaded policy denies on the named object', () => {
    const policy = policyDenying('account', ['salary']);
    const row = { id: 'a1', name: 'Ada', salary: 100 };

    expect(withoutDeniedFields(row, policy, 'account')).toEqual({ id: 'a1', name: 'Ada' });
    expect(policy.asked).toEqual([
      ['account', 'name', 'read'],
      ['account', 'salary', 'read'],
    ]);
  });

  it('keeps `id`, `_id` and every extra identity key without asking the policy', () => {
    const policy = policyDenying('account', ['id', '_id', 'code', 'salary']);
    const row = { id: 'a1', _id: 'a1', code: 'A-1', salary: 100 };

    expect(withoutDeniedFields(row, policy, 'account', ['code'])).toEqual({
      id: 'a1',
      _id: 'a1',
      code: 'A-1',
    });
    expect(policy.asked).toEqual([['account', 'salary', 'read']]);
  });

  it('judges an extra identity key like any field when it is not named', () => {
    const policy = policyDenying('account', ['code']);

    expect(withoutDeniedFields({ id: 'a1', code: 'A-1' }, policy, 'account')).toEqual({ id: 'a1' });
  });

  it('returns the SAME object when nothing is withheld', () => {
    const policy = policyDenying('account', ['salary']);
    const row = { id: 'a1', name: 'Ada' };

    expect(withoutDeniedFields(row, policy, 'account')).toBe(row);
  });

  it('returns a new object and leaves the served row untouched when something is withheld', () => {
    const policy = policyDenying('account', ['salary']);
    const row = { id: 'a1', salary: 100 };

    const shown = withoutDeniedFields(row, policy, 'account');
    expect(shown).not.toBe(row);
    expect(row).toEqual({ id: 'a1', salary: 100 });
  });

  it('passes the record through before a policy loads, without asking it', () => {
    const policy = { ...policyDenying('account', ['salary']), isLoaded: false };
    const row = { id: 'a1', salary: 100 };

    expect(withoutDeniedFields(row, policy, 'account')).toBe(row);
    expect(policy.asked).toEqual([]);
  });

  it('passes the record through with no policy', () => {
    const row = { id: 'a1', salary: 100 };

    expect(withoutDeniedFields(row, undefined, 'account')).toBe(row);
    expect(withoutDeniedFields(row, null, 'account')).toBe(row);
  });

  it('passes the record through with no object to judge the fields against', () => {
    const policy = policyDenying('account', ['salary']);
    const row = { id: 'a1', salary: 100 };

    expect(withoutDeniedFields(row, policy, undefined)).toBe(row);
    expect(withoutDeniedFields(row, policy, '')).toBe(row);
    expect(policy.asked).toEqual([]);
  });

  it('passes a value that is not an object through', () => {
    const policy = policyDenying('account', ['salary']);

    expect(withoutDeniedFields(null, policy, 'account')).toBeNull();
    expect(withoutDeniedFields(undefined, policy, 'account')).toBeUndefined();
    expect(withoutDeniedFields('a1', policy, 'account')).toBe('a1');
    expect(policy.asked).toEqual([]);
  });
});
