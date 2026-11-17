/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What the request page draws of a submitted record (objectstack#34588): which
 * fields, in which section, which changed after submission, and how two values
 * compare. The faces over the real panel are pinned in
 * `ApprovalDecisionPanel.fullRecord-34588.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { distinctLabels, planSubmittedRecord, valuesDiffer } from './submittedRecordPlan';

const FIELDS: Record<string, Record<string, unknown>> = {
  name: { type: 'text', label: 'Name' },
  amount: { type: 'currency', label: 'Amount' },
  account: { type: 'lookup', reference: 'account', label: 'Account' },
  due_on: { type: 'date', label: 'Due On' },
  tags: { type: 'multiselect', label: 'Tags' },
  note: { type: 'textarea', label: 'Note' },
  secret: { type: 'text', label: 'Secret', hidden: true },
  owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner', system: true },
  receipt: { type: 'file', label: 'Receipt' },
  photo: { type: 'image', label: 'Photo' },
};

const SECTIONS = [
  { key: 'main', fields: ['name', 'amount', 'account', 'due_on', 'tags', 'secret', 'owner_id', 'receipt', 'photo', 'legacy'] },
  { key: 'details', label: 'More details', fields: ['note', 'name'] },
];

describe('planSubmittedRecord (objectstack#34588)', () => {
  it('draws every declared, visible, non-bookkeeping field either row serves, in section order, each once', () => {
    const plan = planSubmittedRecord(
      SECTIONS,
      FIELDS,
      { name: 'PO-1', amount: 800, account: 'acc_1', due_on: null, tags: [], secret: 's', owner_id: 'u1', legacy: 'x', note: 'n' },
      null,
    );
    expect(plan.sections.map((s) => [s.key, s.fields.map((f) => f.key)])).toEqual([
      ['main', ['name', 'amount', 'account', 'due_on', 'tags']],
      ['details', ['note']],
    ]);
    expect(plan.sections[1].label).toBe('More details');
    expect(plan.changedCount).toBe(0);
  });

  it('a field neither row serves is not drawn: the reader may not read it', () => {
    const plan = planSubmittedRecord(SECTIONS, FIELDS, { name: 'PO-1' }, { id: 'r1', name: 'PO-1', amount: 800 });
    expect(plan.sections[0].fields.map((f) => f.key)).toEqual(['name', 'amount']);
    expect(plan.sections).toHaveLength(1);
  });

  it('marks a field changed only when the current row holds it and it differs, and carries the current value', () => {
    const plan = planSubmittedRecord(
      SECTIONS,
      FIELDS,
      { name: 'PO-1', amount: 800, account: 'acc_1', note: 'n' },
      { name: 'PO-1', amount: 950, account: { id: 'acc_1', name: 'Fabrikam' } },
    );
    const byKey = new Map(plan.sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
    expect(byKey.get('amount')).toEqual({ key: 'amount', value: 800, changed: true, current: 950 });
    expect(byKey.get('account')?.changed).toBe(false); // the same record, expanded
    expect(byKey.get('note')?.changed).toBe(false); // the current row does not serve it
    expect(byKey.get('name')?.changed).toBe(false);
    expect(plan.changedCount).toBe(1);
  });

  it('a field set after submission is drawn from the current row and marked changed', () => {
    const plan = planSubmittedRecord(SECTIONS, FIELDS, { name: 'PO-1' }, { name: 'PO-1', due_on: '2026-12-01' });
    const due = plan.sections[0].fields.find((f) => f.key === 'due_on');
    expect(due).toEqual({ key: 'due_on', value: undefined, changed: true, current: '2026-12-01' });
  });

  it('attachments go to their own list, after the grid, only when a file is held', () => {
    const plan = planSubmittedRecord(SECTIONS, FIELDS, { name: 'PO-1', receipt: 'file_1', photo: [] }, null);
    expect(plan.attachments.map((f) => f.key)).toEqual(['receipt']);
    expect(plan.sections[0].fields.map((f) => f.key)).toEqual(['name']);
  });

  it('an attachment removed after submission stays listed, marked changed', () => {
    const plan = planSubmittedRecord(SECTIONS, FIELDS, { receipt: ['file_1'] }, { receipt: [] });
    expect(plan.attachments).toEqual([{ key: 'receipt', value: ['file_1'], changed: true, current: [] }]);
    expect(plan.changedCount).toBe(1);
  });
});

describe('valuesDiffer (objectstack#34588)', () => {
  it('empty is one value: absent, null, blank and an empty list', () => {
    for (const [a, b] of [[undefined, null], [null, ''], ['  ', []], [[], undefined]] as const) {
      expect(valuesDiffer(FIELDS.name, a, b)).toBe(false);
    }
    expect(valuesDiffer(FIELDS.name, null, 'x')).toBe(true);
  });

  it('numbers compare by value, a numeric string included on a numeric field', () => {
    expect(valuesDiffer(FIELDS.amount, 800, '800.00')).toBe(false);
    expect(valuesDiffer(FIELDS.amount, 800, 801)).toBe(true);
  });

  it('a reference compares by the record it names, stored or expanded', () => {
    expect(valuesDiffer(FIELDS.account, 'acc_1', { id: 'acc_1', name: 'Fabrikam' })).toBe(false);
    expect(valuesDiffer(FIELDS.account, { _id: 'acc_1' }, { id: 'acc_2' })).toBe(true);
  });

  it('a date compares by its instant; a list as a set', () => {
    expect(valuesDiffer(FIELDS.due_on, '2026-07-23', '2026-07-23T00:00:00.000Z')).toBe(false);
    expect(valuesDiffer(FIELDS.due_on, '2026-07-23', '2026-07-24')).toBe(true);
    expect(valuesDiffer(FIELDS.tags, ['a', 'b'], ['b', 'a'])).toBe(false);
    expect(valuesDiffer(FIELDS.tags, ['a'], ['a', 'c'])).toBe(true);
  });

  it('CONTROL: text that only looks like a date or a number on a text field compares as text', () => {
    expect(valuesDiffer(FIELDS.name, '1', '01')).toBe(true);
    expect(valuesDiffer(FIELDS.name, 'x', 'x')).toBe(false);
  });

  it('an object without an id compares by its content, key order aside', () => {
    expect(valuesDiffer(FIELDS.note, { a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(false);
    expect(valuesDiffer(FIELDS.note, { a: 1 }, { a: 2 })).toBe(true);
  });
});

describe('distinctLabels (objectui#12483)', () => {
  it('qualifies only the shared labels, and every label when a qualified one still collides', () => {
    expect(distinctLabels([{ key: 'a', label: 'X' }, { key: 'b', label: 'X' }, { key: 'c', label: 'Y' }]))
      .toEqual(['X (a)', 'X (b)', 'Y']);
    expect(distinctLabels([{ key: 'a', label: 'X' }, { key: 'b', label: 'X' }, { key: 'c', label: 'X (a)' }]))
      .toEqual(['X (a)', 'X (b)', 'X (a) (c)']);
  });
});
