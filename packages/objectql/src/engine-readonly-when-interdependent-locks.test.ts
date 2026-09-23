// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19911 — a value one `readonlyWhen` lock drops can no longer unlock another
// `readonlyWhen` lock in the same strip.
//
// The conditional strip judged every lock against one `record` view built
// before any lock was judged. `status` locked by `previous.status ==
// 'closed'`, `amount` by `record.status == 'closed'`: on a closed row,
// `update(c1, { status: 'open', amount: 999 })` dropped `status` but judged
// `amount` against the dropped `'open'`, and stored `{ status: 'closed',
// amount: 999 }` — the row stayed closed and its locked amount was rewritten.
// The same mechanism over-locked in reverse: a dropped value that WOULD lock
// another field locked it, though the row never took that value.
//
// The strip now settles its drops (`settleReadonlyWhenDrops`): a monotone
// fixpoint, which never opens a lock, then a release, kept only when every
// dropped key is locked and every kept key unlocked on the row the write
// stores. Since #19927 the release repeats until a set gives back itself
// (`engine-readonly-when-exact-drop-set.test.ts`); when none does — a cycle
// with no such set — the fixpoint's larger, fail-safe drop set stands. Every
// expected row below was checked against a brute-force enumeration of the
// drop sets that agree with the row.
//
// #19887's `stored` view (`engine-readonly-when-stored-view.test.ts`) and
// #19853's master-detail settlement (`engine-readonly-when-parent.test.ts`)
// compose with this; their suites are unchanged.
//
// Real engine, the #19887 suite's in-memory driver shape; by-id and bulk.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { stripReadonlyWhenFields } from './validation/rule-validator.js';

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

describe('a value one readonlyWhen lock drops no longer unlocks another (#19911)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let warns: string[];

  beforeEach(async () => {
    warns = [];
    const logger: any = {
      warn: (m: string) => warns.push(String(m)),
      debug() {}, info() {}, error() {}, trace() {}, fatal() {},
      child() { return logger; },
    };
    engine = new ObjectQL({ logger });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    // The card: a closed case stays closed, and its amount is frozen.
    engine.registry.registerObject({
      name: 'case_x',
      fields: {
        status: { type: 'text', readonlyWhen: "previous.status == 'closed'" },
        amount: { type: 'number', readonlyWhen: "record.status == 'closed'" },
        note: { type: 'text' },
      },
    } as any);
    // Two interacting locks where nothing should drop: an unarchived closed
    // case may be reopened, and a reopened case's amount is writable.
    engine.registry.registerObject({
      name: 'case_reopen',
      fields: {
        archived: { type: 'boolean' },
        status: { type: 'text', readonlyWhen: 'previous.archived == true' },
        amount: { type: 'number', readonlyWhen: "record.status == 'closed'" },
      },
    } as any);
    // The reverse: a frozen case's status cannot move, so a `closed` the row
    // never takes must not lock its amount.
    engine.registry.registerObject({
      name: 'case_frozen',
      fields: {
        frozen: { type: 'boolean' },
        status: { type: 'text', readonlyWhen: 'previous.frozen == true' },
        amount: { type: 'number', readonlyWhen: "record.status == 'closed'" },
        tag: { type: 'text' },
      },
    } as any);
    // A lock that also reads its OWN field judges the write's own value.
    engine.registry.registerObject({
      name: 'case_capped',
      fields: {
        status: { type: 'text', readonlyWhen: "previous.status == 'closed'" },
        amount: { type: 'number', readonlyWhen: "record.amount > 1000 || record.status == 'closed'" },
      },
    } as any);
    // A three-lock chain with exactly one drop set that agrees with its row.
    engine.registry.registerObject({
      name: 'chain',
      fields: {
        c: { type: 'text', readonlyWhen: "previous.c == 'L'" },
        b: { type: 'text', readonlyWhen: "record.c == 'L'" },
        a: { type: 'number', readonlyWhen: "record.b == 'x'" },
      },
    } as any);
    // Two locks reading each other: no drop set agrees with its row.
    engine.registry.registerObject({
      name: 'cycle',
      fields: {
        a: { type: 'text', readonlyWhen: "record.b == 'x'" },
        b: { type: 'text', readonlyWhen: "record.a == 'old_a'" },
      },
    } as any);
    // `requiredWhen` runs on the stripped payload, so it answers for the
    // amount the row keeps — in both directions.
    engine.registry.registerObject({
      name: 'case_big_note',
      fields: {
        status: { type: 'text', readonlyWhen: "previous.status == 'closed'" },
        amount: { type: 'number', readonlyWhen: "record.status == 'closed'" },
        note: { type: 'text', requiredWhen: 'record.amount > 500' },
      },
    } as any);
    engine.registry.registerObject({
      name: 'case_small_note',
      fields: {
        status: { type: 'text', readonlyWhen: "previous.status == 'closed'" },
        amount: { type: 'number', readonlyWhen: "record.status == 'closed'" },
        note: { type: 'text', requiredWhen: 'record.amount < 500' },
      },
    } as any);
    // #19853's settlement: the FK's OWN record-scoped lock reads a field that
    // its own conditional lock keeps, and the amount's lock reads `parent`.
    engine.registry.registerObject({ name: 'inv', fields: { status: { type: 'text' } } } as any);
    engine.registry.registerObject({
      name: 'line_staged',
      fields: {
        stage: { type: 'text', readonlyWhen: "previous.stage == 'submitted'" },
        invoice: { type: 'master_detail', reference: 'inv', readonlyWhen: "record.stage == 'submitted'" },
        amount: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
        tag: { type: 'text' },
      },
    } as any);
    // The same FK lock with no `parent`-scoped lock: no settlement, one strip.
    engine.registry.registerObject({
      name: 'line_staged_flat',
      fields: {
        stage: { type: 'text', readonlyWhen: "previous.stage == 'submitted'" },
        invoice: { type: 'master_detail', reference: 'inv', readonlyWhen: "record.stage == 'submitted'" },
        amount: { type: 'number' },
      },
    } as any);
    // #19853's own `inv_line_moored` shape (the stage is not in the payload),
    // and its twin whose FK lock reads only `previous`.
    engine.registry.registerObject({
      name: 'line_moored',
      fields: {
        stage: { type: 'text' },
        invoice: { type: 'master_detail', reference: 'inv', readonlyWhen: "record.stage == 'submitted'" },
        amount: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
      },
    } as any);
    engine.registry.registerObject({
      name: 'line_moored_prev',
      fields: {
        stage: { type: 'text' },
        invoice: { type: 'master_detail', reference: 'inv', readonlyWhen: "previous.stage == 'submitted'" },
        amount: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
      },
    } as any);
    // The FK's own lock reads a value that is itself locked under the header
    // the update names — the settlement's stays → moves direction.
    engine.registry.registerObject({
      name: 'line_big',
      fields: {
        invoice: { type: 'master_detail', reference: 'inv', readonlyWhen: "record.amount == 'big'" },
        amount: { type: 'text', readonlyWhen: "parent.status == 'paid'" },
        tag: { type: 'text' },
      },
    } as any);
    // An FK whose own lock faults (text compared with a number): fail-open.
    engine.registry.registerObject({
      name: 'line_fault',
      fields: {
        stage: { type: 'text' },
        invoice: { type: 'master_detail', reference: 'inv', readonlyWhen: 'record.stage > 5' },
        amount: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
      },
    } as any);

    storeFor('case_x').set('c1', { id: 'c1', status: 'closed', amount: 100, note: 'k' });
    storeFor('case_x').set('c2', { id: 'c2', status: 'closed', amount: 100, note: 'k' });
    storeFor('case_x').set('o1', { id: 'o1', status: 'open', amount: 100, note: 'o' });
    storeFor('case_reopen').set('r1', { id: 'r1', archived: false, status: 'closed', amount: 100 });
    storeFor('case_frozen').set('z1', { id: 'z1', frozen: true, status: 'open', amount: 100, tag: 't' });
    storeFor('case_frozen').set('z2', { id: 'z2', frozen: false, status: 'open', amount: 100, tag: 't' });
    storeFor('case_capped').set('q1', { id: 'q1', status: 'open', amount: 100 });
    storeFor('case_capped').set('q2', { id: 'q2', status: 'closed', amount: 100 });
    storeFor('chain').set('h1', { id: 'h1', c: 'L', b: 'y', a: 1 });
    storeFor('cycle').set('y1', { id: 'y1', a: 'old_a', b: 'y' });
    storeFor('case_big_note').set('g1', { id: 'g1', status: 'closed', amount: 100, note: null });
    storeFor('case_small_note').set('m1', { id: 'm1', status: 'closed', amount: 100, note: 'kept' });
    storeFor('inv').set('inv_a', { id: 'inv_a', status: 'paid' });
    storeFor('inv').set('inv_b', { id: 'inv_b', status: 'open' });
    storeFor('line_staged').set('s1', { id: 's1', stage: 'submitted', invoice: 'inv_a', amount: 100, tag: 'x' });
    storeFor('line_staged').set('s2', { id: 's2', stage: 'submitted', invoice: 'inv_a', amount: 100, tag: 'x' });
    storeFor('line_staged_flat').set('k1', { id: 'k1', stage: 'submitted', invoice: 'inv_a', amount: 100 });
    storeFor('line_moored').set('m1', { id: 'm1', stage: 'submitted', invoice: 'inv_a', amount: 100 });
    storeFor('line_moored_prev').set('m1', { id: 'm1', stage: 'submitted', invoice: 'inv_a', amount: 100 });
    storeFor('line_fault').set('f1', { id: 'f1', stage: 'draft', invoice: 'inv_a', amount: 100 });
    storeFor('line_big').set('b1', { id: 'b1', invoice: 'inv_b', amount: 'small', tag: 'y' });
    storeFor('line_big').set('b2', { id: 'b2', invoice: 'inv_b', amount: 'small', tag: 'y' });
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

  function dropEvents(): { events: any[]; options: any } {
    const events: any[] = [];
    return { events, options: { onFieldsDropped: (e: any) => events.push(e) } };
  }

  /** Every header id the write reads, in order (single-id and batched reads). */
  function recordHeaderReads(): unknown[] {
    const reads: unknown[] = [];
    const findOne = (engine as any).findOne.bind(engine);
    (engine as any).findOne = async (name: string, q: any, o?: any) => {
      if (name === 'inv') reads.push(q?.where?.id);
      return findOne(name, q, o);
    };
    return reads;
  }

  // ── The card ──────────────────────────────────────────────────────────

  it('THE CARD: the dropped reopen no longer unlocks the closed case\'s amount', async () => {
    await engine.update('case_x', { id: 'c1', status: 'open', amount: 999 });
    expect(row('case_x', 'c1')).toMatchObject({ status: 'closed', amount: 100 });
  });

  it('CONTROL: the amount alone on a closed case, unchanged', async () => {
    await engine.update('case_x', { id: 'c1', amount: 555 });
    expect(row('case_x', 'c1')).toMatchObject({ status: 'closed', amount: 100 });
  });

  it('THE CARD in BULK: no matched closed case takes the amount', async () => {
    await engine.update('case_x', { status: 'open', amount: 999 }, { where: { note: 'k' }, multi: true } as any);
    expect(row('case_x', 'c1')).toMatchObject({ status: 'closed', amount: 100 });
    expect(row('case_x', 'c2')).toMatchObject({ status: 'closed', amount: 100 });
  });

  it('CONTROL in BULK: the amount alone, unchanged', async () => {
    await engine.update('case_x', { amount: 555 }, { where: { note: 'k' }, multi: true } as any);
    expect(row('case_x', 'c1')).toMatchObject({ amount: 100 });
    expect(row('case_x', 'c2')).toMatchObject({ amount: 100 });
  });

  it('reports both drops as ONE readonly_when event, and warns once per field', async () => {
    const { events, options } = dropEvents();
    await engine.update('case_x', { id: 'c1', status: 'open', amount: 999 }, options);
    expect(events).toEqual([{ object: 'case_x', fields: ['status', 'amount'], reason: 'readonly_when' }]);
    expect(warns.filter((w) => w.includes('is read-only (readonlyWhen)'))).toEqual([
      "Field 'status' is read-only (readonlyWhen) — ignoring incoming change",
      "Field 'amount' is read-only (readonlyWhen) — ignoring incoming change",
    ]);
  });

  it('under strictReadonlyWrites the write is still refused, now naming BOTH fields, and nothing lands', async () => {
    const err = await rejection(engine.update(
      'case_x',
      { id: 'c1', status: 'open', amount: 999, note: 'edited' },
      { strictReadonlyWrites: true } as any,
    ));
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.name).toBe('ReadonlyFieldRejectedError');
    expect(err.fields).toEqual(['status', 'amount']);
    expect(err.drops).toEqual([{ object: 'case_x', fields: ['status', 'amount'], reason: 'readonly_when' }]);
    expect(row('case_x', 'c1')).toMatchObject({ status: 'closed', amount: 100, note: 'k' });
  });

  it('isSystem: a conditional lock binds a system caller too, so the amount stays', async () => {
    await engine.update('case_x', { id: 'c1', status: 'open', amount: 999 }, { context: { isSystem: true } } as any);
    expect(row('case_x', 'c1')).toMatchObject({ status: 'closed', amount: 100 });
  });

  it('preserveAudit: exempts no conditional lock, so the amount stays', async () => {
    await engine.update('case_x', { id: 'c1', status: 'open', amount: 999 }, { context: { preserveAudit: true } } as any);
    expect(row('case_x', 'c1')).toMatchObject({ status: 'closed', amount: 100 });
  });

  // ── Hook-written values are not the strip's: they land, and are read ──

  it('a hook-written status is not judged, lands, and the amount\'s lock reads it', async () => {
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      if ('amount' in ctx.input.data) ctx.input.data.status = 'open';
    }, { object: 'case_x', priority: 50 });
    await engine.update('case_x', { id: 'c1', amount: 999 });
    expect(row('case_x', 'c1')).toMatchObject({ status: 'open', amount: 999 });
  });

  it('a hook overwriting the caller\'s status lands, and the amount\'s lock reads the hook\'s value', async () => {
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data.status = 'reopened';
    }, { object: 'case_x', priority: 50 });
    await engine.update('case_x', { id: 'c1', status: 'open', amount: 999 });
    expect(row('case_x', 'c1')).toMatchObject({ status: 'reopened', amount: 999 });
  });

  it('a hook echoing the caller\'s own status is still the caller\'s (#14259), so both drop', async () => {
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data.status = 'open';
    }, { object: 'case_x', priority: 50 });
    await engine.update('case_x', { id: 'c1', status: 'open', amount: 999 });
    expect(row('case_x', 'c1')).toMatchObject({ status: 'closed', amount: 100 });
  });

  it('a hook-written amount is not judged, and lands', async () => {
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data.amount = 777;
    }, { object: 'case_x', priority: 50 });
    await engine.update('case_x', { id: 'c1', status: 'open' });
    expect(row('case_x', 'c1')).toMatchObject({ status: 'closed', amount: 777 });
  });

  // ── Interacting locks where nothing, or less, should drop ─────────────

  it('LEGITIMATE REOPEN: two interacting locks, neither locked, and both fields land', async () => {
    const { events, options } = dropEvents();
    await engine.update('case_reopen', { id: 'r1', status: 'open', amount: 999 }, options);
    expect(row('case_reopen', 'r1')).toMatchObject({ status: 'open', amount: 999 });
    expect(events).toEqual([]);
  });

  it('LEGITIMATE REOPEN in BULK, and under strictReadonlyWrites: nothing dropped, nothing refused', async () => {
    await engine.update('case_reopen', { status: 'open', amount: 999 }, { where: { archived: false }, multi: true, strictReadonlyWrites: true } as any);
    expect(row('case_reopen', 'r1')).toMatchObject({ status: 'open', amount: 999 });
  });

  it('CLOSE AND EDIT on an open case: the closing lands, so the amount is locked by it', async () => {
    await engine.update('case_x', { id: 'o1', status: 'closed', amount: 999 });
    expect(row('case_x', 'o1')).toMatchObject({ status: 'closed', amount: 100 });
  });

  it('REVERSE: a dropped `closed` no longer locks the frozen case\'s amount', async () => {
    const { events, options } = dropEvents();
    await engine.update('case_frozen', { id: 'z1', status: 'closed', amount: 999 }, options);
    expect(row('case_frozen', 'z1')).toMatchObject({ status: 'open', amount: 999 });
    expect(events).toEqual([{ object: 'case_frozen', fields: ['status'], reason: 'readonly_when' }]);
  });

  it('REVERSE in BULK: locked in ≥1 row, the status drops for all, and the amount lands in every row', async () => {
    await engine.update('case_frozen', { status: 'closed', amount: 999 }, { where: { tag: 't' }, multi: true } as any);
    expect(row('case_frozen', 'z1')).toMatchObject({ status: 'open', amount: 999 });
    expect(row('case_frozen', 'z2')).toMatchObject({ status: 'open', amount: 999 });
  });

  it('REVERSE under strictReadonlyWrites: still refused, now naming only the status', async () => {
    const err = await rejection(engine.update('case_frozen', { id: 'z1', status: 'closed', amount: 999 }, { strictReadonlyWrites: true } as any));
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['status']);
    expect(err.drops).toEqual([{ object: 'case_frozen', fields: ['status'], reason: 'readonly_when' }]);
    expect(row('case_frozen', 'z1')).toMatchObject({ status: 'open', amount: 100 });
  });

  it('a lock reading its OWN field judges the write\'s value: over the cap stays locked', async () => {
    await engine.update('case_capped', { id: 'q1', amount: 5000 });
    expect(row('case_capped', 'q1')).toMatchObject({ amount: 100 });
    await engine.update('case_capped', { id: 'q1', amount: 500 });
    expect(row('case_capped', 'q1')).toMatchObject({ amount: 500 });
  });

  it('a lock reading its OWN field and a dropped one: the reopen drops, and the amount is judged closed', async () => {
    await engine.update('case_capped', { id: 'q2', status: 'open', amount: 500 });
    expect(row('case_capped', 'q2')).toMatchObject({ status: 'closed', amount: 100 });
  });

  it('CHAIN: of three interacting locks, only the two locked on the stored row drop', async () => {
    const { events, options } = dropEvents();
    await engine.update('chain', { id: 'h1', c: 'open', b: 'x', a: 2 }, options);
    expect(row('chain', 'h1')).toMatchObject({ c: 'L', b: 'y', a: 2 });
    expect(events).toEqual([{ object: 'chain', fields: ['c', 'b'], reason: 'readonly_when' }]);
  });

  it('CYCLE: with no drop set that agrees with its row, both locks hold (fail-safe)', async () => {
    const { events, options } = dropEvents();
    await engine.update('cycle', { id: 'y1', a: 'new_a', b: 'x' }, options);
    expect(row('cycle', 'y1')).toMatchObject({ a: 'old_a', b: 'y' });
    expect(events).toEqual([{ object: 'cycle', fields: ['a', 'b'], reason: 'readonly_when' }]);
  });

  // ── requiredWhen answers for the amount the row keeps ─────────────────

  it('requiredWhen: a requirement only the let-through amount raised no longer refuses the write', async () => {
    await engine.update('case_big_note', { id: 'g1', status: 'open', amount: 999 });
    expect(row('case_big_note', 'g1')).toMatchObject({ status: 'closed', amount: 100, note: null });
  });

  it('requiredWhen: clearing a field the kept amount requires is now refused', async () => {
    const err = await rejection(engine.update('case_small_note', { id: 'm1', status: 'open', amount: 999, note: null }));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toEqual([expect.objectContaining({ field: 'note', code: 'required' })]);
    expect(row('case_small_note', 'm1')).toMatchObject({ status: 'closed', amount: 100, note: 'kept' });
  });

  // ── #19853's settlement: the FK's own lock is judged with the rest ────

  it('SETTLEMENT: the FK\'s own lock reads the stage the row keeps, so the line stays home under the paid invoice', async () => {
    const { events, options } = dropEvents();
    const reads = recordHeaderReads();
    await engine.update('line_staged', { id: 's1', stage: 'draft', invoice: 'inv_b', amount: 999 }, options);
    expect(row('line_staged', 's1')).toMatchObject({ stage: 'submitted', invoice: 'inv_a', amount: 100 });
    expect(events).toEqual([{ object: 'line_staged', fields: ['stage', 'invoice', 'amount'], reason: 'readonly_when' }]);
    // The FK's lock reads `record`, and the amount's lock reads `parent`, so
    // the FK is judged on the landing it names; it does not land, so the rest
    // are judged against the header the row keeps.
    expect(reads).toEqual(['inv_b', 'inv_a']);
  });

  it('SETTLEMENT in BULK: every matched line stays home, and its amount is judged there', async () => {
    await engine.update('line_staged', { stage: 'draft', invoice: 'inv_b', amount: 999 }, { where: { tag: 'x' }, multi: true } as any);
    expect(row('line_staged', 's1')).toMatchObject({ stage: 'submitted', invoice: 'inv_a', amount: 100 });
    expect(row('line_staged', 's2')).toMatchObject({ stage: 'submitted', invoice: 'inv_a', amount: 100 });
  });

  it('with no parent-scoped lock (no settlement) the FK\'s lock reads the kept stage too', async () => {
    await engine.update('line_staged_flat', { id: 'k1', stage: 'draft', invoice: 'inv_b', amount: 5 });
    expect(row('line_staged_flat', 'k1')).toMatchObject({ stage: 'submitted', invoice: 'inv_a', amount: 5 });
  });

  it('#19853\'s moored shape: same row and report, and one more header read (the named one)', async () => {
    const { events, options } = dropEvents();
    const reads = recordHeaderReads();
    await engine.update('line_moored', { id: 'm1', invoice: 'inv_b', amount: 999 }, options);
    expect(row('line_moored', 'm1')).toMatchObject({ invoice: 'inv_a', amount: 100 });
    expect(events).toEqual([{ object: 'line_moored', fields: ['invoice', 'amount'], reason: 'readonly_when' }]);
    expect(reads).toEqual(['inv_b', 'inv_a']);
  });

  it('an FK lock reading only `previous` needs no named header: one read, as before', async () => {
    const reads = recordHeaderReads();
    await engine.update('line_moored_prev', { id: 'm1', invoice: 'inv_b', amount: 999 });
    expect(row('line_moored_prev', 'm1')).toMatchObject({ invoice: 'inv_a', amount: 100 });
    expect(reads).toEqual(['inv_a']);
  });

  it('a landing FK is re-judged with the rest, and its fail-open fault is said ONCE', async () => {
    await engine.update('line_fault', { id: 'f1', invoice: 'inv_b', amount: 5 });
    expect(row('line_fault', 'f1')).toMatchObject({ invoice: 'inv_b', amount: 5 });
    expect(warns.filter((w) => w.includes("readonlyWhen for 'invoice' failed to evaluate"))).toHaveLength(1);
  });

  // ── The settlement in the other direction: stays → moves ─────────────
  //
  // The FK's own lock reads `record.amount`, and `amount` is locked under the
  // paid invoice the update names. Judged ALONE, the FK read the incoming
  // `'big'` and held the line home, and the edit landed under the open header.
  // Judged WITH the amount's lock on the landing it names, the amount drops,
  // the FK reads the stored `'small'` and lands, and the edit is dropped under
  // the paid header. Both rows agree with their locks; the second is the one
  // the landing-first rule (#4889) now reaches.

  it('STAYS → MOVES: the repoint lands on the paid invoice and the edit under it is dropped', async () => {
    const { events, options } = dropEvents();
    const reads = recordHeaderReads();
    await engine.update('line_big', { id: 'b1', invoice: 'inv_a', amount: 'big' }, options);
    expect(row('line_big', 'b1')).toMatchObject({ invoice: 'inv_a', amount: 'small' });
    expect(events).toEqual([{ object: 'line_big', fields: ['amount'], reason: 'readonly_when' }]);
    // The header the update names, then the repoint's reference check.
    expect(reads).toEqual(['inv_a', 'inv_a']);
  });

  it('STAYS → MOVES in BULK: every matched line lands on the paid invoice, every edit is dropped', async () => {
    const { events, options } = dropEvents();
    await engine.update('line_big', { invoice: 'inv_a', amount: 'big' }, { ...options, where: { tag: 'y' }, multi: true } as any);
    expect(row('line_big', 'b1')).toMatchObject({ invoice: 'inv_a', amount: 'small' });
    expect(row('line_big', 'b2')).toMatchObject({ invoice: 'inv_a', amount: 'small' });
    expect(events).toEqual([{ object: 'line_big', fields: ['amount'], reason: 'readonly_when' }]);
  });

  it('STAYS → MOVES under strictReadonlyWrites: still refused, now naming the amount, and nothing lands', async () => {
    const err = await rejection(engine.update('line_big', { id: 'b1', invoice: 'inv_a', amount: 'big' }, { strictReadonlyWrites: true } as any));
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['amount']);
    expect(err.drops).toEqual([{ object: 'line_big', fields: ['amount'], reason: 'readonly_when' }]);
    expect(row('line_big', 'b1')).toMatchObject({ invoice: 'inv_b', amount: 'small' });
  });
});

describe('stripReadonlyWhenFields `only` (#19911)', () => {
  const fields = {
    fields: {
      status: { type: 'text', readonlyWhen: "previous.status == 'closed'" },
      amount: { type: 'number', readonlyWhen: "record.status == 'closed'" },
    },
  } as any;
  const closed = { status: 'closed', amount: 100 };

  it('takes only the named key, judged over the other keys\' drops', () => {
    const warned: string[] = [];
    const out = stripReadonlyWhenFields(fields, { status: 'open', amount: 999 }, closed, { warn: (m: string) => warned.push(m) }, undefined, { only: 'amount' });
    expect(out).toEqual({ status: 'open' });
    expect(warned).toEqual(["Field 'amount' is read-only (readonlyWhen) — ignoring incoming change"]);
  });

  it('says nothing about a named key left standing, and returns the payload itself', () => {
    const warned: string[] = [];
    const data = { status: 'open', amount: 999 };
    const out = stripReadonlyWhenFields(fields, data, { status: 'open', amount: 100 }, { warn: (m: string) => warned.push(m) }, undefined, { only: 'amount' });
    expect(out).toBe(data);
    expect(warned).toEqual([]);
  });
});
