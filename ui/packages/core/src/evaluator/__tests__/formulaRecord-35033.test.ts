/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35033 — the object's `formula` fields computed over the record a
 * form is editing, so a `visibleWhen` reading one is judged on the value the
 * written record would serve, as the server judges it (objectql
 * `formulaValuesFor`), and not on the value last read or on nothing.
 */

import { describe, it, expect } from 'vitest';
import { planObjectFormulas } from '../formulaRecord.js';
import { resolveFieldRuleState } from '../fieldRules.js';

const ORDER_FIELDS = {
  qty: { type: 'number' },
  price: { type: 'currency' },
  account: { type: 'lookup', reference: 'account' },
  status: { type: 'select', options: [{ value: 'open', label: 'Open' }] },
  total: { type: 'formula', expression: { dialect: 'cel', source: 'record.qty * record.price' }, scale: 2 },
  big_order: { type: 'formula', expression: 'record.total > 100.0' },
  discount_note: { type: 'text', required: true, visibleWhen: 'record.big_order == true' },
};

describe('planObjectFormulas — computing formulas over the live record (objectstack#35033)', () => {
  it('is undefined for an object that declares no formula', () => {
    expect(planObjectFormulas({ qty: { type: 'number' } })).toBeUndefined();
    expect(planObjectFormulas(undefined)).toBeUndefined();
  });

  it('computes each formula after the formulas it reads, whatever the declaration order', () => {
    const plan = planObjectFormulas({
      big_order: ORDER_FIELDS.big_order,
      total: ORDER_FIELDS.total,
      qty: ORDER_FIELDS.qty,
      price: ORDER_FIELDS.price,
    })!;
    expect(plan.order).toEqual(['total', 'big_order']);
    const out = plan.compute({ qty: 3, price: 50.004 });
    expect(out.total).toBe(150.01);
    expect(out.big_order).toBe(true);
  });

  it('never mutates the record it is handed, and overwrites a stale served value', () => {
    const plan = planObjectFormulas(ORDER_FIELDS)!;
    const record = { qty: 1, price: 10, total: 999, big_order: true };
    const out = plan.compute(record);
    expect(record).toEqual({ qty: 1, price: 10, total: 999, big_order: true });
    expect(out).toMatchObject({ total: 10, big_order: false });
  });

  it('a fault a read shares — an empty operand — reads null, and a formula over it is computed on that null', () => {
    const plan = planObjectFormulas(ORDER_FIELDS)!;
    const out = plan.compute({ qty: null, price: 10 });
    expect(out.total).toBeNull();
    // `null > 100.0` faults too, so it reads null in its turn.
    expect(out.big_order).toBeNull();
    expect(plan.unservable.size).toBe(0);
  });

  it('a formula on a cycle reads null without being evaluated', () => {
    const plan = planObjectFormulas({
      a: { type: 'formula', expression: 'record.b + 1' },
      b: { type: 'formula', expression: 'record.a + 1' },
      c: { type: 'formula', expression: 'record.qty + 1' },
      qty: { type: 'number' },
    })!;
    const out = plan.compute({ qty: 1, a: 5, b: 6 });
    expect(out.a).toBeNull();
    expect(out.b).toBeNull();
    expect(out.c).toBe(2);
  });

  it('a formula reading through a reference is unservable, and so is a formula reading it, at any depth', () => {
    const plan = planObjectFormulas({
      ...ORDER_FIELDS,
      tier: { type: 'formula', expression: 'record.account.tier' },
      gold: { type: 'formula', expression: "record.tier == 'gold'" },
    })!;
    expect(plan.unservable.get('tier')).toMatch(/reads through 'account'/);
    expect(plan.unservable.get('gold')).toMatch(/reads the formula 'tier'/);
    // An unservable formula keeps the value the record holds for it.
    const out = plan.compute({ account: 'acc_1', tier: 'silver', gold: false });
    expect(out.tier).toBe('silver');
    expect(out.gold).toBe(false);
    expect(plan.unservableReadsOf('record.gold == true').map(([name]) => name)).toEqual(['gold']);
    expect(plan.unservableReadsOf('record.big_order == true')).toEqual([]);
  });

  it('label(), a scope root other than record, and an expression not served are unservable', () => {
    const plan = planObjectFormulas({
      status: ORDER_FIELDS.status,
      status_label: { type: 'formula', expression: 'label(record.status)' },
      mine: { type: 'formula', expression: 'current_user.id == "u1"' },
      may_edit: { type: 'formula', expression: "current_user.can('order', 'edit')" },
      masked: { type: 'formula' },
    })!;
    expect(plan.unservable.get('status_label')).toMatch(/label\(\)/);
    expect(plan.unservable.get('mine')).toMatch(/'current_user'/);
    expect(plan.unservable.get('may_edit')).toMatch(/'current_user'/);
    expect(plan.unservable.get('masked')).toMatch(/no expression/);
  });

  it('a predicate whose reads cannot be named counts as reading every unservable formula', () => {
    const plan = planObjectFormulas({ masked: { type: 'formula' }, qty: { type: 'number' } })!;
    expect(plan.unservableReadsOf({ dialect: 'cel', source: 'record.qty >' })).toEqual([
      ['masked', 'has no expression served to this reader'],
    ]);
    expect(plan.unservableReadsOf('previous.masked == 1').map(([name]) => name)).toEqual(['masked']);
  });
});

describe('a required field whose visibleWhen reads a formula, judged over the computed record (objectstack#35033)', () => {
  const plan = planObjectFormulas(ORDER_FIELDS)!;
  const shown = (record: Record<string, unknown>, previous?: Record<string, unknown>) =>
    resolveFieldRuleState(
      { visibleWhen: ORDER_FIELDS.discount_note.visibleWhen },
      plan.compute(record),
      { required: true },
      previous,
    );

  it('create: hidden until the inputs make the formula satisfy it, then shown and required', () => {
    const seed = { qty: null, price: null, total: null, big_order: null, discount_note: null };
    expect(shown(seed).visible).toBe(false);
    expect(shown({ ...seed, qty: 2, price: 10 }).visible).toBe(false);
    const crossed = shown({ ...seed, qty: 20, price: 10 });
    expect(crossed).toMatchObject({ visible: true, required: true, faults: {} });
  });

  it('edit: a served value outside the condition is recomputed when the inputs cross it, and back', () => {
    const served = { qty: 1, price: 10, total: 10, big_order: false, discount_note: null };
    expect(shown({ ...served, qty: 50 }, served)).toMatchObject({ visible: true, required: true });
    const big = { ...served, qty: 50, total: 500, big_order: true };
    expect(shown({ ...big, qty: 1 }, big).visible).toBe(false);
  });
});
