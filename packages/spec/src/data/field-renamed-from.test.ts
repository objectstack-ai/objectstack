// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';

// ---------------------------------------------------------------------------
// [epic cloud#3652, ruling D3 「写进清单 renamedFrom」 under Q3
// 「默认拒绝，需显式映射（推荐）」] A field declares the key or keys it was
// renamed from, so a package upgrade carries the old column's data to it
// instead of adding an empty column. The validation is deliberately minimal:
//
//  - field half (`FieldSchema`): each entry is a field key (snake_case);
//  - map half (`ObjectSchema`): not the field's own key, not repeated within
//    one list, not a key another field of the object still declares, not an
//    old key an earlier field already claims.
//
// Each refusal is ONE located `custom` issue whose message names the object,
// the field and the old key — the three things an author greps for.
// ---------------------------------------------------------------------------

const account = (fields: Record<string, unknown>) => ({ name: 'crm_account', fields });

/** The one issue a refused object must carry, at `fields.<field>.renamedFrom.<i>`. */
function refusedAt(input: unknown, field: string, index: number) {
  const parsed = ObjectSchema.safeParse(input);
  expect(parsed.success, 'the declaration must NOT parse clean').toBe(false);
  if (parsed.success) throw new Error('unreachable');
  expect(parsed.error.issues.map((i) => [i.code, i.path])).toEqual([
    ['custom', ['fields', field, 'renamedFrom', index]],
  ]);
  return parsed.error.issues[0]!.message;
}

/** The sentence names the object, the field and the old key. */
function expectNames(message: string, field: string, oldKey: string) {
  expect(message).toContain('object `crm_account`');
  expect(message).toContain(`Field \`${field}\``);
  expect(message).toContain(`'${oldKey}'`);
}

describe('`renamedFrom` — accepted', () => {
  it('a field with one earlier key parses, and the list is kept as written', () => {
    const parsed = ObjectSchema.parse(account({
      account_name: { type: 'text', label: 'Account Name', renamedFrom: ['company'] },
    }));
    expect(parsed.fields.account_name!.renamedFrom).toEqual(['company']);
  });

  it('a field renamed twice lists both earlier keys', () => {
    const parsed = ObjectSchema.parse(account({
      account_name: { type: 'text', label: 'Account Name', renamedFrom: ['company', 'company_name'] },
      status: { type: 'text', label: 'Status', renamedFrom: ['state'] },
    }));
    expect(parsed.fields.account_name!.renamedFrom).toEqual(['company', 'company_name']);
    expect(parsed.fields.status!.renamedFrom).toEqual(['state']);
  });

  it('an object without the key parses as before: nothing materializes on any field', () => {
    const parsed = ObjectSchema.parse(account({
      account_name: { type: 'text', label: 'Account Name' },
      status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] },
    }));
    for (const field of Object.values(parsed.fields)) {
      expect(Object.prototype.hasOwnProperty.call(field, 'renamedFrom')).toBe(false);
    }
  });
});

describe('`renamedFrom` — field half (FieldSchema)', () => {
  it.each([['Company'], ['company-name'], ['1company'], ['']])(
    'refuses %j: an entry must be a field key (snake_case)',
    (entry) => {
      const parsed = FieldSchema.safeParse({ type: 'text', renamedFrom: [entry] });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues.map((i) => i.path)).toEqual([['renamedFrom', 0]]);
      expect(parsed.error.issues[0]!.message).toContain('must be a field key');
    },
  );
});

describe('`renamedFrom` — map half (ObjectSchema)', () => {
  it("refuses the field's own key", () => {
    const message = refusedAt(account({
      account_name: { type: 'text', renamedFrom: ['account_name'] },
    }), 'account_name', 0);
    expectNames(message, 'account_name', 'account_name');
    expect(message).toContain("the field's own key");
  });

  it('refuses an entry repeated within one list, on the repeat', () => {
    const message = refusedAt(account({
      account_name: { type: 'text', renamedFrom: ['company', 'company'] },
    }), 'account_name', 1);
    expectNames(message, 'account_name', 'company');
    expect(message).toContain('an earlier entry of the same list');
  });

  it('refuses a key another field of the object still declares', () => {
    const message = refusedAt(account({
      account_name: { type: 'text', renamedFrom: ['status'] },
      status: { type: 'text' },
    }), 'account_name', 0);
    expectNames(message, 'account_name', 'status');
    expect(message).toContain('still declares a field `status`');
  });

  it('refuses an old key two fields both claim, on the later claimant, naming the first', () => {
    const message = refusedAt(account({
      account_name: { type: 'text', renamedFrom: ['company'] },
      legal_name: { type: 'text', renamedFrom: ['company'] },
    }), 'legal_name', 0);
    expectNames(message, 'legal_name', 'company');
    expect(message).toContain('field `account_name` of the same object already claims');
  });
});
