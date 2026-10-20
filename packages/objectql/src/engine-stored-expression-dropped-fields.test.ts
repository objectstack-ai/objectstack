// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #24690 — a caller's value for a STORED field that declares `expression` is
// overwritten by the computed value (#24619 item a), and the write now REPORTS
// that through `onFieldsDropped` under its own reason, `stored_expression`.
//
// Before: the engine overwrote the value and said nothing — `onFieldsDropped`
// stayed silent, so the `/batch` and PATCH doors' `droppedFields` did too,
// while the stored row held a value the caller never sent. No existing reason
// fit: `computed` is a `formula` field with no column, whose key is DROPPED;
// this field is written, with the engine's value in the caller's place.
//
// What this file pins, over a real-shaped driver (the showcase's invoice line,
// trimmed to what the computation needs):
//  - a caller value the engine REPLACED is reported once, under
//    `stored_expression`, on every write path: insert (single, batch,
//    `insertMany` with its per-row `droppedFields`), update by id, and the
//    predicate update — in every context, `isSystem` included;
//  - a caller value EQUAL to the computed one is not reported (the console
//    grid's consistent save stays silent), nor is a key the caller never sent;
//  - a caller value another strip already took is reported once, under that
//    strip's reason, never twice;
//  - `strictReadonlyWrites` refuses a replaced value, writing nothing — its
//    coverage is derived from what `onFieldsDropped` reports.

import { describe, it, expect, beforeEach } from 'vitest';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { ReadonlyFieldRejectedError } from './readonly-strict-errors.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        if ('$eq' in v) return row?.[k] === v.$eq;
        if ('$in' in v) return Array.isArray(v.$in) && v.$in.includes(row?.[k]);
        return true;
      }
      return row?.[k] === v;
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

const LINE = 'showcase_invoice_line';
const AMOUNT: DroppedFieldsEvent = { object: LINE, fields: ['amount'], reason: 'stored_expression' };

function listener() {
  const events: DroppedFieldsEvent[] = [];
  return { events, onFieldsDropped: (e: DroppedFieldsEvent) => { events.push(e); } };
}

describe('[#24690] a caller value a stored expression replaced is reported as `stored_expression`', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  const line = (id: string) => storeFor(LINE).get(id);

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'showcase_invoice',
      fields: { status: { type: 'select', options: [{ value: 'draft' }, { value: 'paid' }] } },
    } as any);
    engine.registry.registerObject({
      name: LINE,
      fields: {
        invoice: { type: 'master_detail', reference: 'showcase_invoice', required: true },
        quantity: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
        unit_price: { type: 'currency', readonlyWhen: "parent.status == 'paid'" },
        description: { type: 'text' },
        amount: { type: 'currency', min: 0, expression: { dialect: 'cel', source: 'record.quantity * record.unit_price' } },
      },
    } as any);
    // A stored expression field that is ALSO `readonly`: the caller's value is
    // the static strip's, reported once as `readonly`.
    engine.registry.registerObject({
      name: 'qa_locked_line',
      fields: {
        quantity: { type: 'number' },
        unit_price: { type: 'currency' },
        amount: { type: 'currency', readonly: true, expression: { dialect: 'cel', source: 'record.quantity * record.unit_price' } },
      },
    } as any);
    storeFor('showcase_invoice').set('INV-1003', { id: 'INV-1003', status: 'paid' });
    storeFor('showcase_invoice').set('INV-1004', { id: 'INV-1004', status: 'draft' });
    storeFor(LINE).set('line_paid', { id: 'line_paid', invoice: 'INV-1003', quantity: 6, unit_price: 49.99, amount: 299.94 });
    storeFor(LINE).set('line_draft', { id: 'line_draft', invoice: 'INV-1004', quantity: 3, unit_price: 10, amount: 30 });
    storeFor(LINE).set('line_draft_2', { id: 'line_draft_2', invoice: 'INV-1004', quantity: 2, unit_price: 7, amount: 14 });
    storeFor('qa_locked_line').set('ll_1', { id: 'll_1', quantity: 3, unit_price: 10, amount: 30 });
  });

  describe('update by id — the PATCH door and every by-id `/batch` op', () => {
    it('the card\'s /batch write on the PAID line: quantity is `readonly_when`, amount is `stored_expression`', async () => {
      const l = listener();
      await engine.update(LINE, { id: 'line_paid', quantity: 60, amount: 2999.4 }, { onFieldsDropped: l.onFieldsDropped });
      expect(line('line_paid')).toMatchObject({ quantity: 6, amount: 299.94 });
      expect(l.events).toEqual([
        { object: LINE, fields: ['quantity'], reason: 'readonly_when' },
        AMOUNT,
      ]);
    });

    it('a PATCH of amount alone: the stored value is computed, and the replacement is reported', async () => {
      const l = listener();
      await engine.update(LINE, { id: 'line_paid', amount: 1 }, { onFieldsDropped: l.onFieldsDropped });
      expect(line('line_paid').amount).toBe(299.94);
      expect(l.events).toEqual([AMOUNT]);
    });

    it('isSystem: the value is replaced in every context, so it is reported there too', async () => {
      const l = listener();
      await engine.update(LINE, { id: 'line_draft', quantity: 4, amount: 5 }, { context: { isSystem: true }, onFieldsDropped: l.onFieldsDropped } as any);
      expect(line('line_draft').amount).toBe(40);
      expect(l.events).toEqual([AMOUNT]);
    });

    it('control: the grid\'s consistent save (amount equals the computed value) reports nothing', async () => {
      const l = listener();
      await engine.update(LINE, { id: 'line_draft', quantity: 5, unit_price: 20, amount: 100 }, { onFieldsDropped: l.onFieldsDropped });
      expect(line('line_draft').amount).toBe(100);
      expect(l.events).toEqual([]);
    });

    it('control: an amount the caller never sent is recomputed, and nothing is reported', async () => {
      const l = listener();
      await engine.update(LINE, { id: 'line_draft', quantity: 7 }, { onFieldsDropped: l.onFieldsDropped });
      expect(line('line_draft').amount).toBe(70);
      expect(l.events).toEqual([]);
    });

    it('a value the static `readonly` strip took is reported ONCE, as `readonly` — never also as `stored_expression`', async () => {
      const l = listener();
      await engine.update('qa_locked_line', { id: 'll_1', quantity: 4, amount: 5 }, { onFieldsDropped: l.onFieldsDropped });
      expect(storeFor('qa_locked_line').get('ll_1')).toMatchObject({ quantity: 4, amount: 40 });
      expect(l.events).toEqual([{ object: 'qa_locked_line', fields: ['amount'], reason: 'readonly' }]);
    });
  });

  describe('insert', () => {
    it('single row: a wrong amount is replaced and reported; the right amount and none are not', async () => {
      const wrong = listener();
      const right = listener();
      const none = listener();
      await engine.insert(LINE, { invoice: 'INV-1004', quantity: 2, unit_price: 10, amount: 999 }, { onFieldsDropped: wrong.onFieldsDropped });
      await engine.insert(LINE, { invoice: 'INV-1004', quantity: 2, unit_price: 10, amount: 20 }, { onFieldsDropped: right.onFieldsDropped });
      await engine.insert(LINE, { invoice: 'INV-1004', quantity: 2, unit_price: 10 }, { onFieldsDropped: none.onFieldsDropped });
      expect(wrong.events).toEqual([AMOUNT]);
      expect(right.events).toEqual([]);
      expect(none.events).toEqual([]);
    });

    it('batch: the union is reported once', async () => {
      const l = listener();
      await engine.insert(LINE, [
        { invoice: 'INV-1004', quantity: 1, unit_price: 3, amount: 0 },
        { invoice: 'INV-1004', quantity: 4, unit_price: 3, amount: 12 },
        { invoice: 'INV-1004', quantity: 5, unit_price: 3, amount: 1 },
      ], { onFieldsDropped: l.onFieldsDropped });
      expect(l.events).toEqual([AMOUNT]);
    });

    it('insertMany: only the row whose value was replaced carries the per-row `droppedFields`', async () => {
      const l = listener();
      const outcomes: any[] = await engine.insertMany(LINE, [
        { invoice: 'INV-1004', quantity: 1, unit_price: 3, amount: 0 },
        { invoice: 'INV-1004', quantity: 4, unit_price: 3, amount: 12 },
      ], { onFieldsDropped: l.onFieldsDropped });
      expect(outcomes.map((o) => o.ok)).toEqual([true, true]);
      expect(outcomes[0].droppedFields).toEqual([AMOUNT]);
      expect(outcomes[1]).not.toHaveProperty('droppedFields');
      expect(l.events).toEqual([AMOUNT]);
    });
  });

  describe('a predicate update (`multi: true`)', () => {
    it('a patch that stores one computed value on every row reports the caller\'s different value', async () => {
      const l = listener();
      await engine.update(LINE, { quantity: 2, unit_price: 5, amount: 1 }, { where: { invoice: 'INV-1004' }, multi: true, onFieldsDropped: l.onFieldsDropped } as any);
      expect([line('line_draft').amount, line('line_draft_2').amount]).toEqual([10, 10]);
      expect(l.events).toEqual([AMOUNT]);
    });

    it('a patch that moves no input leaves the column alone and reports the caller\'s value', async () => {
      const l = listener();
      await engine.update(LINE, { description: 'bulk', amount: 1 }, { where: { invoice: 'INV-1004' }, multi: true, onFieldsDropped: l.onFieldsDropped } as any);
      expect([line('line_draft').amount, line('line_draft_2').amount]).toEqual([30, 14]);
      expect(l.events).toEqual([AMOUNT]);
    });

    it('control: a caller value equal to what every row stores reports nothing', async () => {
      const l = listener();
      await engine.update(LINE, { quantity: 2, unit_price: 5, amount: 10 }, { where: { invoice: 'INV-1004' }, multi: true, onFieldsDropped: l.onFieldsDropped } as any);
      expect(l.events).toEqual([]);
    });
  });

  describe('strictReadonlyWrites — coverage derived from the reported set refuses a replaced value', () => {
    it('update by id: ERR_READONLY_FIELD_REJECTED carrying the `stored_expression` drop, nothing written', async () => {
      const err: any = await engine
        .update(LINE, { id: 'line_draft', quantity: 4, amount: 5 }, { strictReadonlyWrites: true } as any)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ReadonlyFieldRejectedError);
      expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
      expect(err.drops).toEqual([AMOUNT]);
      expect(line('line_draft')).toMatchObject({ quantity: 3, amount: 30 });
    });

    it('insert: refused the same way, before the driver', async () => {
      const err: any = await engine
        .insert(LINE, { invoice: 'INV-1004', quantity: 2, unit_price: 10, amount: 999 }, { strictReadonlyWrites: true })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ReadonlyFieldRejectedError);
      expect(err.drops).toEqual([AMOUNT]);
      expect([...storeFor(LINE).values()]).toHaveLength(3);
    });

    it('predicate update: refused before any row is written', async () => {
      const err: any = await engine
        .update(LINE, { quantity: 2, unit_price: 5, amount: 1 }, { where: { invoice: 'INV-1004' }, multi: true, strictReadonlyWrites: true } as any)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ReadonlyFieldRejectedError);
      expect(err.drops).toEqual([AMOUNT]);
      expect([line('line_draft').amount, line('line_draft_2').amount]).toEqual([30, 14]);
    });

    it('control: a consistent value is not refused — nothing was replaced', async () => {
      await engine.update(LINE, { id: 'line_draft', quantity: 5, unit_price: 20, amount: 100 }, { strictReadonlyWrites: true } as any);
      expect(line('line_draft')).toMatchObject({ quantity: 5, amount: 100 });
    });
  });
});
