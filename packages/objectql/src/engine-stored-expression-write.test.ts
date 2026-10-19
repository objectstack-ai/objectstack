// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #24619 (item a) — a STORED field's declared `expression` is computed by the
// engine on every write.
//
// `showcase_invoice_line.amount` is a stored `currency` column declaring
// `expression: record.quantity * record.unit_price`, kept stored so the header's
// `total` summary can roll it up. The engine evaluated `expression` for
// `type: 'formula'` fields only, so the client-sent `amount` was stored as-is:
// on the PAID invoice INV-1003, whose line inputs are frozen by
// `readonlyWhen: parent.status == 'paid'`, a `/batch` update carrying
// `{quantity, amount}` had `quantity` dropped and `amount` stored, and a plain
// PATCH of `amount` alone was accepted — either one moved the paid invoice's
// `total`. Now the stored value is the expression over the row the write
// stores (the stored row merged with the patch, after the hooks and both
// read-only strips), and a client-sent value never stands.
//
// The suite drives the real engine over a real-shaped driver, the showcase's
// shape trimmed to what the computation needs.

import { describe, it, expect, beforeEach } from 'vitest';
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
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
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

describe('a stored field\'s declared expression is computed on write (#24619)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'showcase_invoice',
      fields: {
        status: { type: 'select', options: [{ value: 'draft' }, { value: 'paid' }] },
      },
    } as any);
    engine.registry.registerObject({
      name: 'showcase_invoice_line',
      fields: {
        invoice: { type: 'master_detail', reference: 'showcase_invoice', required: true },
        quantity: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
        unit_price: { type: 'currency', readonlyWhen: "parent.status == 'paid'" },
        description: { type: 'text' },
        // invoice.object.ts: stored, no `readonlyWhen` of its own.
        amount: { type: 'currency', min: 0, expression: { dialect: 'cel', source: 'record.quantity * record.unit_price' } },
      },
    } as any);
    storeFor('showcase_invoice').set('INV-1003', { id: 'INV-1003', status: 'paid' });
    storeFor('showcase_invoice').set('INV-1004', { id: 'INV-1004', status: 'draft' });
    storeFor('showcase_invoice_line').set('line_paid', { id: 'line_paid', invoice: 'INV-1003', quantity: 6, unit_price: 49.99, amount: 299.94, description: 'seat' });
    storeFor('showcase_invoice_line').set('line_draft', { id: 'line_draft', invoice: 'INV-1004', quantity: 3, unit_price: 10, amount: 30, description: 'seat' });
    storeFor('showcase_invoice_line').set('line_draft_2', { id: 'line_draft_2', invoice: 'INV-1004', quantity: 2, unit_price: 7, amount: 14, description: 'other' });
  });

  const line = (id: string) => storeFor('showcase_invoice_line').get(id);
  /** The header `total` summary's input: the sum of its lines' STORED `amount`. */
  const total = (invoice: string) => [...storeFor('showcase_invoice_line').values()]
    .filter((r) => r.invoice === invoice)
    .reduce((sum, r) => sum + (r.amount ?? 0), 0);

  describe('on the paid invoice, neither of the card\'s writes moves the total', () => {
    it('the /batch update carrying quantity and amount: quantity is dropped, amount is the stored inputs\' product', async () => {
      const events: any[] = [];
      await engine.update(
        'showcase_invoice_line',
        { id: 'line_paid', quantity: 60, amount: 2999.4 },
        { onFieldsDropped: (e: any) => events.push(e) } as any,
      );
      expect(line('line_paid')).toMatchObject({ quantity: 6, unit_price: 49.99, amount: 299.94 });
      expect(total('INV-1003')).toBe(299.94);
      expect(events).toEqual([{ object: 'showcase_invoice_line', fields: ['quantity'], reason: 'readonly_when' }]);
    });

    it('the plain PATCH of amount alone stores the computed amount', async () => {
      await engine.update('showcase_invoice_line', { id: 'line_paid', amount: 1 });
      expect(line('line_paid').amount).toBe(299.94);
      expect(total('INV-1003')).toBe(299.94);
    });
  });

  describe('a draft invoice\'s line saves as before, with amount = quantity * unit_price', () => {
    it('the grid\'s save (all three, consistent) is stored as sent', async () => {
      await engine.update('showcase_invoice_line', { id: 'line_draft', quantity: 5, unit_price: 20, amount: 100 });
      expect(line('line_draft')).toMatchObject({ quantity: 5, unit_price: 20, amount: 100 });
      expect(total('INV-1004')).toBe(114);
    });

    it('update: no amount sent — computed from the stored row merged with the patch', async () => {
      await engine.update('showcase_invoice_line', { id: 'line_draft', quantity: 7 });
      expect(line('line_draft')).toMatchObject({ quantity: 7, unit_price: 10, amount: 70 });
    });

    it('update: a wrong amount sent — overwritten by the computed one', async () => {
      await engine.update('showcase_invoice_line', { id: 'line_draft', quantity: 4, amount: 5 });
      expect(line('line_draft')).toMatchObject({ quantity: 4, amount: 40 });
    });

    it('update: a patch that touches no input stores the amount the row already computes to', async () => {
      await engine.update('showcase_invoice_line', { id: 'line_draft', description: 'renamed' });
      expect(line('line_draft')).toMatchObject({ description: 'renamed', amount: 30 });
    });

    it('insert: no amount, a wrong amount and the right amount each store quantity * unit_price', async () => {
      const none = await engine.insert('showcase_invoice_line', { invoice: 'INV-1004', quantity: 2, unit_price: 10 });
      const wrong = await engine.insert('showcase_invoice_line', { invoice: 'INV-1004', quantity: 2, unit_price: 10, amount: 999 });
      const right = await engine.insert('showcase_invoice_line', { invoice: 'INV-1004', quantity: 2, unit_price: 10, amount: 20 });
      for (const r of [none, wrong, right]) expect(line(r.id).amount).toBe(20);
    });

    it('a batch insert computes each row from its own inputs', async () => {
      const rows = await engine.insert('showcase_invoice_line', [
        { invoice: 'INV-1004', quantity: 1, unit_price: 3, amount: 0 },
        { invoice: 'INV-1004', quantity: 4, unit_price: 3 },
      ]);
      expect(rows.map((r: any) => line(r.id).amount)).toEqual([3, 12]);
    });
  });

  describe('the hooks see, and may change, what is stored', () => {
    it('a beforeUpdate hook is handed the computed amount, and a hook-changed input is recomputed', async () => {
      const seen: unknown[] = [];
      engine.registerHook('beforeUpdate', async (ctx: any) => {
        seen.push(ctx.input.data.amount);
        ctx.input.data.quantity = 9;
      }, { object: 'showcase_invoice_line' } as any);
      await engine.update('showcase_invoice_line', { id: 'line_draft', quantity: 5, amount: 1 });
      expect(seen).toEqual([50]);
      expect(line('line_draft')).toMatchObject({ quantity: 9, amount: 90 });
    });
  });

  describe('a predicate update', () => {
    it('stores the one computed value when it is the same on every matched row', async () => {
      await engine.update('showcase_invoice_line', { quantity: 2, unit_price: 5, amount: 1 }, { where: { invoice: 'INV-1004' }, multi: true } as any);
      expect(line('line_draft').amount).toBe(10);
      expect(line('line_draft_2').amount).toBe(10);
    });

    it('leaves the column alone when the patch moves no input, and never stores the caller\'s value', async () => {
      await engine.update('showcase_invoice_line', { description: 'bulk', amount: 1 }, { where: { invoice: 'INV-1004' }, multi: true } as any);
      expect(line('line_draft')).toMatchObject({ description: 'bulk', amount: 30 });
      expect(line('line_draft_2')).toMatchObject({ description: 'bulk', amount: 14 });
    });

    it('is refused, writing nothing, when it would compute different values on different rows', async () => {
      const err: any = await engine
        .update('showcase_invoice_line', { quantity: 10 }, { where: { invoice: 'INV-1004' }, multi: true } as any)
        .catch((e: unknown) => e);
      expect(err?.code).toBe('VALIDATION_FAILED');
      expect(err?.fields).toEqual([expect.objectContaining({ field: 'amount', code: 'invalid_value' })]);
      expect(line('line_draft')).toMatchObject({ quantity: 3, amount: 30 });
      expect(line('line_draft_2')).toMatchObject({ quantity: 2, amount: 14 });
    });
  });
});
