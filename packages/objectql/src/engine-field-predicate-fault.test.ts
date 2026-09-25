// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0137 D2 — a field-rule predicate that FAULTS refuses the SUBMIT.
//
// "At submit time, a field-rule predicate that cannot be evaluated refuses the
// write and names the field and the rule. Nothing is persisted." The server
// half of that decision lands here, on the two arms ADR-0137's own Context
// measured as fail-open:
//
//  - `requiredWhen` — the block logged and `continue`d, so a record saved with
//    the field empty;
//  - `readonlyWhen` — every fault but the unbound-root one logged `change
//    allowed through`, so a field the author declared frozen was written.
//
// Driven end-to-end through the real engine and a real (in-memory) driver, so
// "nothing is persisted" is read off the store rather than inferred from a
// throw (PD #10: check the CALL SITE, bulk path included). The two CONTROL
// blocks pin what must NOT move: a predicate that evaluates behaves exactly as
// before in both directions, and option `visibleWhen` — which D2 does not
// reach — stays fail-open.

import { describe, it, expect, beforeEach } from 'vitest';
import { validationFailureDetails } from '@objectstack/types';
import { ObjectQL } from './engine.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const checkOp = (value: any, cond: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) {
      return value === cond;
    }
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$in': return Array.isArray(target) && target.includes(value);
        default: return true;
      }
    });
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k === '$not') return !matches(row, v);
      return checkOp(row?.[k], v);
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      let count = 0;
      for (const row of [...s.values()]) {
        if (!matches(row, ast?.where)) continue;
        s.set(row.id, { ...row, ...data, id: row.id });
        count += 1;
      }
      return count;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

/** The error a write threw, or a failure saying it was accepted. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  let thrown: unknown;
  let threw = false;
  try {
    await run();
  } catch (err) {
    threw = true;
    thrown = err;
  }
  expect(threw).toBe(true);
  return thrown as any;
}

/**
 * The D2 envelope, asserted as a whole: the error is the engine's
 * `ValidationError` (`VALIDATION_FAILED`, which the HTTP boundary serves as a
 * 400 through `validationFailureDetails`), and it carries ONE field entry that
 * names the field and the rule — `code: 'rule_violation'`, the envelope a broken
 * validation rule has carried since #4649, with the SLOT as `constraint.rule`.
 */
function expectFieldRuleRefusal(err: any, field: string, slot: 'requiredWhen' | 'readonlyWhen') {
  expect(err.name).toBe('ValidationError');
  expect(err.code).toBe('VALIDATION_FAILED');
  expect(validationFailureDetails(err)).toMatchObject({ code: 'VALIDATION_FAILED' });
  const entry = (err.fields as any[]).find((f) => f.field === field);
  expect(entry).toMatchObject({
    field,
    code: 'rule_violation',
    constraint: expect.objectContaining({ rule: slot, reason: 'unevaluable' }),
  });
  // Names the field and the rule, in the prose too.
  expect(entry.message).toContain(`'${field}'`);
  expect(entry.message).toContain(slot);
  return entry;
}

describe('ADR-0137 D2 — a faulting field-rule predicate refuses the submit (server half)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'fp_account',
      fields: { name: { type: 'text' }, tier: { type: 'text' } },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'fp_ticket',
      fields: {
        status: { type: 'text' },
        // An author typo — `statsu` is declared nowhere. The rule can never run.
        resolution: { type: 'text', requiredWhen: "record.statsu == 'closed'" },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'fp_order',
      fields: {
        account: { type: 'lookup', reference: 'fp_account' },
        // Reads THROUGH a lookup. The field level never hydrates the related
        // record (only a validation rule's condition does), so `account` holds a
        // bare id here and the predicate faults on every write that reaches it.
        po_number: { type: 'text', requiredWhen: "record.account.tier == 'enterprise'" },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'fp_invoice',
      fields: {
        status: { type: 'text' },
        // The typo, on a lock.
        amount: { type: 'number', readonlyWhen: "record.statsu == 'paid'" },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'fp_batch',
      fields: {
        cap: { type: 'number' },
        // Evaluates on a row that has a `cap`; faults (`null > int`) on one that does not.
        amount: { type: 'number', readonlyWhen: 'record.cap > 100' },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'fp_control',
      fields: {
        status: { type: 'text' },
        reason: { type: 'text', requiredWhen: "record.status == 'closed'" },
        amount: { type: 'number', readonlyWhen: "record.status == 'paid'" },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'fp_option',
      fields: {
        tier: {
          type: 'select',
          options: [{ value: 'basic' }, { value: 'gold', visibleWhen: "record.statsu == 'vip'" }],
        },
      },
    } as any, 'test-package');
    storeFor('fp_account').set('acc_1', { id: 'acc_1', name: 'Acme', tier: 'enterprise' });
  });

  const rows = (object: string) => [...storeFor(object).values()];

  // ── (a) requiredWhen ──────────────────────────────────────────────────────

  describe('(a) a `requiredWhen` whose predicate faults', () => {
    it('refuses an INSERT, naming the field and the rule — and nothing is stored', async () => {
      const err = await refusalOf(() => engine.insert('fp_ticket', { status: 'closed' }));
      const entry = expectFieldRuleRefusal(err, 'resolution', 'requiredWhen');
      // The fault itself travels machine-readably, as a broken validation rule's does.
      expect(entry.constraint).toMatchObject({ missingKey: 'statsu' });
      expect(rows('fp_ticket')).toHaveLength(0);
    });

    it('refuses an UPDATE — and the stored row is untouched', async () => {
      storeFor('fp_ticket').set('t1', { id: 't1', status: 'open', resolution: 'n/a' });
      const err = await refusalOf(() => engine.update('fp_ticket', { id: 't1', status: 'closed', resolution: '' }));
      expectFieldRuleRefusal(err, 'resolution', 'requiredWhen');
      expect(storeFor('fp_ticket').get('t1')).toEqual({ id: 't1', status: 'open', resolution: 'n/a' });
    });

    it('refuses the submit even when the write supplies the field — a value is not a verdict', async () => {
      // D2 refuses the SUBMIT. The rule could not run, so whether this field
      // was required is unknown; a supplied value does not supply that answer.
      const err = await refusalOf(() => engine.insert('fp_ticket', { status: 'closed', resolution: 'fixed' }));
      expectFieldRuleRefusal(err, 'resolution', 'requiredWhen');
      expect(rows('fp_ticket')).toHaveLength(0);
    });

    it('refuses a predicate that reads THROUGH a lookup, and says why instead of "declare the field"', async () => {
      const err = await refusalOf(() => engine.insert('fp_order', { account: 'acc_1' }));
      const entry = expectFieldRuleRefusal(err, 'po_number', 'requiredWhen');
      // The generic sentence would tell the author to declare `tier` on
      // `fp_order` — the wrong object. The refusal names the reference instead.
      expect(entry.message).toContain("through 'account', a reference to 'fp_account'");
      expect(entry.message).not.toContain('which this object does not declare');
      expect(entry.constraint).not.toHaveProperty('missingKey');
      expect(rows('fp_order')).toHaveLength(0);
    });

    it('refuses on the BULK path too, before any matched row is written', async () => {
      storeFor('fp_ticket').set('b1', { id: 'b1', status: 'open', resolution: 'a' });
      storeFor('fp_ticket').set('b2', { id: 'b2', status: 'open', resolution: 'b' });
      const err = await refusalOf(() =>
        engine.update('fp_ticket', { status: 'closed' }, { where: { status: 'open' }, multi: true } as any));
      expectFieldRuleRefusal(err, 'resolution', 'requiredWhen');
      expect(rows('fp_ticket').map((r) => r.status)).toEqual(['open', 'open']);
    });
  });

  // ── (b) readonlyWhen ──────────────────────────────────────────────────────

  describe('(b) a `readonlyWhen` whose predicate faults on a non-root key', () => {
    it('refuses the UPDATE — the value is neither written nor silently dropped', async () => {
      storeFor('fp_invoice').set('i1', { id: 'i1', status: 'paid', amount: 100 });
      const err = await refusalOf(() => engine.update('fp_invoice', { id: 'i1', amount: 999 }));
      const entry = expectFieldRuleRefusal(err, 'amount', 'readonlyWhen');
      expect(entry.constraint).toMatchObject({ missingKey: 'statsu' });
      expect(storeFor('fp_invoice').get('i1')).toEqual({ id: 'i1', status: 'paid', amount: 100 });
    });

    it('refuses a BULK update when ANY matched row faults, naming that row', async () => {
      // `bad` faults (no cap ⇒ `null > int`) and arrives FIRST; `ok` evaluates
      // (cap 500 ⇒ locked).
      storeFor('fp_batch').set('bad', { id: 'bad', cap: null, amount: 1 });
      storeFor('fp_batch').set('ok', { id: 'ok', cap: 500, amount: 1 });
      expect(rows('fp_batch').map((r) => r.id)).toEqual(['bad', 'ok']);
      const err = await refusalOf(() =>
        engine.update('fp_batch', { amount: 9 }, { where: { amount: 1 }, multi: true } as any));
      const entry = expectFieldRuleRefusal(err, 'amount', 'readonlyWhen');
      expect(entry.message).toContain('(record bad)');
      expect(rows('fp_batch').map((r) => r.amount)).toEqual([1, 1]);
    });

    it('refuses whatever order the matched rows arrive in — a locking row ahead does not hide the fault', async () => {
      // The same two rows, the LOCKING one first. Judging rows only until the
      // first that locks would drop `amount` for the batch and never read `bad`.
      storeFor('fp_batch').set('ok', { id: 'ok', cap: 500, amount: 1 });
      storeFor('fp_batch').set('bad', { id: 'bad', cap: null, amount: 1 });
      expect(rows('fp_batch').map((r) => r.id)).toEqual(['ok', 'bad']);
      const err = await refusalOf(() =>
        engine.update('fp_batch', { amount: 9 }, { where: { amount: 1 }, multi: true } as any));
      expectFieldRuleRefusal(err, 'amount', 'readonlyWhen');
      expect(rows('fp_batch').map((r) => r.amount)).toEqual([1, 1]);
    });
  });

  // ── (c) CONTROL: a predicate that evaluates behaves exactly as before ─────

  describe('(c) CONTROL — an evaluable predicate is judged exactly as before, both directions', () => {
    it('requiredWhen TRUE and the field empty ⇒ refused as `required`, not as a fault', async () => {
      const err = await refusalOf(() => engine.insert('fp_control', { status: 'closed' }));
      expect(err.name).toBe('ValidationError');
      expect(err.fields).toContainEqual(expect.objectContaining({ field: 'reason', code: 'required' }));
      expect((err.fields as any[]).some((f) => f.code === 'rule_violation')).toBe(false);
      expect(rows('fp_control')).toHaveLength(0);
    });

    it('requiredWhen FALSE ⇒ accepted with the field empty', async () => {
      const row = await engine.insert('fp_control', { status: 'open' });
      expect(row).toMatchObject({ status: 'open' });
      expect(rows('fp_control')).toHaveLength(1);
    });

    it('readonlyWhen TRUE ⇒ the change is dropped and the write lands (no refusal)', async () => {
      storeFor('fp_control').set('c1', { id: 'c1', status: 'paid', reason: 'r', amount: 100 });
      await engine.update('fp_control', { id: 'c1', amount: 999 });
      expect(storeFor('fp_control').get('c1')).toMatchObject({ amount: 100 });
    });

    it('readonlyWhen FALSE ⇒ the change is written', async () => {
      storeFor('fp_control').set('c2', { id: 'c2', status: 'open', reason: 'r', amount: 100 });
      await engine.update('fp_control', { id: 'c2', amount: 999 });
      expect(storeFor('fp_control').get('c2')).toMatchObject({ amount: 999 });
    });
  });

  // ── (d) CONTROL: option `visibleWhen` is outside D2 ───────────────────────

  describe('(d) CONTROL — option `visibleWhen` is not a field-rule predicate, and stays fail-open', () => {
    it('a faulting option predicate still lets the choice through', async () => {
      const row = await engine.insert('fp_option', { tier: 'gold' });
      expect(row).toMatchObject({ tier: 'gold' });
      expect(rows('fp_option')).toHaveLength(1);
    });
  });
});
