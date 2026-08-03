// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4889 — PARENT-scoped `readonlyWhen` is a SERVER guarantee.
//
// `readonlyWhen: parent.status == 'paid'` on `showcase_invoice_line.{quantity,
// unit_price}` reads, in the showcase's own words, "once the header invoice is
// Paid, its lines are frozen". It was enforced only in the client grid: the
// server-side strip bound `record` and `previous` and nothing else, so every
// `parent.*` predicate faulted, took the fail-OPEN branch, and the write landed
// with a 200 while the UI still drew the cell locked. ADR-0057 D10 puts
// enforcement on the SERVER and makes the client courtesy; this suite pins that
// direction end-to-end through the real engine + a real driver, not through the
// strip function in isolation (PD #10: a `case` label is not enforcement —
// check the CALL SITE).
//
// The record-scoped contrast the issue drew — `showcase_invoice.tax_rate` with
// `readonlyWhen: record.status == 'paid'`, which worked all along — is pinned in
// the same file so a future change cannot fix one by breaking the other.

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

describe('parent-scoped readonlyWhen is enforced server-side (#4889)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    // The showcase's shape, trimmed to what the lock needs
    // (`examples/app-showcase/src/data/objects/invoice.object.ts`).
    engine.registry.registerObject({
      name: 'showcase_invoice',
      fields: {
        invoice_number: { type: 'text' },
        status: { type: 'select', options: [{ value: 'draft' }, { value: 'sent' }, { value: 'paid' }] },
        // The RECORD-scoped contrast (invoice.object.ts L144).
        tax_rate: { type: 'number', readonlyWhen: "record.status == 'paid'" },
      },
    } as any);
    engine.registry.registerObject({
      name: 'showcase_invoice_line',
      fields: {
        invoice: { type: 'master_detail', reference: 'showcase_invoice', required: true },
        // PARENT-scoped (invoice.object.ts L201/L219/L225).
        product: { type: 'lookup', reference: 'showcase_product', readonlyWhen: "parent.status == 'paid'" },
        quantity: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
        unit_price: { type: 'currency', readonlyWhen: "parent.status == 'paid'" },
        // No lock at all — a line is still editable in the ways the author left open.
        description: { type: 'text' },
      },
    } as any);

    storeFor('showcase_invoice').set('INV-1003', { id: 'INV-1003', invoice_number: 'INV-1003', status: 'paid', tax_rate: 8 });
    storeFor('showcase_invoice').set('INV-1004', { id: 'INV-1004', invoice_number: 'INV-1004', status: 'draft', tax_rate: 8 });
    storeFor('showcase_invoice_line').set('line_paid', { id: 'line_paid', invoice: 'INV-1003', quantity: 6, unit_price: 49.99, description: 'seat' });
    storeFor('showcase_invoice_line').set('line_draft', { id: 'line_draft', invoice: 'INV-1004', quantity: 3, unit_price: 10, description: 'seat' });
  });

  const line = (id: string) => storeFor('showcase_invoice_line').get(id);
  const invoice = (id: string) => storeFor('showcase_invoice').get(id);

  it('THE REGRESSION: a paid invoice\'s frozen line survives the PATCH that used to rewrite it', async () => {
    // Verbatim from the issue: PATCH {"quantity":9999,"unit_price":0.01} on a
    // line of the PAID invoice INV-1003 returned 200 and PERSISTED.
    await engine.update('showcase_invoice_line', { id: 'line_paid', quantity: 9999, unit_price: 0.01 });
    expect(line('line_paid')).toMatchObject({ quantity: 6, unit_price: 49.99 });
  });

  it('reports the strip to the caller as reason `readonly_when` (#3407 observability)', async () => {
    const events: any[] = [];
    await engine.update(
      'showcase_invoice_line',
      { id: 'line_paid', quantity: 9999 },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events).toEqual([
      { object: 'showcase_invoice_line', fields: ['quantity'], reason: 'readonly_when' },
    ]);
  });

  it('leaves an unlocked field on the SAME locked row writable', async () => {
    await engine.update('showcase_invoice_line', { id: 'line_paid', quantity: 9999, description: 'renamed' });
    expect(line('line_paid')).toMatchObject({ quantity: 6, description: 'renamed' });
  });

  it('does NOT lock a line whose header is still draft (no false positives)', async () => {
    await engine.update('showcase_invoice_line', { id: 'line_draft', quantity: 42, unit_price: 12.5 });
    expect(line('line_draft')).toMatchObject({ quantity: 42, unit_price: 12.5 });
  });

  it('judges a REPOINT against the master the write lands on, not the one it leaves', async () => {
    // Moving a draft line onto the PAID invoice: the incoming `invoice` value is
    // the master whose state decides the lock.
    await engine.update('showcase_invoice_line', { id: 'line_draft', invoice: 'INV-1003', quantity: 777 });
    expect(line('line_draft')).toMatchObject({ invoice: 'INV-1003', quantity: 3 });
  });

  it('holds the field LOCKED when the header cannot be resolved (fail-CLOSED)', async () => {
    storeFor('showcase_invoice_line').set('orphan', { id: 'orphan', invoice: 'GONE', quantity: 1 });
    await engine.update('showcase_invoice_line', { id: 'orphan', quantity: 9999 });
    // An unresolvable `parent` is NOT read as "unlocked" — the declared lock is
    // not waived just because the platform could not check it.
    expect(line('orphan')).toMatchObject({ quantity: 1 });
  });

  it('enforces the lock on the BULK path too, per matched row (#3042 shape)', async () => {
    // One paid line + one draft line in the match set. `readonlyWhen` locked in
    // ≥1 matched row ⇒ the field is dropped for the whole batch.
    await engine.update('showcase_invoice_line', { quantity: 9999 }, { where: { description: 'seat' }, multi: true } as any);
    expect(line('line_paid')).toMatchObject({ quantity: 6 });
    expect(line('line_draft')).toMatchObject({ quantity: 3 });
  });

  it('leaves a bulk edit that touches only draft-header lines alone', async () => {
    await engine.update('showcase_invoice_line', { quantity: 55 }, { where: { invoice: 'INV-1004' }, multi: true } as any);
    expect(line('line_draft')).toMatchObject({ quantity: 55 });
    expect(line('line_paid')).toMatchObject({ quantity: 6 });
  });

  it('CONTRAST: the record-scoped lock on the header still works (and still only when TRUE)', async () => {
    await engine.update('showcase_invoice', { id: 'INV-1003', tax_rate: 99 });
    expect(invoice('INV-1003')).toMatchObject({ tax_rate: 8 });

    await engine.update('showcase_invoice', { id: 'INV-1004', tax_rate: 99 });
    expect(invoice('INV-1004')).toMatchObject({ tax_rate: 99 });
  });

  it('reads the header ONCE per single-id write, and not at all without a parent-scoped lock', async () => {
    const reads: string[] = [];
    const original = (engine as any).findOne.bind(engine);
    (engine as any).findOne = async (name: string, q: any, o?: any) => {
      reads.push(name);
      return original(name, q, o);
    };
    await engine.update('showcase_invoice_line', { id: 'line_paid', quantity: 9999 });
    expect(reads.filter((r) => r === 'showcase_invoice')).toHaveLength(1);

    // A payload touching no parent-scoped field pays nothing.
    reads.length = 0;
    await engine.update('showcase_invoice_line', { id: 'line_paid', description: 'note' });
    expect(reads.filter((r) => r === 'showcase_invoice')).toHaveLength(0);
  });
});
