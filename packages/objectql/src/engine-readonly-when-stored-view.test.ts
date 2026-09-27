// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19887 — a `readonlyWhen` predicate's `record` is the payload the write
// STORES.
//
// On UPDATE the conditional strip runs before the static `readonly` strip. It
// used to build `record` from the payload it was handed, which still held a
// value a non-system caller forged for a statically `readonly` field. The lock
// was judged against that forged value, the static strip then removed it, and
// the row committed with its stored state AND its locked field rewritten:
// `amount` locked by `record.status == 'closed'`, `status` read-only, and
// `update(t1, { status: 'open', amount: 999 })` stored
// `{ status: 'closed', amount: 999 }`. The same through a read-only
// master-detail FK read by a `record`-scoped lock.
//
// The fix hands the strip the payload the static strip leaves
// (`staticReadonlyStoredView`, the same `stripReadonlyFields` verdict #19853's
// `staticReadonlyStripTakes` asks for one key). The strips keep their order,
// so each still reports its own fields under its own reason. Every exemption
// the static strip grants — a system caller, `preserveAudit`, a hook write —
// keeps the value in the stored payload, so the predicate reads it exactly as
// before. The #19853 suite (`engine-readonly-when-parent.test.ts`) is the
// `parent`-root sibling and is unchanged by this one.
//
// Real engine, the suite's in-memory driver shape; by-id and bulk.

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

describe('a record-scoped readonlyWhen reads the payload the write STORES (#19887)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    // Shape 1 of the card: a closed ticket's amount is frozen, and nobody
    // outside the server reopens it.
    engine.registry.registerObject({
      name: 'ticket',
      fields: {
        status: { type: 'text', readonly: true },
        amount: { type: 'number', readonlyWhen: "record.status == 'closed'" },
        note: { type: 'text' },
      },
    } as any);
    // Shape 2: the same lock read through a read-only master-detail FK.
    engine.registry.registerObject({ name: 'inv', fields: { status: { type: 'text' } } } as any);
    engine.registry.registerObject({
      name: 'inv_row',
      fields: {
        invoice: { type: 'master_detail', reference: 'inv', readonly: true },
        amount: { type: 'number', readonlyWhen: "record.invoice == 'inv_a'" },
        note: { type: 'text' },
      },
    } as any);
    // A field carrying BOTH locks, its own predicate reading itself.
    engine.registry.registerObject({
      name: 'ticket_both',
      fields: {
        status: { type: 'text', readonly: true, readonlyWhen: "record.status == 'closed'" },
        amount: { type: 'number', readonlyWhen: "record.status == 'closed'" },
      },
    } as any);
    // #19853's settlement: the FK's OWN record-scoped lock reads a static
    // read-only field, and the amount's lock reads `parent`.
    engine.registry.registerObject({
      name: 'inv_row_staged',
      fields: {
        stage: { type: 'text', readonly: true },
        invoice: { type: 'master_detail', reference: 'inv', readonlyWhen: "record.stage == 'submitted'" },
        amount: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
        tag: { type: 'text' },
      },
    } as any);
    // `requiredWhen` runs on the stripped payload, so it answers for the
    // amount the row keeps — in both directions.
    engine.registry.registerObject({
      name: 'ticket_big_note',
      fields: {
        status: { type: 'text', readonly: true },
        amount: { type: 'number', readonlyWhen: "record.status == 'closed'" },
        note: { type: 'text', requiredWhen: 'record.amount > 500' },
      },
    } as any);
    engine.registry.registerObject({
      name: 'ticket_small_note',
      fields: {
        status: { type: 'text', readonly: true },
        amount: { type: 'number', readonlyWhen: "record.status == 'closed'" },
        note: { type: 'text', requiredWhen: 'record.amount < 500' },
      },
    } as any);

    storeFor('ticket').set('t1', { id: 't1', status: 'closed', amount: 100, note: 'closed' });
    storeFor('ticket').set('t2', { id: 't2', status: 'closed', amount: 100, note: 'closed' });
    storeFor('ticket').set('t3', { id: 't3', status: 'open', amount: 100, note: 'open' });
    storeFor('inv').set('inv_a', { id: 'inv_a', status: 'paid' });
    storeFor('inv').set('inv_b', { id: 'inv_b', status: 'open' });
    storeFor('inv_row').set('r1', { id: 'r1', invoice: 'inv_a', amount: 100, note: 'a' });
    storeFor('ticket_both').set('b1', { id: 'b1', status: 'closed', amount: 100 });
    storeFor('inv_row_staged').set('s1', { id: 's1', stage: 'submitted', invoice: 'inv_a', amount: 100, tag: 'x' });
    storeFor('ticket_big_note').set('g1', { id: 'g1', status: 'closed', amount: 100, note: null });
    storeFor('ticket_small_note').set('m1', { id: 'm1', status: 'closed', amount: 100, note: 'kept' });
  });

  const row = (object: string, id: string) => storeFor(object).get(id);

  async function rejection(p: Promise<unknown>): Promise<any> {
    try {
      await p;
    } catch (err) {
      return err;
    }
    throw new Error('expected the write to be refused, but it resolved');
  }

  // ── The card, both shapes ─────────────────────────────────────────────

  it('THE CARD: a forged status beside the amount no longer unlocks a closed ticket', async () => {
    await engine.update('ticket', { id: 't1', status: 'open', amount: 999 });
    expect(row('ticket', 't1')).toMatchObject({ status: 'closed', amount: 100 });
  });

  it('CONTROL: the same lock without the forged status, unchanged', async () => {
    await engine.update('ticket', { id: 't1', amount: 555 });
    expect(row('ticket', 't1')).toMatchObject({ status: 'closed', amount: 100 });
  });

  it('THE CARD through the FK: naming another invoice beside a read-only FK no longer unlocks the row', async () => {
    await engine.update('inv_row', { id: 'r1', invoice: 'inv_b', amount: 999 });
    expect(row('inv_row', 'r1')).toMatchObject({ invoice: 'inv_a', amount: 100 });
  });

  it('CONTROL through the FK: the same lock without the repoint, unchanged', async () => {
    await engine.update('inv_row', { id: 'r1', amount: 555 });
    expect(row('inv_row', 'r1')).toMatchObject({ invoice: 'inv_a', amount: 100 });
  });

  it('REVERSE: forging `closed` on an open ticket no longer locks its amount', async () => {
    // The over-lock twin: the row stays open, so its amount is writable.
    await engine.update('ticket', { id: 't3', status: 'closed', amount: 999 });
    expect(row('ticket', 't3')).toMatchObject({ status: 'open', amount: 999 });
  });

  // ── What each strip reports ──────────────────────────────────────────

  it('reports both strips, each under its own reason, in the order they run', async () => {
    const events: any[] = [];
    await engine.update(
      'ticket',
      { id: 't1', status: 'open', amount: 999 },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events).toEqual([
      { object: 'ticket', fields: ['amount'], reason: 'readonly_when' },
      { object: 'ticket', fields: ['status'], reason: 'readonly' },
    ]);
  });

  it('under strictReadonlyWrites the write is still refused, now naming BOTH fields, and nothing lands', async () => {
    const err = await rejection(engine.update(
      'ticket',
      { id: 't1', status: 'open', amount: 999, note: 'edited' },
      { strictReadonlyWrites: true } as any,
    ));
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.name).toBe('ReadonlyFieldRejectedError');
    expect(err.fields).toEqual(['amount', 'status']);
    expect(err.drops).toEqual([
      { object: 'ticket', fields: ['amount'], reason: 'readonly_when' },
      { object: 'ticket', fields: ['status'], reason: 'readonly' },
    ]);
    expect(row('ticket', 't1')).toMatchObject({ status: 'closed', amount: 100, note: 'closed' });
  });

  it('a field carrying BOTH locks is judged against its stored value, so the conditional strip takes it', async () => {
    // Measured movement: its own predicate used to read the forged `open`,
    // so the static strip took it (`readonly`); it now reads the stored
    // `closed`. The row is the same either way — only the reason moves.
    const events: any[] = [];
    await engine.update(
      'ticket_both',
      { id: 'b1', status: 'open', amount: 999 },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(row('ticket_both', 'b1')).toMatchObject({ status: 'closed', amount: 100 });
    expect(events).toEqual([{ object: 'ticket_both', fields: ['amount', 'status'], reason: 'readonly_when' }]);
  });

  // ── The static strip's exemptions: the value is stored, so it is read ──

  it('isSystem: the static strip does not run, the status lands, and the lock reads it', async () => {
    await engine.update(
      'ticket',
      { id: 't1', status: 'open', amount: 999 },
      { context: { isSystem: true } } as any,
    );
    expect(row('ticket', 't1')).toMatchObject({ status: 'open', amount: 999 });
  });

  it('preserveAudit: the static strip keeps the status, so the lock reads it', async () => {
    await engine.update(
      'ticket',
      { id: 't1', status: 'open', amount: 999 },
      { context: { preserveAudit: true } } as any,
    );
    expect(row('ticket', 't1')).toMatchObject({ status: 'open', amount: 999 });
  });

  it('a hook-written status lands, so the lock reads it', async () => {
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      if ('amount' in ctx.input.data) ctx.input.data.status = 'open';
    }, { object: 'ticket', priority: 50 });
    await engine.update('ticket', { id: 't1', amount: 999 });
    expect(row('ticket', 't1')).toMatchObject({ status: 'open', amount: 999 });
  });

  it('a hook overwriting a forged status lands, so the lock reads the hook\'s value', async () => {
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data.status = 'open';
    }, { object: 'ticket', priority: 50 });
    await engine.update('ticket', { id: 't1', status: 'forged', amount: 999 });
    expect(row('ticket', 't1')).toMatchObject({ status: 'open', amount: 999 });
  });

  // ── #19853's settlement composes ──────────────────────────────────────

  it('the FK\'s own record-scoped lock reads the stored stage: the row stays home and the amount is judged there', async () => {
    const events: any[] = [];
    await engine.update(
      'inv_row_staged',
      { id: 's1', stage: 'draft', invoice: 'inv_b', amount: 999 },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(row('inv_row_staged', 's1')).toMatchObject({ stage: 'submitted', invoice: 'inv_a', amount: 100 });
    expect(events).toEqual([
      { object: 'inv_row_staged', fields: ['invoice', 'amount'], reason: 'readonly_when' },
      { object: 'inv_row_staged', fields: ['stage'], reason: 'readonly' },
    ]);
  });

  // ── Bulk, per matched row ─────────────────────────────────────────────

  it('BULK: a forged status does not unlock the matched closed tickets', async () => {
    await engine.update(
      'ticket',
      { status: 'open', amount: 999 },
      { where: { note: 'closed' }, multi: true } as any,
    );
    expect(row('ticket', 't1')).toMatchObject({ status: 'closed', amount: 100 });
    expect(row('ticket', 't2')).toMatchObject({ status: 'closed', amount: 100 });
  });

  it('BULK through the FK: a stripped repoint does not unlock the matched rows', async () => {
    await engine.update(
      'inv_row',
      { invoice: 'inv_b', amount: 999 },
      { where: { note: 'a' }, multi: true } as any,
    );
    expect(row('inv_row', 'r1')).toMatchObject({ invoice: 'inv_a', amount: 100 });
  });

  it('BULK with the settlement: the FK\'s own lock reads the stored stage in every matched row', async () => {
    await engine.update(
      'inv_row_staged',
      { stage: 'draft', invoice: 'inv_b', amount: 999 },
      { where: { tag: 'x' }, multi: true } as any,
    );
    expect(row('inv_row_staged', 's1')).toMatchObject({ stage: 'submitted', invoice: 'inv_a', amount: 100 });
  });

  // ── requiredWhen answers for the amount the row keeps ─────────────────

  it('requiredWhen: a requirement the forged-through amount raised no longer refuses the write', async () => {
    await engine.update('ticket_big_note', { id: 'g1', status: 'open', amount: 999 });
    expect(row('ticket_big_note', 'g1')).toMatchObject({ status: 'closed', amount: 100, note: null });
  });

  it('requiredWhen: clearing a field the kept amount requires is now refused', async () => {
    const err = await rejection(engine.update('ticket_small_note', { id: 'm1', status: 'open', amount: 999, note: null }));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toEqual([expect.objectContaining({ field: 'note', code: 'required' })]);
    expect(row('ticket_small_note', 'm1')).toMatchObject({ status: 'closed', amount: 100, note: 'kept' });
  });
});
