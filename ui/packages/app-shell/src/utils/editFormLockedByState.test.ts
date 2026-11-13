/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `editFormLockedByState` (objectstack#32756): `true` only when the record's
 * state locks every field the edit form draws, and fail-open everywhere else.
 */

import { describe, it, expect, vi } from 'vitest';
import { editFormLockedByState } from './editFormLockedByState';

const LOCKED_WHEN = "record.status == 'approved'";
const APPROVED = { id: 'r1', status: 'approved', amount: 1 };

const locked = {
  name: 'claim',
  fields: {
    id: { type: 'text' },
    owner: { type: 'lookup', reference: 'sys_user' },
    status: { type: 'text', readonlyWhen: LOCKED_WHEN },
    amount: { type: 'number', readonlyWhen: LOCKED_WHEN },
  },
};

describe('editFormLockedByState (objectstack#32756)', () => {
  it('is true when readonlyWhen locks every drawn field', () => {
    expect(editFormLockedByState(locked, APPROVED)).toBe(true);
  });

  it('reads the array spelling of the field list too', () => {
    const asArray = { name: 'claim', fields: Object.entries(locked.fields).map(([name, f]) => ({ name, ...f })) };
    expect(editFormLockedByState(asArray, APPROVED)).toBe(true);
  });

  it('is false when the predicate does not hold for the record', () => {
    expect(editFormLockedByState(locked, { ...APPROVED, status: 'draft' })).toBe(false);
  });

  it('is false when any drawn field stays writable', () => {
    const withNote = { ...locked, fields: { ...locked.fields, note: { type: 'text' } } };
    expect(editFormLockedByState(withNote, APPROVED)).toBe(false);
  });

  it('ignores a writable field the form does not draw (hidden, or one its visibleWhen hides)', () => {
    const hiddenNote = {
      ...locked,
      fields: {
        ...locked.fields,
        note: { type: 'text', hidden: true },
        memo: { type: 'text', visibleWhen: "record.status == 'draft'" },
      },
    };
    expect(editFormLockedByState(hiddenNote, APPROVED)).toBe(true);
  });

  it('counts a server-computed field as read-only, but never as the state lock', () => {
    const withFormula = { ...locked, fields: { ...locked.fields, total: { type: 'formula' } } };
    expect(editFormLockedByState(withFormula, APPROVED)).toBe(true);
    const formulaOnly = { name: 'claim', fields: { total: { type: 'formula' }, calc: { type: 'text', expression: 'record.a' } } };
    expect(editFormLockedByState(formulaOnly, APPROVED)).toBe(false);
  });

  it('is false for an object read-only by static flags alone: no state locks it', () => {
    const staticOnly = { name: 'claim', fields: { amount: { type: 'number', readonly: true } } };
    expect(editFormLockedByState(staticOnly, APPROVED)).toBe(false);
  });

  it('fails open on a predicate that faults', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = { ...locked, fields: { ...locked.fields, amount: { type: 'number', readonlyWhen: 'record.status ==' } } };
    expect(editFormLockedByState(broken, APPROVED)).toBe(false);
    warn.mockRestore();
  });

  it('is false when the edit form view declares an inline child collection', () => {
    const withSubforms = { ...locked, form: { subforms: [{ object: 'claim_line' }] } };
    expect(editFormLockedByState(withSubforms, APPROVED)).toBe(false);
  });

  it('is false with no object definition or no record', () => {
    expect(editFormLockedByState(undefined, APPROVED)).toBe(false);
    expect(editFormLockedByState(locked, null)).toBe(false);
  });
});
