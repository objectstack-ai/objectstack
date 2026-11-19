// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26597 — what a field row of the Access matrix draws, and what a
 * click or a bulk shortcut writes, for a field the set has NO entry for.
 *
 * A set's `fields` map constrains only the fields it names (ADR-0066 ⑧): a
 * field without an entry passes the write gate and the read mask, and the
 * object grant alone decides. `fieldRuleCell` draws that row from the object
 * row's grant and marks it inherited; an explicit entry draws its own bits.
 * The table below is the one the runtime half pins against the real write
 * gate (plugin-security `field-rule-object-grant.test.ts`): change the two
 * together.
 */

import { describe, expect, it } from 'vitest';
import { FieldPermissionSchema } from '@objectstack/spec/security';
import {
  applyFieldBulk,
  fieldRuleCell,
  fieldRuleSeed,
  withFieldBits,
  type FieldPerm,
  type ObjectPerm,
} from './permission-slice';

const EDIT_ON: ObjectPerm = { allowRead: true, allowCreate: true, allowEdit: true };
const EDIT_OFF: ObjectPerm = { allowRead: true, allowCreate: true };

const RULES: Record<'absent' | 'readOnly' | 'editable', FieldPerm | undefined> = {
  absent: undefined,
  readOnly: { readable: true, editable: false },
  editable: { readable: true, editable: true },
};

/**
 * May a holder of this set ALONE edit the field? The write gate's answer for
 * each cell, as `field-rule-object-grant.test.ts` measures it.
 */
const RUNTIME_EDIT_VERDICT = {
  EDIT_ON: { absent: true, readOnly: false, editable: true },
  EDIT_OFF: { absent: false, readOnly: false, editable: false },
} as const;

describe('fieldRuleCell — a row draws what the runtime enforces (objectstack#26597)', () => {
  for (const [objectLabel, objectPerm] of [['EDIT_ON', EDIT_ON], ['EDIT_OFF', EDIT_OFF]] as const) {
    for (const rule of ['absent', 'readOnly', 'editable'] as const) {
      it(`${objectLabel} × ${rule}: the drawn edit right equals the write gate's verdict`, () => {
        const cell = fieldRuleCell(RULES[rule], objectPerm);
        // A box that is ticked and not capped is an edit right the holder has.
        expect(cell.editable && !cell.editCapped).toBe(RUNTIME_EDIT_VERDICT[objectLabel][rule]);
        expect(cell.inherited).toBe(rule === 'absent');
      });
    }
  }

  it('a field without an entry draws the object grant', () => {
    expect(fieldRuleCell(undefined, EDIT_ON)).toEqual({
      inherited: true,
      readable: true,
      editable: true,
      readCapped: false,
      editCapped: false,
    });
    expect(fieldRuleCell(undefined, EDIT_OFF)).toMatchObject({ inherited: true, readable: true, editable: false });
    // No object row at all: nothing is granted.
    expect(fieldRuleCell(undefined, undefined)).toMatchObject({ inherited: true, readable: false, editable: false });
    expect(fieldRuleCell(undefined, {})).toMatchObject({ inherited: true, readable: false, editable: false });
  });

  it('reads the object row through the spec fold: the super-user bits grant too', () => {
    expect(fieldRuleCell(undefined, { modifyAllRecords: true })).toMatchObject({ readable: true, editable: true });
    expect(fieldRuleCell(undefined, { viewAllRecords: true })).toMatchObject({ readable: true, editable: false });
  });

  it('an entry draws its own bits; a bit the object row does not back is capped', () => {
    expect(fieldRuleCell({ readable: true, editable: true }, EDIT_OFF)).toEqual({
      inherited: false,
      readable: true,
      editable: true,
      readCapped: false,
      editCapped: true,
    });
    expect(fieldRuleCell({ readable: true, editable: false }, {})).toMatchObject({ readCapped: true, editCapped: false });
    expect(fieldRuleCell({ readable: false, editable: false }, EDIT_ON)).toEqual({
      inherited: false,
      readable: false,
      editable: false,
      readCapped: false,
      editCapped: false,
    });
  });
});

describe('fieldRuleSeed — a click starts from what the row draws', () => {
  it('a row without an entry seeds the bits it draws', () => {
    expect(fieldRuleSeed(undefined, EDIT_ON)).toEqual({ readable: true, editable: true });
    expect(fieldRuleSeed(undefined, EDIT_OFF)).toEqual({ readable: true, editable: false });
  });

  it('an entry seeds itself, its row condition included', () => {
    const entry: FieldPerm = { readable: true, editable: false, when: "status == 'approved'" };
    expect(fieldRuleSeed(entry, EDIT_ON)).toBe(entry);
  });
});

describe('applyFieldBulk — a shortcut writes only the rows whose boxes change', () => {
  const NAMES = ['amount', 'notes'];

  it('Read-only all over rows without an entry, on an object that grants Edit, writes the lock it draws', () => {
    expect(applyFieldBulk({}, 'deal', EDIT_ON, 'readable', NAMES)).toEqual({
      'deal.amount': { readable: true, editable: false },
      'deal.notes': { readable: true, editable: false },
    });
  });

  it('Read-only all over rows that already draw read-only writes nothing', () => {
    expect(applyFieldBulk({}, 'deal', EDIT_OFF, 'readable', NAMES)).toEqual({});
    const locked = { 'deal.amount': { readable: true, editable: false } };
    expect(applyFieldBulk(locked, 'deal', EDIT_ON, 'readable', ['amount'])).toEqual(locked);
  });

  it('Write all writes only where Edit is drawn off', () => {
    expect(applyFieldBulk({}, 'deal', EDIT_ON, 'writable', NAMES)).toEqual({});
    expect(applyFieldBulk({}, 'deal', EDIT_OFF, 'writable', NAMES)).toEqual({
      'deal.amount': { readable: true, editable: true },
      'deal.notes': { readable: true, editable: true },
    });
  });

  it('keeps an authored row condition when it rewrites a row', () => {
    const fields = { 'deal.amount': { readable: true, editable: true, when: "status == 'draft'" } };
    expect(applyFieldBulk(fields, 'deal', EDIT_ON, 'readable', ['amount'])).toEqual({
      'deal.amount': { readable: true, editable: false, when: "status == 'draft'" },
    });
  });

  it('Clear drops the entries, so the rows draw the object grant again; the input is not mutated', () => {
    const fields = {
      'deal.amount': { readable: true, editable: false },
      'deal.notes': { readable: false, editable: false },
      'deal.stage': { readable: true, editable: false },
    };
    const before = JSON.stringify(fields);
    const next = applyFieldBulk(fields, 'deal', EDIT_ON, 'clear', NAMES);
    expect(next).toEqual({ 'deal.stage': { readable: true, editable: false } });
    expect(fieldRuleCell(next['deal.amount'], EDIT_ON)).toMatchObject({ inherited: true, editable: true });
    expect(JSON.stringify(fields)).toBe(before);
  });
});

describe('withFieldBits — a roll-up acknowledgement survives a readable rewrite and never a hidden one', () => {
  const REASON = 'Service staff read account totals but not invoice rows';
  const acknowledged: FieldPerm = { readable: true, editable: true, rollupSourceUnreadableReason: REASON };

  it('keeps the reason while the entry stays readable, and the spec accepts the entry', () => {
    const next = withFieldBits(acknowledged, true, false);
    expect(next).toEqual({ readable: true, editable: false, rollupSourceUnreadableReason: REASON });
    expect(FieldPermissionSchema.safeParse(next).success).toBe(true);
  });

  it('drops the reason when the entry goes readable:false, the shape the spec refuses it beside', () => {
    // The refused shape, measured against the real schema, so the drop below is load-bearing.
    const refused = FieldPermissionSchema.safeParse({ readable: false, editable: false, rollupSourceUnreadableReason: REASON });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((i) => i.path.join('.'))).toContain('rollupSourceUnreadableReason');

    const next = withFieldBits(acknowledged, false, false);
    expect(next).toEqual({ readable: false, editable: false });
    expect(FieldPermissionSchema.safeParse(next).success).toBe(true);
  });

  it('the bulk Read-only all shortcut keeps the reason on the row it rewrites', () => {
    const fields = { 'deal.total': acknowledged };
    const next = applyFieldBulk(fields, 'deal', EDIT_ON, 'readable', ['total']);
    expect(next['deal.total']).toEqual({ readable: true, editable: false, rollupSourceUnreadableReason: REASON });
    expect(FieldPermissionSchema.safeParse(next['deal.total']).success).toBe(true);
  });
});
