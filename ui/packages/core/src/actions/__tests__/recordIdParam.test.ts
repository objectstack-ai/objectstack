/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `resolveRecordIdParamSeed` — the one definition of "can this row identify the
 * record this action acts on?" (objectstack#8018).
 *
 * The three verdicts are deliberately distinct, because they point at different
 * repairs: no declaration (nothing to do), an ABSENT key (a projection or
 * read-visibility problem), and a NULL value (a data problem). Collapsing the
 * last two into one silent skip is the defect this function replaces.
 */

import { describe, it, expect } from 'vitest';
import { resolveRecordIdParamSeed } from '../recordIdParam';

const REVOKE = {
  name: 'revoke_session',
  label: 'Revoke Session',
  recordIdParam: 'token',
  recordIdField: 'token',
};

describe('resolveRecordIdParamSeed', () => {
  it('returns the row value when the key is present', () => {
    expect(resolveRecordIdParamSeed(REVOKE, { id: 's1', token: 'tok_abc' })).toEqual({
      value: 'tok_abc',
    });
  });

  it('refuses an ABSENT key and names both the action and the field', () => {
    const seed = resolveRecordIdParamSeed(REVOKE, { id: 's1', ip_address: '10.0.0.2' });
    expect(seed.value).toBeUndefined();
    expect(seed.error).toContain('Revoke Session');
    expect(seed.error).toContain('"token"');
    expect(seed.error).toContain('not present on the row');
  });

  it('refuses a NULL value with a DIFFERENT message than an absent key', () => {
    const absent = resolveRecordIdParamSeed(REVOKE, { id: 's1' });
    const nulled = resolveRecordIdParamSeed(REVOKE, { id: 's1', token: null });
    expect(nulled.error).toContain('has no value');
    expect(nulled.error).not.toEqual(absent.error);
  });

  it('refuses `undefined` stored under a present key — an explicit hole is still a hole', () => {
    expect(resolveRecordIdParamSeed(REVOKE, { id: 's1', token: undefined }).error)
      .toContain('has no value');
  });

  it('defaults the field to `id`', () => {
    const byId = { name: 'a', recordIdParam: 'recordId' };
    expect(resolveRecordIdParamSeed(byId, { id: 'r1' })).toEqual({ value: 'r1' });
    expect(resolveRecordIdParamSeed(byId, { code: 'X' }).error).toContain('"id"');
  });

  it('has no opinion when the action declares no recordIdParam', () => {
    expect(resolveRecordIdParamSeed({ name: 'a', recordIdField: 'token' }, {})).toEqual({});
  });

  it('has no opinion when there is no row record at all', () => {
    // A path with no row context is not this guard's business — the caller's
    // own resolution (explicit params, grid selection) owns that case.
    expect(resolveRecordIdParamSeed(REVOKE, undefined)).toEqual({});
    expect(resolveRecordIdParamSeed(REVOKE, null)).toEqual({});
  });

  it('tolerates a missing action', () => {
    expect(resolveRecordIdParamSeed(null, { id: 'r1' })).toEqual({});
    expect(resolveRecordIdParamSeed(undefined, { id: 'r1' })).toEqual({});
  });

  it('falls back to the param name when the action carries no label or name', () => {
    expect(resolveRecordIdParamSeed({ recordIdParam: 'token' }, {}).error).toContain('"token"');
  });

  it('passes through falsy-but-real values instead of refusing them', () => {
    // `0` and `''` are values a record legitimately holds. Only null/undefined
    // mean "no value" — a `!value` test here would refuse a real record.
    expect(resolveRecordIdParamSeed({ recordIdParam: 'p', recordIdField: 'n' }, { n: 0 }))
      .toEqual({ value: 0 });
    expect(resolveRecordIdParamSeed({ recordIdParam: 'p', recordIdField: 'n' }, { n: '' }))
      .toEqual({ value: '' });
    expect(resolveRecordIdParamSeed({ recordIdParam: 'p', recordIdField: 'n' }, { n: false }))
      .toEqual({ value: false });
  });
});
