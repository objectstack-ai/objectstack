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

  it('label(), current_user.can(), the acting user with none held, and an expression not served are unservable', () => {
    const plan = planObjectFormulas({
      status: ORDER_FIELDS.status,
      status_label: { type: 'formula', expression: 'label(record.status)' },
      mine: { type: 'formula', expression: 'current_user.id == "u1"' },
      may_edit: { type: 'formula', expression: "current_user.can('order', 'edit')" },
      masked: { type: 'formula' },
    })!;
    expect(plan.unservable.get('status_label')).toMatch(/label\(\)/);
    expect(plan.unservable.get('mine')).toMatch(/acting user \('current_user'\)/);
    expect(plan.unservable.get('may_edit')).toMatch(/current_user\.can\(\)/);
    expect(plan.unservable.get('masked')).toMatch(/no expression/);
  });

  it('binds the acting user as the server does (id and positions): current_user, user and ctx compute; can() and os stay unservable', () => {
    const fields = {
      owner: { type: 'text' },
      mine: { type: 'formula', expression: 'record.owner == current_user.id' },
      mine_alias: { type: 'formula', expression: 'record.owner == user.id && ctx.user.id == user.id' },
      is_admin: { type: 'formula', expression: "'admin' in current_user.positions" },
      platform: { type: 'formula', expression: 'current_user.isPlatformAdmin' },
      // A member the server does not bind faults to null there, and here.
      email: { type: 'formula', expression: 'current_user.email' },
      may_edit: { type: 'formula', expression: "current_user.can('order', 'edit')" },
      org: { type: 'formula', expression: 'os.org.id' },
      prior: { type: 'formula', expression: 'previous.owner' },
    };
    const scope = { current_user: { id: 'u1', name: 'Ada', email: 'ada@example.com', positions: ['admin'], isPlatformAdmin: true } };
    const plan = planObjectFormulas(fields, scope)!;
    expect([...plan.unservable.keys()].sort()).toEqual(['may_edit', 'org']);
    expect(plan.unservable.get('may_edit')).toMatch(/current_user\.can\(\)/);
    expect(plan.unservable.get('org')).toMatch(/'os'/);

    expect(plan.compute({ owner: 'u1' })).toMatchObject({ mine: true, mine_alias: true, is_admin: true, platform: false, email: null });
    expect(plan.compute({ owner: 'u2' })).toMatchObject({ mine: false, mine_alias: false });
    // `isPlatformAdmin` is derived from positions, as the server derives it.
    const admin = planObjectFormulas(fields, { current_user: { id: 'u1', positions: ['platform_admin'] } })!;
    expect(admin.compute({ owner: 'u1' })).toMatchObject({ platform: true });

    // No acting user held (no scope, or the signed-out visitor's null id): unservable.
    // `os` is unservable either way: the server binds `os.org`, the form cannot.
    for (const none of [undefined, { current_user: { id: null, positions: [] } }]) {
      const p = planObjectFormulas(fields, none)!;
      expect(p.unservable.get('mine')).toMatch(/acting user/);
      expect(p.unservable.get('mine_alias')).toMatch(/acting user/);
      expect(p.unservable.get('org')).toMatch(/'os'/);
    }
  });

  it('a root neither side binds (previous, vars, features) is a fault a read shares: it reads null and the rule is judged on that null', () => {
    const fields = {
      prior: { type: 'formula', expression: "previous.owner == 'u1'" },
      flagged: { type: 'formula', expression: 'vars.flag == true || features.beta == true' },
      note: { type: 'text', required: true, visibleWhen: 'record.prior == null && record.flagged == null' },
      gated: { type: 'text', required: true, visibleWhen: 'record.flagged == true' },
    };
    for (const scope of [undefined, { current_user: { id: 'u1', positions: [] } }]) {
      const plan = planObjectFormulas(fields, scope)!;
      expect(plan.unservable.size).toBe(0);
      const record = plan.compute({ prior: true, flagged: true });
      expect(record).toMatchObject({ prior: null, flagged: null });
      // Judged on the null, as objectql's formulaValuesFor judges it: not counted as shown.
      expect(plan.unservableReadsOf(fields.gated.visibleWhen)).toEqual([]);
      expect(resolveFieldRuleState({ visibleWhen: fields.gated.visibleWhen }, record, { required: true }).visible).toBe(false);
      expect(resolveFieldRuleState({ visibleWhen: fields.note.visibleWhen }, record, { required: true }).visible).toBe(true);
    }
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
